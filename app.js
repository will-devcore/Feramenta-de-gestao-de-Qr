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

// --- INICIALIZAÇÃO ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const codeReader = new ZXing.BrowserQRCodeReader();

// --- VARIÁVEIS GLOBAIS (Sempre no topo) ---
let operadorAtual = "";
let grupoAtual = "";
let isAdmin = false; 
let processandoBipe = false; 
let listaEscaneamentos = [];
let timerInatividade;

// --- FUNÇÃO DE MEMÓRIA (Recuperar preferências) ---
function aplicarPreferenciasSalvas() {
    const prefsSalvas = JSON.parse(localStorage.getItem('prefsQR') || '{}');
    
    if (prefsSalvas.darkMode) {
        document.body.classList.add('dark-mode');
    }
    
    if (prefsSalvas.tempoInatividade) {
        const select = document.getElementById("setInatividade");
        if (select) select.value = prefsSalvas.tempoInatividade;
    }
    
    if (prefsSalvas.nomePersonalizado) {
        operadorAtual = prefsSalvas.nomePersonalizado;
        const inputNome = document.getElementById("nomeOperadorTroca");
        if (inputNome) inputNome.value = operadorAtual;
    }
}

// --- MONITOR DE ACESSO ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            if (userDoc.exists()) {
                const dados = userDoc.data();
                
                // Aplica dados do banco
                operadorAtual = dados.nome;
                grupoAtual = dados.grupo;
                isAdmin = dados.cargo === "admin"; 

                // Aplica o que estiver no LocalStorage por cima (preferência do usuário)
                aplicarPreferenciasSalvas();

                // Atualiza Interface
                document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
                document.getElementById("telaLogin").style.display = "none";
                document.getElementById("conteudoApp").style.display = "block";
                
                // Carrega dados
                await carregarHistorico();
                await carregarGruposDinamicos();
                if (window.carregarOperadoresDoGrupo) await window.carregarOperadoresDoGrupo();
                
                resetarTimer(); // Inicia o vigia de inatividade
            }
        } catch (e) { console.error("Erro no login:", e); }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

// --- FUNÇÕES EXPOSTAS AO HTML ---

window.fazerLogin = function() {
    const email = document.getElementById("emailLogin").value;
    const senha = document.getElementById("senhaLogin").value;
    signInWithEmailAndPassword(auth, email, senha).catch(e => alert("Erro: " + e.message));
};

window.fazerLogout = () => signOut(auth).then(() => location.reload());

window.toggleConfig = () => {
    const p = document.getElementById("painelAjustes");
    if (p) p.style.display = p.style.display === "none" ? "block" : "none";
};

window.toggleDarkMode = function() {
    document.body.classList.toggle('dark-mode');
    window.salvarPreferencias(); 
};

window.salvarPreferencias = function() {
    const novoNome = document.getElementById("nomeOperadorTroca").value;
    const novoTempo = document.getElementById("setInatividade").value;
    const modoEscuroAtivo = document.body.classList.contains('dark-mode');

    const novasPrefs = {
        nomePersonalizado: novoNome,
        tempoInatividade: novoTempo,
        darkMode: modoEscuroAtivo
    };

    localStorage.setItem('prefsQR', JSON.stringify(novasPrefs));

    if (novoNome) {
        operadorAtual = novoNome;
        document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
    }

    alert("✅ Configurações salvas!");
    resetarTimer(); // Reinicia o timer com o novo tempo
};

window.enviarManual = async function() {
    const input = document.getElementById("urlManual");
    const valor = input.value.trim();
    if (!valor) return;
    const salvouComSucesso = await onScanSuccess(valor);
    if (salvouComSucesso) {
        input.value = "";
        alert("✅ Registro Manual Salvo com Sucesso!");
    }
};

window.gerarRelatorio = async function() {
    const grupoFiltro = document.getElementById("filtroGrupo").value;
    const nomeFiltro = document.getElementById("filtroOperador").value.toLowerCase();
    try {
        let q = (grupoFiltro === "todos") ? 
            query(collection(db, "scans"), orderBy("timestamp", "desc"), limit(100)) : 
            query(collection(db, "scans"), where("grupo", "==", grupoFiltro), orderBy("timestamp", "desc"));

        const snap = await getDocs(q);
        let resultados = snap.docs.map(d => d.data());
        if (nomeFiltro) resultados = resultados.filter(r => r.operador.toLowerCase().includes(nomeFiltro));
        listaEscaneamentos = resultados;
        atualizarTabela();
    } catch (e) { alert("Erro na busca: " + e.message); }
};

window.exportarParaCSV = function() {
    let csv = "Link;Data;Operador;Grupo\n";
    listaEscaneamentos.forEach(i => csv += `${i.link};${i.data};${i.operador};${i.grupo}\n`);
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Relatorio_QR.csv`;
    link.click();
};

window.carregarOperadoresDoGrupo = async function() {
    const select = document.getElementById("filtroGrupo");
    const datalist = document.getElementById("listaOperadoresSugestao");
    if (!select || !datalist) return;
    try {
        const q = (select.value === "todos") ? collection(db, "usuarios") : query(collection(db, "usuarios"), where("grupo", "==", select.value));
        const snap = await getDocs(q);
        datalist.innerHTML = snap.docs.map(d => `<option value="${d.data().nome}">`).join('');
    } catch (e) { console.error(e); }
};

// --- MOTOR INTERNO ---

async function iniciarScanner() {
    try {
        await codeReader.reset();
        const devices = await codeReader.listVideoInputDevices();
        if (devices.length === 0) return;
        const selectedId = devices[devices.length - 1].deviceId;
        codeReader.decodeFromVideoDevice(selectedId, 'reader', (result, err) => {
            if (result && !processandoBipe) onScanSuccess(result.text);
        });
    } catch (e) { console.warn("Câmera indisponível"); }
}

async function onScanSuccess(texto) {
    if (processandoBipe) return false;
    processandoBipe = true;
    const linkLimpo = texto.trim();
    document.getElementById("statusEnvio").style.display = "block";
    try {
        const qDuplicado = query(collection(db, "scans"), where("link", "==", linkLimpo), where("grupo", "==", grupoAtual));
        const snapshotDuplicado = await getDocs(qDuplicado);
        if (!snapshotDuplicado.empty) {
            alert("⚠️ Atenção: Este link já foi registrado anteriormente pelo seu grupo!");
            finalizarProcessamento();
            return false;
        }
        const novoDoc = { link: linkLimpo, data: new Date().toLocaleString('pt-BR'), operador: operadorAtual, grupo: grupoAtual, timestamp: Date.now() };
        await addDoc(collection(db, "scans"), novoDoc);
        listaEscaneamentos.unshift(novoDoc);
        atualizarTabela();
        finalizarProcessamento();
        return true;
    } catch (e) { 
        console.error(e);
        finalizarProcessamento();
        return false;
    }
}

function finalizarProcessamento() {
    setTimeout(() => { 
        processandoBipe = false; 
        document.getElementById("statusEnvio").style.display = "none";
    }, 2000);
}

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

window.lerQrDeArquivo = async function(event) {
    const arquivo = event.target.files[0];
    if (!arquivo) return;
    const status = document.getElementById("statusEnvio");
    if (status) { status.style.display = "block"; status.innerText = "🔍 Analisando imagem..."; }
    try {
        const imagemUrl = URL.createObjectURL(arquivo);
        const img = new Image();
        img.src = imagemUrl;
        img.onload = async () => {
            try {
                const resultado = await codeReader.decodeFromImageElement(img);
                const salvou = await onScanSuccess(resultado.text);
                if (salvou) alert("✅ QR Code identificado!");
            } catch (err) { alert("❌ Não foi possível ler o QR Code."); }
            finally {
                if (status) { status.style.display = "none"; status.innerText = "💾 Processando dados..."; }
                event.target.value = "";
            }
        };
    } catch (e) { console.error(e); }
};

window.ativarScannerAoVivo = async function() {
    const btn = document.getElementById("btnLigarCamera");
    const video = document.getElementById("reader");
    if (!btn || !video) return;
    btn.innerText = "⌛ Iniciando...";
    try {
        video.style.display = "block";
        await iniciarScanner();
        btn.style.display = "none";
    } catch (e) {
        alert("Erro na câmera.");
        btn.innerText = "🚀 LIGAR SCANNER AO VIVO";
    }
};

function resetarTimer() {
    clearTimeout(timerInatividade);
    const select = document.getElementById("setInatividade");
    if (!select) return;
    const tempoDesejado = parseInt(select.value);
    if (tempoDesejado > 0) {
        timerInatividade = setTimeout(() => {
            codeReader.reset();
            const v = document.getElementById("reader");
            const b = document.getElementById("btnLigarCamera");
            if (v) v.style.display = "none";
            if (b) { b.style.display = "block"; b.innerText = "🚀 CÂMERA EM REPOUSO (TOQUE P/ VOLTAR)"; }
        }, tempoDesejado);
    }
}

document.addEventListener("click", resetarTimer);
document.addEventListener("touchstart", resetarTimer);