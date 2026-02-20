import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, getDoc, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
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

// --- VARIÁVEIS GLOBAIS ---
let operadorAtual = "";
let grupoAtual = "";
let isAdmin = false; 
let processandoBipe = false; 
let listaEscaneamentos = [];
let videoTrack = null;
let lanternaLigada = false;
let timerInatividade = null;

// --- MOTOR DE SCANNER (jsQR) ---
function tick() {
    const video = document.getElementById("reader");
    if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        canvas.height = video.videoHeight;
        canvas.width = video.videoWidth;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });

        if (code && !processandoBipe) {
            onScanSuccess(code.data);
        }
    }
    requestAnimationFrame(tick);
}

async function iniciarScanner() {
    const video = document.getElementById("reader");
    if (!video) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment", width: { ideal: 1280 } } 
        });
        video.srcObject = stream;
        videoTrack = stream.getVideoTracks()[0];
        video.setAttribute("playsinline", true);
        video.play();
        requestAnimationFrame(tick);
    } catch (e) { console.error("Erro câmera:", e); }
}

// --- MONITOR DE ACESSO ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userDoc = await getDoc(doc(db, "usuarios", user.uid));
        if (userDoc.exists()) {
            const dados = userDoc.data();
            operadorAtual = dados.nome;
            grupoAtual = dados.grupo;
            isAdmin = dados.cargo === "admin"; 
            document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
            document.getElementById("telaLogin").style.display = "none";
            document.getElementById("conteudoApp").style.display = "block";
            if (isAdmin) carregarGruposDinamicos();
            iniciarScanner();
            carregarHistorico();
            resetarTimerInatividade();
        }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

// --- FUNÇÕES DE INTERFACE (WINDOW) ---
window.fazerLogin = () => {
    const email = document.getElementById("emailLogin").value;
    const senha = document.getElementById("senhaLogin").value;
    signInWithEmailAndPassword(auth, email, senha).catch(e => alert("Erro: " + e.message));
};

window.fazerLogout = () => signOut(auth).then(() => location.reload());

window.toggleLanterna = async () => {
    if (!videoTrack) return;
    try {
        lanternaLigada = !lanternaLigada;
        await videoTrack.applyConstraints({ advanced: [{ torch: lanternaLigada }] });
        document.getElementById("btnLanterna").innerText = lanternaLigada ? "❌ DESLIGAR LUZ" : "🔦 LIGAR LANTERNA";
    } catch (e) { alert("Lanterna não suportada"); }
};

window.toggleConfig = () => {
    const p = document.getElementById("painelAjustes");
    p.style.display = p.style.display === "none" ? "block" : "none";
};

window.toggleDarkMode = () => {
    document.body.classList.toggle("dark-mode");
    localStorage.setItem("modoEscuro", document.body.classList.contains("dark-mode"));
};

window.salvarPreferencias = () => {
    const novoNome = document.getElementById("nomeOperadorTroca").value;
    if (novoNome) operadorAtual = novoNome;
    localStorage.setItem("tempoInatividade", document.getElementById("setInatividade").value);
    alert("Configurações salvas!");
    toggleConfig();
};

window.exportarParaCSV = () => {
    let csv = "Link;Data;Operador;Grupo\n";
    listaEscaneamentos.forEach(i => csv += `${i.link};${i.data};${i.operador};${i.grupo}\n`);
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Relatorio_${new Date().toLocaleDateString()}.csv`;
    link.click();
};

// --- LOGICA DE NEGOCIO ---
async function onScanSuccess(texto) {
    if (processandoBipe) return;
    processandoBipe = true;
    resetarTimerInatividade();
    try {
        const q = query(collection(db, "scans"), where("link", "==", texto.trim()), where("grupo", "==", grupoAtual));
        const snap = await getDocs(q);
        if (!snap.empty) {
            alert("⚠️ Já registrado!");
        } else {
            const novoDoc = { link: texto.trim(), data: new Date().toLocaleString('pt-BR'), operador: operadorAtual, grupo: grupoAtual, timestamp: Date.now() };
            await addDoc(collection(db, "scans"), novoDoc);
            listaEscaneamentos.unshift(novoDoc);
            atualizarTabela();
        }
    } catch (e) { console.error(e); }
    setTimeout(() => { processandoBipe = false; }, 3000);
}

function atualizarTabela() {
    const corpo = document.getElementById("corpoTabela");
    if (!corpo) return;
    corpo.innerHTML = listaEscaneamentos.map(item => `
        <tr>
            <td>✅</td>
            <td style="word-break:break-all">${item.link}</td>
            <td>${item.data}</td>
            <td>${item.operador}</td>
            <td><button onclick="alert('${item.link}')">ℹ️</button></td>
        </tr>
    `).join('');
}

async function carregarHistorico() {
    const q = query(collection(db, "scans"), where("grupo", "==", grupoAtual), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    listaEscaneamentos = snap.docs.map(d => d.data());
    atualizarTabela();
}

function resetarTimerInatividade() {
    if (timerInatividade) clearTimeout(timerInatividade);
    const tempo = parseInt(localStorage.getItem("tempoInatividade")) || 180000;
    if (tempo === 0) return;
    timerInatividade = setTimeout(() => { location.reload(); }, tempo);
}

if (localStorage.getItem("modoEscuro") === "true") document.body.classList.add("dark-mode");