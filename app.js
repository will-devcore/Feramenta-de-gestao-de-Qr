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
let html5QrcodeScanner; // Variável para controlar o scanner
let timerInatividade;  // Variável para o tempo de desligamento

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
            iniciarScanner();
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
    
    // Define 3 minutos (180000ms) para desligar por falta de uso
    timerInatividade = setTimeout(() => {
        if (html5QrcodeScanner) {
            html5QrcodeScanner.clear().then(() => {
                const readerDiv = document.getElementById("reader");
                readerDiv.innerHTML = `
                    <div style="text-align:center; padding: 25px; border: 2px dashed #ff9800; border-radius: 10px; background: #fff5e6;">
                        <p style="font-size: 1.2rem;">🔋 <strong>Modo de Economia</strong></p>
                        <p>A câmera foi desligada para poupar bateria.</p>
                        <button onclick="window.location.reload()" style="background:#27ae60; color:white; border:none; padding:12px 25px; border-radius:5px; cursor:pointer; font-weight:bold;">🔄 LIGAR CÂMERA</button>
                    </div>
                `;
                console.log("Scanner desligado por inatividade.");
            });
        }
    }, 180000); 
}

// --- SCANNER SIMPLIFICADO ---
function iniciarScanner() {
    const config = { 
        fps: 25, 
        qrbox: { width: 280, height: 280 }, 
        aspectRatio: 1.0 
    };
    
    html5QrcodeScanner = new Html5QrcodeScanner("reader", config, false);
    
    html5QrcodeScanner.render(async (texto) => {
        // Se leu um QR Code, reseta o tempo de inatividade
        resetarTimerInatividade();

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
    });

    // Inicia o cronômetro assim que o scanner abre
    resetarTimerInatividade();
}

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