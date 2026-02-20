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

// Inicialização
const codeReader = new ZXing.BrowserQRCodeReader();
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- VARIÁVEIS GLOBAIS ---
let operadorAtual = "";
let grupoAtual = "";
let isAdmin = false; 
let processandoBipe = false; 
let listaEscaneamentos = [];
let videoTrack = null; // Para controlar a lanterna
let lanternaLigada = false;

// --- MONITOR DE ACESSO (LOGIN) ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            if (userDoc.exists()) {
                const dados = userDoc.data();
                if (!dados.aprovado) { alert("Aguarde aprovação."); signOut(auth); return; }
                
                operadorAtual = dados.nome;
                grupoAtual = dados.grupo;
                isAdmin = dados.cargo === "admin"; 

                document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
                
                // Configuração de interface pós-login
                document.getElementById("telaLogin").style.display = "none";
                document.getElementById("conteudoApp").style.display = "block";
                
                iniciarScanner();
                carregarHistorico();
            }
        } catch (e) { console.error("Erro no login:", e); }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

// --- MOTOR ZXING COM SUPORTE A LANTERNA ---
async function iniciarScanner() {
    try {
        codeReader.reset();
        const videoInputDevices = await codeReader.listVideoInputDevices();
        if (videoInputDevices.length === 0) return;

        // Tenta pegar a câmera traseira
        let selectedDeviceId = videoInputDevices[videoInputDevices.length - 1].deviceId;
        
        // Inicia o stream para capturar o "Track" da lanterna
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { deviceId: selectedDeviceId, facingMode: "environment" } 
        });
        
        // Atribui o stream ao elemento de vídeo e guarda o track para a lanterna
        const videoElement = document.getElementById('reader');
        videoElement.srcObject = stream;
        videoTrack = stream.getVideoTracks()[0];

        // Inicia decodificação do ZXing
        codeReader.decodeFromVideoElement(videoElement, (result, err) => {
            if (result && !processandoBipe) {
                onScanSuccess(result.text); 
            }
        });

    } catch (e) { console.error("Erro Scanner:", e); }
}

// --- FUNÇÃO DA LANTERNA ---
window.toggleLanterna = async function() {
    if (!videoTrack) return;
    try {
        const capabilities = videoTrack.getCapabilities();
        if (!capabilities.torch) {
            alert("Lanterna não disponível nesta câmera.");
            return;
        }
        lanternaLigada = !lanternaLigada;
        await videoTrack.applyConstraints({ advanced: [{ torch: lanternaLigada }] });
        const btn = document.getElementById("btnLanterna");
        btn.innerText = lanternaLigada ? "❌ DESLIGAR LUZ" : "🔦 LIGAR LANTERNA";
        btn.style.background = lanternaLigada ? "#e74c3c" : "#f1c40f";
    } catch (e) { console.error("Erro Lanterna:", e); }
};

// --- SAÍDA DE EMERGÊNCIA: ENVIO MANUAL ---
window.enviarManual = async function() {
    const input = document.getElementById("urlManual");
    const texto = input.value.trim();
    if (texto.length < 5) {
        alert("Cole uma URL ou código válido.");
        return;
    }
    await onScanSuccess(texto);
    input.value = ""; // Limpa o campo
    alert("✅ Enviado com sucesso!");
};

// --- LOGICA DE SALVAMENTO ---
async function onScanSuccess(texto) {
    if (processandoBipe) return;
    processandoBipe = true;

    try {
        const q = query(collection(db, "scans"), where("link", "==", texto.trim()), where("grupo", "==", grupoAtual));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            alert("⚠️ Já registrado!");
            processandoBipe = false;
            return;
        }

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
    } catch (e) { alert("Erro: " + e.message); }
    
    // Trava de 2 segundos para não duplicar bipe
    setTimeout(() => { processandoBipe = false; }, 2000);
}

// --- FUNÇÕES DE INTERFACE ---
window.fazerLogin = function() {
    const email = document.getElementById("emailLogin").value;
    const senha = document.getElementById("senhaLogin").value;
    signInWithEmailAndPassword(auth, email, senha).catch(e => alert("Erro: " + e.message));
};

window.fazerLogout = () => signOut(auth).then(() => location.reload());

window.toggleConfig = () => {
    const p = document.getElementById("painelAjustes");
    p.style.display = p.style.display === "none" ? "block" : "none";
};

async function carregarHistorico() {
    try {
        const q = query(collection(db, "scans"), where("grupo", "==", grupoAtual), orderBy("timestamp", "desc"));
        const snap = await getDocs(q);
        listaEscaneamentos = snap.docs.map(d => d.data());
        atualizarTabela();
    } catch (e) { console.error(e); }
}

function atualizarTabela() {
    const corpo = document.getElementById("corpoTabela");
    if (!corpo) return;
    corpo.innerHTML = listaEscaneamentos.map(item => `
        <tr>
            <td><span style="color: #27ae60;">✅ Ok</span></td>
            <td style="word-break:break-all"><strong>${item.link}</strong></td>
            <td>${item.data}</td>
            <td>${item.operador}</td> 
        </tr>
    `).join('');
}