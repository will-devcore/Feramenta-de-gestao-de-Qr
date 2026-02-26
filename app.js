/* * SCANNER QR MASTER - VERSÃO PRO 2.0 BLINDADA (UNIFICADA)
 * -----------------------------------------------------------
 * COPYRIGHT (C) 2026, WILLIAM VA PEREIRA. (github.com/will-devcore)
 * TODOS OS DIREITOS RESERVADOS.
 -----------------------------------------------------------
 * Este software é propriedade privada. A cópia, modificação ou 
 * distribuição não autorizada deste código-fonte é proibida.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, getDoc, getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyA-Un2ijd0Ao-sIeVFjq5lWU-0wBfwrEhk",
    authDomain: "sistema-qr-master.firebaseapp.com",
    projectId: "sistema-qr-master",
    storageBucket: "sistema-qr-master.appspot.com",
    messagingSenderId: "587607393218",
    appId: "1:587607393218:web:1cc6d38577f69cc0110c5b"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
const codeReader = new ZXing.BrowserQRCodeReader();

// --- VARIÁVEIS GLOBAIS ---
let operadorAtual = "";
let grupoAtual = "";
let isAdmin = false;
let processandoAcao = false;
let listaEscaneamentos = [];
let timerInatividade;
let urlSefazBase = "https://portalsped.fazenda.mg.gov.br/portalsped/sistema/consultaunificada.xhtml?chaveAcesso=";

// --- 1. NÚCLEO DE VALIDAÇÃO (Módulo 11) ---
function validarChaveNF(chave) {
    const limpa = chave.replace(/\D/g, '');
    if (limpa.length !== 44) return false;
    let soma = 0, peso = 2;
    for (let i = 42; i >= 0; i--) {
        soma += parseInt(limpa[i]) * peso;
        peso = (peso === 9) ? 2 : peso + 1;
    }
    const resto = soma % 11;
    const dvCalculado = (resto === 0 || resto === 1) ? 0 : 11 - resto;
    return dvCalculado === parseInt(limpa[43]);
}

// --- 2. FILTRO DE BLINDAGEM (Binarização) ---
function aplicarFiltroBlindagem(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const v = avg > 125 ? 255 : 0;
        data[i] = data[i+1] = data[i+2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL();
}

// --- 3. MOTOR DE PROCESSAMENTO EM DEGRAUS ---
async function processarEntrada(origem) {
    if (processandoAcao) return;
    processandoAcao = true;
    atualizarStatusUI("🔍 Analisando...");

    let chaveFinal = null;

    if (typeof origem === "string") {
        const match = origem.match(/\d{44}/);
        if (match && validarChaveNF(match[0])) chaveFinal = match[0];
    } else {
        try {
            const res = await codeReader.decodeFromImageElement(origem);
            const m = res.text.match(/\d{44}/);
            if (m) chaveFinal = m[0];
        } catch (e) {
            atualizarStatusUI("⚡ Blindando imagem...");
            const canvas = document.createElement('canvas');
            canvas.width = origem.width; canvas.height = origem.height;
            canvas.getContext('2d').drawImage(origem, 0, 0);
            const imgBlindada = aplicarFiltroBlindagem(canvas);
            try {
                const resB = await codeReader.decodeFromImageUrl(imgBlindada);
                const mB = resB.text.match(/\d{44}/);
                if (mB) chaveFinal = mB[0];
            } catch (e2) {
                atualizarStatusUI("🤖 Tentando OCR...");
                const { data: { text } } = await Tesseract.recognize(imgBlindada, 'por');
                const mC = text.replace(/\D/g, '').match(/\d{44}/);
                if (mC && validarChaveNF(mC[0])) chaveFinal = mC[0];
            }
        }
    }

    if (chaveFinal) {
        await salvarRegistro(urlSefazBase + chaveFinal);
    } else {
        alert("❌ Falha na leitura automática. Use o campo manual.");
        document.getElementById("urlManual").focus();
    }

    processandoAcao = false;
    atualizarStatusUI(null);
}

// --- 4. PERSISTÊNCIA NO FIREBASE ---
async function salvarRegistro(linkCompleto) {
    try {
        const q = query(collection(db, "scans"), where("link", "==", linkCompleto), where("grupo", "==", grupoAtual));
        const snap = await getDocs(q);
        if (!snap.empty) {
            alert("⚠️ Esta nota já foi registrada pelo seu grupo!");
            return;
        }

        const novoDoc = {
            link: linkCompleto,
            data: new Date().toLocaleString('pt-BR'),
            operador: operadorAtual,
            grupo: grupoAtual,
            timestamp: Date.now()
        };

        await addDoc(collection(db, "scans"), novoDoc);
        await carregarHistorico();
        alert("✅ Registro salvo com sucesso!");
    } catch (err) {
        console.error(err);
        alert("❌ Erro ao salvar no banco.");
    }
}

// --- 5. GESTÃO DE ACESSO ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            if (userDoc.exists()) {
                const dados = userDoc.data();
                operadorAtual = dados.nome;
                grupoAtual = dados.grupo;
                isAdmin = dados.cargo === "admin"; 

                document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
                document.getElementById("nomeOperadorTroca").value = operadorAtual;
                
                carregarPreferenciasLocalStorage();
                document.getElementById("telaLogin").style.display = "none";
                document.getElementById("conteudoApp").style.display = "block";
                
                await carregarHistorico();
                await carregarGruposDinamicos();
                await window.carregarOperadoresDoGrupo();
                resetarTimer();
            }
        } catch (e) { console.error(e); }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

// --- 6. FUNÇÕES EXPOSTAS (WINDOW) ---
window.fazerLogin = () => {
    const email = document.getElementById("emailLogin").value;
    const senha = document.getElementById("senhaLogin").value;
    signInWithEmailAndPassword(auth, email, senha).catch(e => alert("Erro: " + e.message));
};

window.fazerLogout = () => signOut(auth).then(() => location.reload());

window.toggleConfig = () => {
    const p = document.getElementById("painelAjustes");
    p.style.display = p.style.display === "none" ? "block" : "none";
};

window.toggleDarkMode = () => {
    document.body.classList.toggle("dark-mode");
    window.salvarPreferencias();
};

window.salvarPreferencias = () => {
    const novoNome = document.getElementById("nomeOperadorTroca").value;
    const novoTempo = document.getElementById("setInatividade").value;
    const modoEscuroAtivo = document.body.classList.contains('dark-mode');

    if (novoNome) operadorAtual = novoNome;

    const objetoPrefs = {
        nomePersonalizado: novoNome,
        tempoInatividade: novoTempo,
        darkMode: modoEscuroAtivo
    };
    localStorage.setItem('prefsQR', JSON.stringify(objetoPrefs));
    alert("✅ Configurações salvas!");
    resetarTimer();
};

window.enviarManual = () => {
    const val = document.getElementById("urlManual").value.trim();
    if (val) processarEntrada(val);
};

window.ativarScannerAoVivo = async () => {
    const btn = document.getElementById("btnLigarCamera");
    const video = document.getElementById("reader");
    btn.innerText = "⌛ Iniciando...";
    try {
        video.style.display = "block";
        const devices = await codeReader.listVideoInputDevices();
        const selectedId = devices[devices.length - 1].deviceId;
        codeReader.decodeFromVideoDevice(selectedId, 'reader', (result) => {
            if (result && !processandoAcao) processarEntrada(result.text);
        });
        btn.style.display = "none";
    } catch (e) { alert("Câmera indisponível."); btn.innerText = "🚀 LIGAR SCANNER AO VIVO"; }
};

window.lerQrDeArquivo = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => processarEntrada(img);
};

// --- 7. AUXILIARES E RELATÓRIO ---
async function carregarHistorico() {
    try {
        const q = query(collection(db, "scans"), where("grupo", "==", grupoAtual), orderBy("timestamp", "desc"), limit(20));
        const snap = await getDocs(q);
        listaEscaneamentos = snap.docs.map(d => d.data());
        atualizarTabela();
    } catch (e) { console.error(e); }
}

async function carregarGruposDinamicos() {
    const selectGrupo = document.getElementById("filtroGrupo");
    if (!selectGrupo) return;
    try {
        if (!isAdmin) {
            selectGrupo.innerHTML = `<option value="${grupoAtual}">${grupoAtual}</option>`;
            return;
        }
        const snap = await getDocs(collection(db, "usuarios"));
        const gruposSet = new Set();
        snap.forEach(doc => { if (doc.data().grupo) gruposSet.add(doc.data().grupo); });
        let opcoes = '<option value="todos">-- TODOS OS GRUPOS --</option>';
        gruposSet.forEach(g => { opcoes += `<option value="${g}">${g}</option>`; });
        selectGrupo.innerHTML = opcoes;
        selectGrupo.disabled = false;
    } catch (e) { console.error(e); }
}

function atualizarTabela() {
    const corpo = document.getElementById("corpoTabela");
    if (!corpo) return;
    corpo.innerHTML = listaEscaneamentos.map(item => `
        <tr>
            <td>✅ Ok</td>
            <td style="word-break:break-all">${item.link}</td>
            <td>${item.data}</td>
            <td>${item.operador} (${item.grupo})</td>
            <td><button onclick="alert('${item.link}')">ℹ️</button></td>
        </tr>`).join('');
}

function atualizarStatusUI(msg) {
    const st = document.getElementById("statusEnvio");
    if (msg) { st.innerText = msg; st.style.display = "block"; }
    else st.style.display = "none";
}

function carregarPreferenciasLocalStorage() {
    const dados = localStorage.getItem('prefsQR');
    if (dados) {
        const prefs = JSON.parse(dados);
        if (prefs.darkMode) document.body.classList.add('dark-mode');
        if (prefs.tempoInatividade) document.getElementById("setInatividade").value = prefs.tempoInatividade;
    }
}

function resetarTimer() {
    clearTimeout(timerInatividade);
    const tempo = parseInt(document.getElementById("setInatividade").value);
    if (tempo > 0) {
        timerInatividade = setTimeout(() => {
            codeReader.reset();
            document.getElementById("reader").style.display = "none";
            const b = document.getElementById("btnLigarCamera");
            if (b) { b.style.display = "block"; b.innerText = "🚀 CÂMERA EM REPOUSO (TOQUE P/ VOLTAR)"; }
        }, tempo);
    }
}

document.addEventListener("click", resetarTimer);
document.addEventListener("touchstart", resetarTimer);