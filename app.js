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

                // 1. Atualiza a interface IMEDIATAMENTE
                document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
                document.getElementById("telaLogin").style.display = "none";
                document.getElementById("conteudoApp").style.display = "block";
                
                // 2. Carrega os dados do Firebase ANTES da câmera
                console.log("Sincronizando dados...");
                await carregarHistorico();
                await carregarGruposDinamicos(); 
                await window.carregarOperadoresDoGrupo();

                // 3. SOLUÇÃO PARA CÂMERA PRETA: 
                // Aguarda 1.5 segundos para garantir que a interface montou e as permissões estão prontas
                setTimeout(() => {
                    iniciarScanner();
                }, 1500); 
            }
        } catch (e) { console.error("Erro no login:", e); }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

// --- MOTOR SCANNER COM TRATAMENTO DE ERRO ---
async function iniciarScanner() {
    try {
        // Reseta qualquer tentativa anterior travada
        await codeReader.reset();
        
        const devices = await codeReader.listVideoInputDevices();
        if (devices.length === 0) {
            console.warn("Nenhuma câmera encontrada.");
            return;
        }

        // Seleciona a câmera traseira
        const selectedId = devices[devices.length - 1].deviceId;
        
        // Configurações para forçar o navegador a "acordar" a câmera
        const constraints = { 
            video: { 
                deviceId: { ideal: selectedId },
                facingMode: "environment",
                width: { ideal: 1280 }
            } 
        };

        // Solicita o stream explicitamente
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const videoElement = document.getElementById('reader');
        
        if (videoElement) {
            videoElement.srcObject = stream;
            videoTrack = stream.getVideoTracks()[0];
            
            // Inicia a leitura do ZXing no elemento de vídeo
            codeReader.decodeFromVideoElement(videoElement, (result, err) => {
                if (result && !processandoBipe) {
                    onScanSuccess(result.text); 
                }
            });
        }
    } catch (e) {
        console.error("Falha ao iniciar câmera:", e);
        // Se der erro de câmera, os grupos e operadores CONTINUAM funcionando
    }
}

// --- FUNÇÃO PARA GARANTIR OS GRUPOS (PARA ADMIN E OPERADOR) ---
async function carregarGruposDinamicos() {
    const selectGrupo = document.getElementById("filtroGrupo");
    if (!selectGrupo) return;

    try {
        if (!isAdmin) {
            // Se não for admin, trava no grupo dele
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
    } catch (e) { console.error("Erro nos grupos:", e); }
}

// --- ATUALIZAR A TABELA NA TELA ---
function atualizarTabela() {
    const corpo = document.getElementById("corpoTabela");
    if (!corpo) return;

    if (listaEscaneamentos.length === 0) {
        corpo.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">Nenhum registro encontrado.</td></tr>';
        return;
    }

    corpo.innerHTML = listaEscaneamentos.map(item => `
        <tr>
            <td><span style="color: #27ae60; font-weight: bold;">✅ Ok</span></td>
            <td style="word-break:break-all; font-size: 0.8rem;"><strong>${item.link}</strong></td>
            <td style="white-space: nowrap;">${item.data}</td>
            <td>${item.operador}</td> 
            <td><button onclick="alert('${item.link}')" style="border:none; background:none; cursor:pointer;">ℹ️</button></td>
        </tr>
    `).join('');
}