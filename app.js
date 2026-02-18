import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, getDoc, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Configuração corrigida (Sem os links de busca do Google)
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

// --- LOGIN ---
window.fazerLogin = function() {
    const email = document.getElementById("emailLogin").value;
    const senha = document.getElementById("senhaLogin").value;
    // O erro de rede deve sumir agora com o authDomain corrigido
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
            iniciarScanner();
            carregarHistorico();
        }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

// --- SCANNER SIMPLIFICADO (SEM FOTO) ---
function iniciarScanner() {
    // Configurações para aumentar a sensibilidade
    const config = { 
        fps: 20, // Aumentamos de 10 para 20 para ler mais rápido
        qrbox: { width: 280, height: 280 }, // Área de foco maior
        aspectRatio: 1.0 
    };
    
    const scanner = new Html5QrcodeScanner("reader", config, false);
    
    scanner.render(async (texto) => {
        // Trava de Duplicados por Grupo
        const q = query(collection(db, "scans"), where("link", "==", texto), where("grupo", "==", grupoAtual));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            alert("⚠️ Este código já foi registrado pelo seu grupo!");
            return;
        }

        const status = document.getElementById("statusEnvio");
        status.style.display = "block";

        try {
            // Salva apenas os dados de texto no Firestore
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
    });
}

async function carregarHistorico() {
    // Busca no banco 'scans' filtrando pelo seu grupo, do mais novo para o mais antigo
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