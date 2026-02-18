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

let operadorAtual = "";
let grupoAtual = "";
let listaEscaneamentos = [];
let html5QrcodeScanner; 
let timerInatividade; 
let tempoInatividadeMS = 180000; 

// --- LOGIN ---
window.fazerLogin = function() {
    const email = document.getElementById("emailLogin").value;
    const senha = document.getElementById("senhaLogin").value;
    signInWithEmailAndPassword(auth, email, senha).catch(e => alert("Erro: " + e.message));
};

window.fazerLogout = () => signOut(auth).then(() => location.reload());

// --- MONITOR DE ACESSO ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userDoc = await getDoc(doc(db, "usuarios", user.uid));
        if (userDoc.exists()) {
            const dados = userDoc.data();
            if (!dados.aprovado) { alert("Aguarde aprovação."); signOut(auth); return; }
            operadorAtual = dados.nome;
            grupoAtual = dados.grupo;
            document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
            document.getElementById("telaLogin").style.display = "none";
            document.getElementById("conteudoApp").style.display = "block";
            
            // 1. Recupera as configurações salvas no celular antes de ligar a câmera
            carregarConfiguracoesSalvas();
            // 2. Inicia o scanner e o histórico
            iniciarScanner();
            carregarHistorico();
        }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

// --- MEMÓRIA DAS CONFIGURAÇÕES ---
function carregarConfiguracoesSalvas() {
    const fpsSalvo = localStorage.getItem("scannerFPS");
    const inatividadeSalva = localStorage.getItem("scannerInatividade");
    if (fpsSalvo) document.getElementById("setFPS").value = fpsSalvo;
    if (inatividadeSalva) document.getElementById("setInatividade").value = inatividadeSalva;
}

// --- LÓGICA DE ECONOMIA ---
function resetarTimerInatividade() {
    if (timerInatividade) clearTimeout(timerInatividade);
    if (tempoInatividadeMS === 0) return;
    timerInatividade = setTimeout(() => {
        if (html5QrcodeScanner) {
            html5QrcodeScanner.clear().then(() => {
                document.getElementById("reader").innerHTML = `
                    <div style="text-align:center; padding: 25px; border: 2px dashed #ff9800; border-radius: 10px; background: #fff5e6; color: #333;">
                        <p>🔋 <strong>Modo de Economia</strong></p>
                        <button onclick="window.location.reload()" style="background:#27ae60; color:white; border:none; padding:10px; border-radius:5px; cursor:pointer;">🔄LIGAR CÂMERA</button>
                    </div>`;
            });
        }
    }, tempoInatividadeMS); 
}

// --- SCANNER ---
function iniciarScanner() {
    const fpsDesejado = parseInt(document.getElementById("setFPS").value) || 25;
    tempoInatividadeMS = parseInt(document.getElementById("setInatividade").value);

    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().catch(e => console.log("Limpando..."));
    }

    let boxSize = 250;
    if (fpsDesejado >= 35) boxSize = 300;

    const config = { fps: fpsDesejado, qrbox: { width: boxSize, height: boxSize }, aspectRatio: 1.0 };
    html5QrcodeScanner = new Html5QrcodeScanner("reader", config, false);
    html5QrcodeScanner.render(onScanSuccess);
    resetarTimerInatividade();
}

// --- SUCESSO NO SCAN (CORRIGIDO PARA MOSTRAR NA LISTA) ---
async function onScanSuccess(texto) {
    resetarTimerInatividade();

    // Trava de Duplicados
    const q = query(collection(db, "scans"), where("link", "==", texto), where("grupo", "==", grupoAtual));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
        alert("⚠️ Já registrado pelo grupo!");
        return;
    }

    const status = document.getElementById("statusEnvio");
    status.style.display = "block";

    try {
        const novoDoc = {
            link: texto,
            data: new Date().toLocaleString('pt-BR'),
            operador: operadorAtual,
            grupo: grupoAtual,
            timestamp: Date.now()
        };

        // 1. Salva no Firebase
        await addDoc(collection(db, "scans"), novoDoc);
        
        // 2. ADICIONA NA LISTA LOCAL PARA APARECER NA TABELA NA HORA
        listaEscaneamentos.unshift(novoDoc);
        
        // 3. ATUALIZA A TABELA VISUAL
        atualizarTabela();
        
        alert("✅ Salvo!");
    } catch (e) {
        alert("Erro: " + e.message);
    } finally {
        status.style.display = "none";
    }
}

// --- INTERFACE ---
window.toggleConfig = () => {
    const p = document.getElementById("painelAjustes");
    p.style.display = p.style.display === "none" ? "block" : "none";
};

window.salvarPreferencias = () => {
    const fps = document.getElementById("setFPS").value;
    const inatividade = document.getElementById("setInatividade").value;
    
    // Salva permanentemente no celular
    localStorage.setItem("scannerFPS", fps);
    localStorage.setItem("scannerInatividade", inatividade);

    document.getElementById("painelAjustes").style.display = "none";
    iniciarScanner();
    alert("⚙️ Configurações salvas!");
};

window.toggleDarkMode = () => {
    document.body.classList.toggle("dark-mode");
    localStorage.setItem("modoEscuro", document.body.classList.contains("dark-mode"));
};

// --- HISTÓRICO E TABELA ---
async function carregarHistorico() {
    const q = query(collection(db, "scans"), where("grupo", "==", grupoAtual), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    listaEscaneamentos = snap.docs.map(d => d.data());
    atualizarTabela();
}

function atualizarTabela() {
    const corpo = document.getElementById("corpoTabela");
    // Recalibramos as colunas para mostrar Link, Data e o Operador (Grupo)
    corpo.innerHTML = listaEscaneamentos.map(item => `
        <tr>
            <td><span style="color: #27ae60;">✅ Ok</span></td>
            <td style="word-break:break-all"><strong>${item.link}</strong></td>
            <td>${item.data}</td>
            <td>${item.operador} (${item.grupo})</td> 
            <td>
                <button onclick="verDetalhes('${item.timestamp}')" class="btn-acao">ℹ️</button>
            </td>
        </tr>
    `).join('');
}
window.exportarParaCSV = function() {
    let csv = "Link;Data;Operador;Grupo\n";
    listaEscaneamentos.forEach(i => csv += `${i.link};${i.data};${i.operador};${i.grupo}\n`);
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Relatorio_${grupoAtual}.csv`;
    link.click();
};

window.verDetalhes = (id) => {
    const scan = listaEscaneamentos.find(s => s.timestamp == id);
    alert(`QR: ${scan.link}\nData: ${scan.data}\nOperador: ${scan.operador}`);
};

if (localStorage.getItem("modoEscuro") === "true") document.body.classList.add("dark-mode");