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
let tempoInatividadeMS = 180000; // Inicia com 3 minutos padrão

// --- LOGIN ---
window.fazerLogin = function() {
    const email = document.getElementById("emailLogin").value;
    const senha = document.getElementById("senhaLogin").value;
    signInWithEmailAndPassword(auth, email, senha).catch(e => alert("Erro ao entrar: " + e.message));
};

window.fazerLogout = () => signOut(auth).then(() => location.reload());

// --- MONITOR DE ACESSO ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userDoc = await getDoc(doc(db, "usuarios", user.uid));
        if (userDoc.exists()) {
            const dados = userDoc.data();
            if (!dados.aprovado) {
                alert("Aguarde aprovação do Admin.");
                signOut(auth); return;
            }
            operadorAtual = dados.nome;
            grupoAtual = dados.grupo;
            document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
            document.getElementById("telaLogin").style.display = "none";
            document.getElementById("conteudoApp").style.display = "block";
            carregarConfiguracoesSalvas(); // Recupera o que foi salvo antes
            iniciarScanner(); // Agora inicia com os valores recuperados
            carregarHistorico();
        }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

// --- LÓGICA DE ECONOMIA DE ENERGIA ---
function resetarTimerInatividade() {
    if (timerInatividade) clearTimeout(timerInatividade);
    
    // Se o tempo for 0, o modo de economia está desativado
    if (tempoInatividadeMS === 0) return;

    timerInatividade = setTimeout(() => {
        if (html5QrcodeScanner) {
            html5QrcodeScanner.clear().then(() => {
                const readerDiv = document.getElementById("reader");
                readerDiv.innerHTML = `
                    <div style="text-align:center; padding: 25px; border: 2px dashed #ff9800; border-radius: 10px; background: #fff5e6; color: #333;">
                        <p style="font-size: 1.2rem;">🔋 <strong>Modo de Economia</strong></p>
                        <p>A câmera foi desligada para poupar bateria.</p>
                        <button onclick="window.location.reload()" style="background:#27ae60; color:white; border:none; padding:12px 25px; border-radius:5px; cursor:pointer; font-weight:bold;">🔄 LIGAR CÂMERA</button>
                    </div>
                `;
            }).catch(e => console.log("Erro ao limpar scanner:", e));
        }
    }, tempoInatividadeMS); 
}

function carregarConfiguracoesSalvas() {
    const fpsSalvo = localStorage.getItem("scannerFPS");
    const inatividadeSalva = localStorage.getItem("scannerInatividade");

    // Se houver algo salvo, aplica nos campos do HTML antes de iniciar o scanner
    if (fpsSalvo) {
        document.getElementById("setFPS").value = fpsSalvo;
    }
    if (inatividadeSalva) {
        document.getElementById("setInatividade").value = inatividadeSalva;
    }
}

// --- SCANNER PRINCIPAL ---
function iniciarScanner() {
    // Busca FPS e Tempo de Inatividade direto dos elementos do HTML
    const fpsDesejado = parseInt(document.getElementById("setFPS").value) || 25;
    tempoInatividadeMS = parseInt(document.getElementById("setInatividade").value);

    // Limpa scanner anterior se existir para evitar travamento de câmera
    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().catch(e => console.log("Limpando..."));
    }

    // Ajusta o tamanho da caixa de leitura baseado na potência
    let boxSize = 250;
    if (fpsDesejado >= 25) boxSize = 280;
    if (fpsDesejado >= 35) boxSize = 300;

    const config = { 
        fps: fpsDesejado, 
        qrbox: { width: boxSize, height: boxSize }, 
        aspectRatio: 1.0 
    };
    
    html5QrcodeScanner = new Html5QrcodeScanner("reader", config, false);
    html5QrcodeScanner.render(onScanSuccess);

    resetarTimerInatividade();
}

async function onScanSuccess(texto) {
    resetarTimerInatividade(); // Se leu, reseta o tempo de desligamento

    const q = query(collection(db, "scans"), where("link", "==", texto), where("grupo", "==", grupoAtual));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
        alert("⚠️ Este código já foi registrado pelo seu grupo!");
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

        await addDoc(collection(db, "scans"), novoDoc);
        listaEscaneamentos.unshift(novoDoc);
        atualizarTabela();
        alert("✅ Registro salvo com sucesso!");
    } catch (e) {
        alert("Erro ao salvar no banco: " + e.message);
    } finally {
        status.style.display = "none";
    }
}

// --- CONFIGURAÇÕES E INTERFACE ---

window.toggleConfig = () => {
    const p = document.getElementById("painelAjustes");
    p.style.display = p.style.display === "none" ? "block" : "none";
};

window.salvarPreferencias = () => {
    const fps = document.getElementById("setFPS").value;
    const inatividade = document.getElementById("setInatividade").value;

    // Salva na memória do navegador (localStorage)
    localStorage.setItem("scannerFPS", fps);
    localStorage.setItem("scannerInatividade", inatividade);

    document.getElementById("painelAjustes").style.display = "none";
    iniciarScanner();
    alert("⚙️ Configurações salvas permanentemente!");
};

window.toggleDarkMode = () => {
    document.body.classList.toggle("dark-mode");
    const isDark = document.body.classList.contains("dark-mode");
    localStorage.setItem("modoEscuro", isDark);
};

// Carregar modo escuro ao abrir
if (localStorage.getItem("modoEscuro") === "true") {
    document.body.classList.add("dark-mode");
}

// --- HISTÓRICO E TABELA ---

async function carregarHistorico() {
    const q = query(
        collection(db, "scans"), 
        where("grupo", "==", grupoAtual), 
        orderBy("timestamp", "desc")
    );
    const snap = await getDocs(q);
    listaEscaneamentos = snap.docs.map(d => d.data());
    atualizarTabela();
}

function atualizarTabela() {
    const corpo = document.getElementById("corpoTabela");
    corpo.innerHTML = listaEscaneamentos.map(item => `
        <tr>
            <td><span style="color: #27ae60;">✅ Sincronizado</span></td>
            <td style="word-break:break-all"><strong>${item.link}</strong></td>
            <td>${item.data}</td>
            <td>${item.operador} (${item.grupo})</td> 
            <td><button onclick="verDetalhes('${item.timestamp}')" class="btn-acao">ℹ️</button></td>
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
    alert(`Detalhes do Registro:\n\nQR: ${scan.link}\nData: ${scan.data}\nResponsável: ${scan.operador}`);
};