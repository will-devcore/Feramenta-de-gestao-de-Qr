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
        
        // Motor jsQR para ler os códigos amassados das suas fotos
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
    const telaLogin = document.getElementById("telaLogin");
    const conteudoApp = document.getElementById("conteudoApp");

    if (user) {
        try {
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            if (userDoc.exists()) {
                const dados = userDoc.data();
                operadorAtual = dados.nome;
                grupoAtual = dados.grupo;
                isAdmin = dados.cargo === "admin"; 
                
                document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
                if (telaLogin) telaLogin.style.display = "none";
                if (conteudoApp) conteudoApp.style.display = "block";
                
                iniciarScanner();
                carregarHistorico();
            }
        } catch (e) { console.error("Erro no login:", e); }
    } else {
        if (telaLogin) telaLogin.style.display = "block";
        if (conteudoApp) conteudoApp.style.display = "none";
    }
});

// Funções para o HTML encontrar (window)
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
        const btn = document.getElementById("btnLanterna");
        if(btn) btn.innerText = lanternaLigada ? "❌ DESLIGAR LUZ" : "🔦 LIGAR LANTERNA";
    } catch (e) { alert("Sua câmera não suporta lanterna via navegador."); }
};

window.toggleConfig = () => {
    const p = document.getElementById("painelAjustes");
    if(p) p.style.display = p.style.display === "none" ? "block" : "none";
};

// --- SALVAR NO BANCO ---
async function onScanSuccess(texto) {
    if (processandoBipe) return;
    processandoBipe = true;

    try {
        const q = query(collection(db, "scans"), where("link", "==", texto.trim()), where("grupo", "==", grupoAtual));
        const snap = await getDocs(q);
        if (!snap.empty) {
            alert("⚠️ Já registrado!");
        } else {
            const novoDoc = { 
                link: texto.trim(), 
                data: new Date().toLocaleString('pt-BR'), 
                operador: operadorAtual, 
                grupo: grupoAtual, 
                timestamp: Date.now() 
            };
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
            <td style="word-break:break-all"><strong>${item.link}</strong></td>
            <td>${item.data}</td>
            <td>${item.operador}</td>
            <td><button class="btn-acao">ℹ️</button></td>
        </tr>
    `).join('');
}

async function carregarHistorico() {
    const q = query(collection(db, "scans"), where("grupo", "==", grupoAtual), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    listaEscaneamentos = snap.docs.map(d => d.data());
    atualizarTabela();
}