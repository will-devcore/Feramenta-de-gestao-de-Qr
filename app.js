/* * SCANNER QR MASTER - VERSÃO PRO 2.0 BLINDADA (FUSÃO DEFINITIVA)
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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const codeReader = new ZXing.BrowserQRCodeReader();

// --- VARIÁVEIS GLOBAIS ---
let operadorAtual = "";
let grupoAtual = "";
let isAdmin = false; 
let processandoAcao = false; 
let listaEscaneamentos = [];
let timerInatividade;

// Configuração Padrão (MG)
const URL_PADRAO_MG = "https://portalsped.fazenda.mg.gov.br/portalsped/sistema/consultaunificada.xhtml?chaveAcesso=";

// --- 1. VÍNCULOS GLOBAIS (Resolve botões mortos) ---
window.fazerLogin = () => {
    const e = document.getElementById("emailLogin").value;
    const s = document.getElementById("senhaLogin").value;
    signInWithEmailAndPassword(auth, e, s).catch(err => alert("Erro: " + err.message));
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
window.enviarManual = () => {
    const val = document.getElementById("urlManual").value.replace(/\s/g, '');
    if (val) processarEntrada(val);
};
window.gerarRelatorio = () => carregarHistorico();
window.exportarParaCSV = () => exportarDados();
window.ativarScannerAoVivo = () => ligarCamera();
window.lerQrDeArquivo = (e) => processarFoto(e);

// --- 2. NÚCLEO DE INTELIGÊNCIA (OCR + CHAVE) ---

function validarChaveNF(chave) {
    const limpa = chave.replace(/\D/g, '');
    if (limpa.length !== 44) return false;
    let soma = 0, peso = 2;
    for (let i = 42; i >= 0; i--) {
        soma += parseInt(limpa[i]) * peso;
        peso = (peso === 9) ? 2 : peso + 1;
    }
    const resto = soma % 11;
    const dv = (resto === 0 || resto === 1) ? 0 : 11 - resto;
    return dv === parseInt(limpa[43]);
}

function recuperarChaveCompleta(texto) {
    const limpo = texto.replace(/\D/g, '');
    if (limpo.length === 44 && validarChaveNF(limpo)) return limpo;
    // Tenta consertar se faltar 1 dígito (comum em nota amassada)
    if (limpo.length === 43) {
        for (let i = 0; i <= 9; i++) {
            if (validarChaveNF(limpo + i)) return limpo + i;
        }
    }
    return null;
}

function formatarChaveParaExibicao(v) {
    return v.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ').substring(0, 55).trim();
}

// Máscara automática no campo de digitação
document.getElementById("urlManual").oninput = function() {
    this.value = formatarChaveParaExibicao(this.value);
};

// --- 3. PROCESSAMENTO DE ENTRADA ---

async function processarEntrada(textoBruto) {
    if (processandoAcao) return;
    processandoAcao = true;
    
    const chaveRecuperada = recuperarChaveCompleta(textoBruto);

    if (chaveRecuperada) {
        const linkFinal = URL_PADRAO_MG + chaveRecuperada;
        await salvarNoFirebase(linkFinal);
        document.getElementById("urlManual").value = "";
    } else {
        alert("❌ Chave inválida ou incompleta. Verifique a nota.");
        document.getElementById("urlManual").focus();
    }
    
    setTimeout(() => { processandoAcao = false; }, 1000);
}

async function salvarNoFirebase(link) {
    try {
        const q = query(collection(db, "scans"), where("link", "==", link), where("grupo", "==", grupoAtual));
        const snap = await getDocs(q);
        if (!snap.empty) return alert("⚠️ Esta nota já foi registrada por seu grupo!");

        await addDoc(collection(db, "scans"), {
            link: link,
            data: new Date().toLocaleString('pt-BR'),
            operador: operadorAtual,
            grupo: grupoAtual,
            timestamp: Date.now()
        });
        
        alert("✅ Nota salva com sucesso!");
        await carregarHistorico();
    } catch (e) { alert("Erro ao salvar."); }
}

// --- 4. MONITOR DE ACESSO E INTERFACE ---

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userDoc = await getDoc(doc(db, "usuarios", user.uid));
        if (userDoc.exists()) {
            const d = userDoc.data();
            operadorAtual = d.nome;
            grupoAtual = d.grupo;
            isAdmin = (d.cargo === "admin"); // Agora isAdmin volta a funcionar!

            document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
            document.getElementById("telaLogin").style.display = "none";
            document.getElementById("conteudoApp").style.display = "block";
            
            configurarFiltrosAdmin();
            await carregarHistorico();
            resetarTimer();
        }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

function configurarFiltrosAdmin() {
    const sel = document.getElementById("filtroGrupo");
    if (isAdmin) {
        sel.disabled = false;
        // Carrega outros grupos se necessário, ou mantém o atual e opção 'todos'
        sel.innerHTML = `<option value="${grupoAtual}">${grupoAtual}</option><option value="todos">-- TODOS OS GRUPOS --</option>`;
    } else {
        sel.innerHTML = `<option value="${grupoAtual}">${grupoAtual}</option>`;
        sel.disabled = true;
    }
}

async function carregarHistorico() {
    const grupoFiltro = document.getElementById("filtroGrupo").value;
    try {
        let q;
        if (grupoFiltro === "todos" && isAdmin) {
            q = query(collection(db, "scans"), orderBy("timestamp", "desc"), limit(50));
        } else {
            q = query(collection(db, "scans"), where("grupo", "==", grupoAtual), orderBy("timestamp", "desc"), limit(30));
        }
        const snap = await getDocs(q);
        listaEscaneamentos = snap.docs.map(doc => doc.data());
        atualizarTabela();
    } catch (e) { console.error("Erro histórico:", e); }
}

function atualizarTabela() {
    const corpo = document.getElementById("corpoTabela");
    corpo.innerHTML = listaEscaneamentos.map(i => `
        <tr>
            <td>✅</td>
            <td style="font-size:12px">${i.link.split('chaveAcesso=')[1] || i.link}</td>
            <td>${i.data.split(' ')[0]}</td>
            <td>${i.operador}</td>
            <td><button onclick="window.open('${i.link}', '_blank')">🔗</button></td>
        </tr>`).join('');
}

// --- 5. FUNÇÕES DE DISPOSITIVO ---

async function ligarCamera() {
    const video = document.getElementById("reader");
    video.style.display = "block";
    try {
        const devices = await codeReader.listVideoInputDevices();
        const sid = devices[devices.length - 1].deviceId;
        codeReader.decodeFromVideoDevice(sid, 'reader', (res) => {
            if (res && !processandoAcao) processarEntrada(res.text);
        });
        document.getElementById("btnLigarCamera").style.display = "none";
    } catch (e) { alert("Câmera indisponível."); }
}

async function processarFoto(event) {
    const file = event.target.files[0];
    if (!file) return;
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = async () => {
        try {
            const res = await codeReader.decodeFromImageElement(img);
            processarEntrada(res.text);
        } catch (e) {
            // Se falhar o QR, tenta OCR básico nos números
            const { data: { text } } = await Tesseract.recognize(img, 'por');
            processarEntrada(text);
        }
    };
}

function exportarDados() {
    let csv = "\uFEFFLink;Data;Operador\n";
    listaEscaneamentos.forEach(i => csv += `${i.link};${i.data};${i.operador}\n`);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = "relatorio_qr.csv";
    a.click();
}

function resetarTimer() {
    clearTimeout(timerInatividade);
    timerInatividade = setTimeout(() => {
        codeReader.reset();
        document.getElementById("reader").style.display = "none";
        document.getElementById("btnLigarCamera").style.display = "block";
    }, 300000); // 5 minutos
}

window.salvarPreferencias = () => {
    localStorage.setItem('prefsQR', JSON.stringify({ darkMode: document.body.classList.contains('dark-mode') }));
    alert("Preferências salvas!");
};