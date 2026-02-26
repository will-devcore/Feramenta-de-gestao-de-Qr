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

// --- ESTADO GLOBAL ---
let operadorAtual = "Carregando...";
let grupoAtual = "";
let isAdmin = false; 
let processandoAcao = false; 
let listaEscaneamentos = [];
let timerInatividade;

const URL_PADRAO_MG = "https://portalsped.fazenda.mg.gov.br/portalsped/sistema/consultaunificada.xhtml?chaveAcesso=";
let urlConfigurada = URL_PADRAO_MG;

// --- 1. VÍNCULOS COM O HTML (WINDOW) ---
window.fazerLogin = () => {
    const e = document.getElementById("emailLogin").value;
    const s = document.getElementById("senhaLogin").value;
    signInWithEmailAndPassword(auth, e, s).catch(err => alert("Erro: " + err.message));
};
window.fazerLogout = () => { 
    localStorage.removeItem('prefsQR'); 
    signOut(auth).then(() => location.reload()); 
};
window.toggleConfig = () => {
    const p = document.getElementById("painelAjustes");
    p.style.display = p.style.display === "none" ? "block" : "none";
};
window.toggleDarkMode = () => {
    document.body.classList.toggle("dark-mode");
    window.salvarPreferencias();
};

// --- 2. GESTÃO DE PREFERÊNCIAS E SELEÇÃO RÁPIDA ---

async function carregarListaOperadores() {
    const select = document.getElementById("nomeOperadorTroca");
    if (!select) return;
    try {
        const q = query(collection(db, "usuarios"), where("grupo", "==", grupoAtual));
        const snap = await getDocs(q);
        let opcoes = `<option value="">-- Selecione seu Nome --</option>`;
        snap.forEach(doc => {
            const nome = doc.data().nome;
            opcoes += `<option value="${nome}" ${nome === operadorAtual ? 'selected' : ''}>${nome}</option>`;
        });
        select.innerHTML = opcoes;
    } catch (e) { console.error("Erro ao carregar nomes:", e); }
}

window.salvarPreferencias = () => {
    const nomeSel = document.getElementById("nomeOperadorTroca").value;
    const urlSel = document.getElementById("inputURLSefaz").value;
    const tempoSel = document.getElementById("setInatividade").value;
    const darkMode = document.body.classList.contains('dark-mode');

    const prefs = {
        nome: nomeSel || operadorAtual,
        url: urlSel || URL_PADRAO_MG,
        tempo: tempoSel,
        dark: darkMode
    };

    localStorage.setItem('prefsQR', JSON.stringify(prefs));
    operadorAtual = prefs.nome;
    urlConfigurada = prefs.url;
    
    document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
    alert("✅ Ajustes salvos no dispositivo!");
    resetarTimer();
};

function carregarPreferenciasLocais() {
    const salvas = localStorage.getItem('prefsQR');
    if (salvas) {
        const p = JSON.parse(salvas);
        operadorAtual = p.nome;
        urlConfigurada = p.url || URL_PADRAO_MG;
        if (p.dark) document.body.classList.add('dark-mode');
        
        if(document.getElementById("setInatividade")) document.getElementById("setInatividade").value = p.tempo || "180000";
        if(document.getElementById("inputURLSefaz")) document.getElementById("inputURLSefaz").value = urlConfigurada;
    }
}

// --- 3. MONITOR DE ACESSO (FIREBASE) ---

onAuthStateChanged(auth, async (user) => {
    carregarPreferenciasLocais(); 

    if (user) {
        const userDoc = await getDoc(doc(db, "usuarios", user.uid));
        if (userDoc.exists()) {
            const d = userDoc.data();
            grupoAtual = d.grupo;
            isAdmin = (d.cargo === "admin");

            // Se for a primeira vez ou estiver vazio, usa o nome do cadastro
            if (operadorAtual === "Carregando...") {
                operadorAtual = d.nome;
            }

            await carregarListaOperadores(); // Popula o Select de Nomes

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

// --- 4. MOTOR DE CAPTURA E RECONSTRUÇÃO ---

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

async function processarEntrada(texto) {
    if (processandoAcao) return;
    processandoAcao = true;

    const limpo = texto.replace(/\D/g, '');
    let chaveFinal = null;

    // Lógica de Recuperação de Chave Completa (44 ou 43 dígitos)
    if (limpo.length === 44 && validarChaveNF(limpo)) chaveFinal = limpo;
    else if (limpo.length === 43) {
        for (let i = 0; i <= 9; i++) {
            if (validarChaveNF(limpo + i)) { chaveFinal = limpo + i; break; }
        }
    }

    if (chaveFinal) {
        const link = urlConfigurada + chaveFinal;
        await salvarNoFirebase(link);
    } else {
        alert("❌ Chave inválida! O sistema detectou apenas: " + limpo.length + " dígitos.");
    }
    processandoAcao = false;
}

async function salvarNoFirebase(link) {
    try {
        const q = query(collection(db, "scans"), where("link", "==", link), where("grupo", "==", grupoAtual));
        const snap = await getDocs(q);
        if (!snap.empty) return alert("⚠️ Nota já registrada por este grupo!");

        await addDoc(collection(db, "scans"), {
            link: link,
            data: new Date().toLocaleString('pt-BR'),
            operador: operadorAtual,
            grupo: grupoAtual,
            timestamp: Date.now()
        });
        
        // Alerta sonoro ou feedback visual
        const status = document.getElementById("statusEnvio");
        if(status) { status.innerText = "✅ SALVO!"; status.style.display="block"; setTimeout(()=>status.style.display="none", 1500); }
        
        document.getElementById("urlManual").value = "";
        await carregarHistorico();
    } catch (e) { alert("Erro ao salvar."); }
}

// --- 5. INTERFACE E DISPOSITIVOS ---

window.ativarScannerAoVivo = async () => {
    const video = document.getElementById("reader");
    video.style.display = "block";
    try {
        const devices = await codeReader.listVideoInputDevices();
        codeReader.decodeFromVideoDevice(devices[devices.length - 1].deviceId, 'reader', (res) => {
            if (res && !processandoAcao) processarEntrada(res.text);
        });
        document.getElementById("btnLigarCamera").style.display = "none";
    } catch (e) { alert("Câmera indisponível."); }
};

window.lerQrDeArquivo = (e) => {
    const file = e.target.files[0];
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = async () => {
        try {
            const res = await codeReader.decodeFromImageElement(img);
            processarEntrada(res.text);
        } catch {
            const { data: { text } } = await Tesseract.recognize(img, 'por');
            processarEntrada(text);
        }
    };
};

async function carregarHistorico() {
    const g = document.getElementById("filtroGrupo").value;
    const q = (g === "todos" && isAdmin) ? 
        query(collection(db, "scans"), orderBy("timestamp", "desc"), limit(50)) :
        query(collection(db, "scans"), where("grupo", "==", grupoAtual), orderBy("timestamp", "desc"), limit(30));
    
    const snap = await getDocs(q);
    listaEscaneamentos = snap.docs.map(d => d.data());
    const corpo = document.getElementById("corpoTabela");
    corpo.innerHTML = listaEscaneamentos.map(i => `
        <tr>
            <td style="color: green">✅</td>
            <td style="font-size:11px; font-family: monospace;">${i.link.substring(i.link.length - 44)}</td>
            <td>${i.data.split(' ')[0]}</td>
            <td>${i.operador}</td>
            <td><button class="btn-tabela" onclick="window.open('${i.link}', '_blank')">🔗</button></td>
        </tr>`).join('');
}

function configurarFiltrosAdmin() {
    const sel = document.getElementById("filtroGrupo");
    if (isAdmin) {
        sel.innerHTML = `<option value="${grupoAtual}">${grupoAtual}</option><option value="todos">Todos os Grupos</option>`;
        sel.disabled = false;
    } else {
        sel.innerHTML = `<option>${grupoAtual}</option>`;
        sel.disabled = true;
    }
}

window.gerarRelatorio = () => carregarHistorico();
window.enviarManual = () => {
    const val = document.getElementById("urlManual").value.replace(/\s/g, '');
    if (val) processarEntrada(val);
};

window.exportarParaCSV = () => {
    let csv = "\uFEFFLink;Data;Operador;Grupo\n";
    listaEscaneamentos.forEach(i => csv += `${i.link};${i.data};${i.operador};${i.grupo}\n`);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Relatorio_${grupoAtual}.csv`;
    a.click();
};

function resetarTimer() {
    clearTimeout(timerInatividade);
    const t = parseInt(document.getElementById("setInatividade").value);
    if (t > 0) {
        timerInatividade = setTimeout(() => {
            codeReader.reset();
            document.getElementById("reader").style.display = "none";
            document.getElementById("btnLigarCamera").style.display = "block";
            document.getElementById("btnLigarCamera").innerText = "🚀 CÂMERA EM REPOUSO (TOQUE P/ VOLTAR)";
        }, t);
    }
}

document.addEventListener("click", resetarTimer);

// Máscara Visual para o campo manual
document.getElementById("urlManual").oninput = function() {
    this.value = this.value.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ').substring(0, 55);
};