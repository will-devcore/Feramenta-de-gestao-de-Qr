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

// ... (Mantenha seus imports e firebaseConfig no topo)

const codeReader = new ZXing.BrowserQRCodeReader();
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let operadorAtual = "";
let grupoAtual = "";
let isAdmin = false; 
let processandoBipe = false; 
let listaEscaneamentos = [];
let videoTrack = null;

// --- MONITOR DE ACESSO ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            if (userDoc.exists()) {
                const dados = userDoc.data();
                operadorAtual = dados.nome;
                grupoAtual = dados.grupo;
                isAdmin = dados.cargo === "admin"; 

                // 1. Atualiza interface básica
                document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
                document.getElementById("telaLogin").style.display = "none";
                document.getElementById("conteudoApp").style.display = "block";
                
                // 2. Carrega dados primeiro (Independente da câmera)
                console.log("Carregando dados do Firebase...");
                await carregarHistorico();
                await carregarGruposDinamicos(); // Garante que grupos apareçam
                await window.carregarOperadoresDoGrupo(); // Garante que operadores apareçam

                // 3. Só depois tenta a câmera (Se falhar, os dados já estão na tela)
                setTimeout(() => {
                    iniciarScanner().catch(err => {
                        console.warn("Câmera não iniciada, mas dados carregados.", err);
                    });
                }, 1000); 
            }
        } catch (e) { console.error("Erro no fluxo de login:", e); }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

// --- MOTOR SCANNER (REVISADO PARA CELULAR) ---
async function iniciarScanner() {
    try {
        codeReader.reset();
        const devices = await codeReader.listVideoInputDevices();
        if (devices.length === 0) return;

        // No celular, sempre tentamos a ÚLTIMA câmera (Traseira)
        const selectedId = devices[devices.length - 1].deviceId;
        
        // Configuração para forçar foco e resolução no celular
        const constraints = { 
            video: { 
                deviceId: { exact: selectedId },
                facingMode: "environment"
            } 
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const videoElement = document.getElementById('reader');
        videoElement.srcObject = stream;
        videoTrack = stream.getVideoTracks()[0];

        codeReader.decodeFromVideoElement(videoElement, (result, err) => {
            if (result && !processandoBipe) {
                onScanSuccess(result.text); 
            }
        });
    } catch (e) {
        console.error("Erro ao acessar câmera no celular:", e);
        // Não damos alert aqui para não travar a experiência do usuário
    }
}

// --- CORREÇÃO DOS GRUPOS (PARA NÃO SUMIREM) ---
async function carregarGruposDinamicos() {
    const selectGrupo = document.getElementById("filtroGrupo");
    if (!selectGrupo) return;

    try {
        if (!isAdmin) {
            selectGrupo.innerHTML = `<option value="${grupoAtual}">${grupoAtual}</option>`;
            selectGrupo.disabled = true;
            return;
        }

        const querySnapshot = await getDocs(collection(db, "usuarios"));
        const gruposSet = new Set();
        querySnapshot.forEach(doc => {
            const d = doc.data();
            if (d.grupo) gruposSet.add(d.grupo);
        });

        let opcoes = '<option value="todos">-- TODOS OS GRUPOS --</option>';
        gruposSet.forEach(g => { opcoes += `<option value="${g}">${g}</option>`; });
        selectGrupo.innerHTML = opcoes;
        selectGrupo.disabled = false;
    } catch (e) { console.error("Erro ao carregar grupos:", e); }
}