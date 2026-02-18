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
let html5QrcodeScanner; // Variável global para gerenciar o scanner
let timerEscalonamento; // Variável para o controle de tempo

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
            iniciarScanner(10, 250, "Básico"); // Começa no modo econômico
            carregarHistorico();
        }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

// --- LÓGICA DO SCANNER INTELIGENTE ---
function iniciarScanner(fps, tamanho, nivel) {
    // Se já existir um scanner, limpa ele antes de reiniciar
    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().catch(err => console.error("Erro ao limpar scanner:", err));
    }

    console.log(`Modo: ${nivel} | FPS: ${fps} | Tamanho: ${tamanho}`);
    
    // Atualiza o status visual para o operador (opcional, mostra no console)
    const statusEnvio = document.getElementById("statusEnvio");
    if(nivel !== "Básico") {
        statusEnvio.innerText = `🔍 Dificuldade detectada: Ativando modo ${nivel}...`;
        statusEnvio.style.display = "block";
        setTimeout(() => { if(statusEnvio.innerText.includes("Dificuldade")) statusEnvio.style.display = "none"; }, 2000);
    }

    const config = { 
        fps: fps, 
        qrbox: { width: tamanho, height: tamanho }, 
        aspectRatio: 1.0 
    };

    html5QrcodeScanner = new Html5QrcodeScanner("reader", config, false);
    
    html5QrcodeScanner.render(onScanSuccess);

    // Gerencia o escalonamento automático de tempo
    if (timerEscalonamento) clearTimeout(timerEscalonamento);

    if (nivel === "Básico") {
        timerEscalonamento = setTimeout(() => {
            iniciarScanner(15, 260, "Médio");
        }, 6000); // Se não ler em 6 segundos, vai pro Médio
    } else if (nivel === "Médio") {
        timerEscalonamento = setTimeout(() => {
            iniciarScanner(25, 280, "Ultra Fogo");
        }, 7000); // Se passar mais 7 segundos, vai pro Ultra
    }
}

async function onScanSuccess(texto) {
    if (timerEscalonamento) clearTimeout(timerEscalonamento); // Para o timer se leu!

    // Trava de Duplicados por Grupo
    const q = query(collection(db, "scans"), where("link", "==", texto), where("grupo", "==", grupoAtual));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
        alert("⚠️ Este código já foi registrado pelo seu grupo!");
        // Reinicia no básico após o alerta
        iniciarScanner(10, 250, "Básico");
        return;
    }

    const status = document.getElementById("statusEnvio");
    status.innerText = "💾 Salvando registro no banco...";
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
        
        // Após o sucesso, sempre volta para o modo Básico para economizar bateria
        iniciarScanner(10, 250, "Básico");

    } catch (e) {
        alert("Erro ao salvar no banco: " + e.message);
    } finally {
        status.style.display = "none";
    }
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
            <td><span style="color: gray;">Sem foto</span></td>
            <td>
                <button onclick="verDetalhes('${item.timestamp}')" class="btn-acao">ℹ️</button>
            </td>
        </tr>
    `).join('');
}

// Relatório Master para Excel
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