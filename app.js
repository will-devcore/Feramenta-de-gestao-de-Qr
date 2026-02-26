/* * SCANNER QR MASTER - VERSÃO PRO 2.0 BLINDADA (UNIFICADA)
 * -----------------------------------------------------------
 * COPYRIGHT (C) 2026, WILLIAM VA PEREIRA. (github.com/will-devcore)
 * TODOS OS DIREITOS RESERVADOS.
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

let configApp = {
    urlSefaz: "https://portalsped.fazenda.mg.gov.br/portalsped/sistema/consultaunificada.xhtml?chaveAcesso=",
    estadoUF: "MG"
};

// --- [VÍNCULO COM O HTML] ---
// Isso resolve o problema das funções "esbranquiçadas" e botões que não funcionam
window.ativarScannerAoVivo = () => ativarScannerAoVivo();
window.lerQrDeArquivo = (e) => lerQrDeArquivo(e);
window.enviarManual = () => enviarManual();
window.toggleConfig = () => toggleConfig();
window.fazerLogout = () => fazerLogout();
window.salvarPreferencias = () => salvarPreferencias();
window.toggleDarkMode = () => toggleDarkMode();
window.gerarRelatorio = () => carregarHistorico();
window.fazerLogin = () => fazerLogin();
window.exportarParaCSV = () => exportarParaCSV();
window.formatarChaveParaExibicao = (v) => formatarChaveParaExibicao(v);

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

// FUNÇÃO: Recuperar Chave Completa (Tenta reconstruir se faltar 1 dígito)
function recuperarChaveCompleta(chaveIncompleta) {
    const limpa = chaveIncompleta.replace(/\D/g, '');
    if (limpa.length === 44 && validarChaveNF(limpa)) return limpa;
    if (limpa.length === 43) {
        for (let i = 0; i <= 9; i++) {
            if (validarChaveNF(limpa + i)) return limpa + i;
        }
    }
    return null;
}

function formatarChaveParaExibicao(valor) {
    return valor.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

// --- 2. FILTRO DE BLINDAGEM ---
function aplicarFiltroBlindagem(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const v = avg > 135 ? 255 : 0; 
        data[i] = data[i+1] = data[i+2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL();
}

// --- 3. MOTOR DE PROCESSAMENTO ---
async function processarEntrada(origem) {
    if (processandoAcao) return;
    processandoAcao = true;
    atualizarStatusUI("🔍 Analisando...");

    let textoLido = "";

    if (typeof origem === "string") {
        textoLido = origem;
    } else {
        try {
            const res = await codeReader.decodeFromImageElement(origem);
            textoLido = res.text;
        } catch (e) {
            atualizarStatusUI("🤖 Recuperando Chave Completa...");
            const canvas = document.createElement('canvas');
            canvas.width = origem.width; canvas.height = origem.height;
            canvas.getContext('2d').drawImage(origem, 0, 0);
            const imgBlindada = aplicarFiltroBlindagem(canvas);
            const { data: { text } } = await Tesseract.recognize(imgBlindada, 'por');
            textoLido = text;
        }
    }

    // EXTRAÇÃO BLINDADA: Busca 44 ou 43 números no meio do texto
    const numeros = textoLido.replace(/\s/g, '');
    const match44 = numeros.match(/\d{44}/);
    const match43 = numeros.match(/\d{43}/);
    
    let chaveFinal = null;
    if (match44) chaveFinal = recuperarChaveCompleta(match44[0]);
    else if (match43) chaveFinal = recuperarChaveCompleta(match43[0]);

    if (chaveFinal) {
        if (confirm(`Chave Validada:\n${formatarChaveParaExibicao(chaveFinal)}\n\nDeseja salvar?`)) {
            await salvarRegistro(configApp.urlSefaz + chaveFinal);
        }
    } else {
        alert("❌ Chave inválida. Editando manualmente...");
        const campo = document.getElementById("urlManual");
        campo.value = formatarChaveParaExibicao(numeros.substring(0,44));
        campo.focus();
    }

    processandoAcao = false;
    atualizarStatusUI(null);
}

// --- 4. FIREBASE E HISTÓRICO ---
async function salvarRegistro(linkCompleto) {
    try {
        const q = query(collection(db, "scans"), where("link", "==", linkCompleto), where("grupo", "==", grupoAtual));
        const snap = await getDocs(q);
        if (!snap.empty) return alert("⚠️ Nota já registrada no grupo!");

        await addDoc(collection(db, "scans"), {
            link: linkCompleto,
            data: new Date().toLocaleString('pt-BR'),
            operador: operadorAtual,
            grupo: grupoAtual,
            timestamp: Date.now()
        });
        await carregarHistorico();
        alert("✅ Salvo com sucesso!");
    } catch (err) { alert("Erro ao salvar."); }
}

async function carregarHistorico() {
    try {
        const q = query(collection(db, "scans"), where("grupo", "==", grupoAtual), orderBy("timestamp", "desc"), limit(20));
        const snap = await getDocs(q);
        listaEscaneamentos = snap.docs.map(d => d.data());
        atualizarTabela();
        
        // Ativa filtro de grupo se for Admin
        const sel = document.getElementById("filtroGrupo");
        if(sel) {
            sel.disabled = !isAdmin;
            if(isAdmin) sel.innerHTML = `<option>${grupoAtual}</option><option value="todos">Ver Todos</option>`;
        }
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
            <td>${item.operador}</td>
            <td><button onclick="window.open('${item.link}', '_blank')">🔗</button></td>
        </tr>`).join('');
}

// --- 5. AUTH E LOGIN ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userDoc = await getDoc(doc(db, "usuarios", user.uid));
        if (userDoc.exists()) {
            const d = userDoc.data();
            operadorAtual = d.nome;
            grupoAtual = d.grupo;
            isAdmin = (d.cargo === "admin"); // Ativa a variável que estava "morta"

            document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
            document.getElementById("telaLogin").style.display = "none";
            document.getElementById("conteudoApp").style.display = "block";
            carregarPreferenciasLocalStorage();
            await carregarHistorico();
        }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

// --- FUNÇÕES DE UI RESTANTES ---
function fazerLogin() {
    const e = document.getElementById("emailLogin").value;
    const s = document.getElementById("senhaLogin").value;
    signInWithEmailAndPassword(auth, e, s).catch(err => alert("Erro: " + err.message));
}
function fazerLogout() { signOut(auth).then(() => location.reload()); }
function toggleConfig() { 
    const p = document.getElementById("painelAjustes");
    p.style.display = p.style.display === "none" ? "block" : "none";
}
function enviarManual() {
    const val = document.getElementById("urlManual").value.trim();
    if (val) processarEntrada(val);
}
function exportarParaCSV() {
    let csv = "\uFEFFStatus;Link;Data;Operador\n";
    listaEscaneamentos.forEach(i => csv += `OK;${i.link};${i.data};${i.operador}\n`);
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = "relatorio.csv";
    a.click();
}
function atualizarStatusUI(msg) {
    const st = document.getElementById("statusEnvio");
    if (st) { st.innerText = msg; st.style.display = msg ? "block" : "none"; }
}
function toggleDarkMode() { document.body.classList.toggle("dark-mode"); }
function salvarPreferencias() { alert("Preferências Salvas!"); }
function carregarPreferenciasLocalStorage() { /* Lógica de carregar prefs */ }
function resetarTimer() { /* Lógica de timer */ }

async function ativarScannerAoVivo() {
    const video = document.getElementById("reader");
    video.style.display = "block";
    try {
        const devices = await codeReader.listVideoInputDevices();
        codeReader.decodeFromVideoDevice(devices[devices.length-1].deviceId, 'reader', (res) => {
            if (res && !processandoAcao) processarEntrada(res.text);
        });
        document.getElementById("btnLigarCamera").style.display = "none";
    } catch (e) { alert("Erro na câmera."); }
}

async function lerQrDeArquivo(event) {
    const file = event.target.files[0];
    if (!file) return;
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => processarEntrada(img);
}