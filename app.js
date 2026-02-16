import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// --- CONFIGURAÇÃO FIREBASE (COLE SUAS CHAVES AQUI) ---
const firebaseConfig = {
apiKey: "AIzaSyA-Un2ijd0Ao-sIeVFjq5lWU-0wBfwrEhk",
authDomain: "https://www.google.com/search?q=sistema-qr-master.firebaseapp.com",
projectId: "sistema-qr-master",
storageBucket: "https://www.google.com/search?q=sistema-qr-master.appspot.com",
messagingSenderId: "587607393218",
appId: "1:587607393218:web:1cc6d38577f69cc0110c5b"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- VARIÁVEIS GLOBAIS ---
let listaEscaneamentos = [];
let operadorAtual = "";
let grupoAtual = "";

// --- SISTEMA DE LOGIN ---
window.fazerLogin = function() {
    const email = document.getElementById("emailLogin").value;
    const senha = document.getElementById("senhaLogin").value;
    signInWithEmailAndPassword(auth, email, senha)
        .catch(() => alert("E-mail ou senha incorretos. Verifique com o Admin."));
};

window.fazerLogout = function() {
    signOut(auth).then(() => location.reload());
};

// --- MONITOR DE ACESSO ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Busca o perfil do usuário no Firestore
        const userDoc = await getDoc(doc(db, "usuarios", user.uid));
        if (userDoc.exists()) {
            const dados = userDoc.data();
            operadorAtual = dados.nome;
            grupoAtual = dados.grupo;
            
            document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
            document.getElementById("telaLogin").style.display = "none";
            document.getElementById("conteudoApp").style.display = "block";
            iniciarCamera();
        } else {
            alert("Perfil não encontrado no banco de dados.");
            signOut(auth);
        }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

// --- SCANNER E TRAVA ---
function iniciarCamera() {
    const html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 });
    html5QrcodeScanner.render(aoLerSucesso, { preferredCamera: "back" });
}

function aoLerSucesso(textoDecodificado) {
    // TRAVA: Verifica se o link já existe na lista atual
    const jaExiste = listaEscaneamentos.some(item => item.link === textoDecodificado);
    if (jaExiste) {
        alert("⚠️ Este QR Code já foi escaneado e está na lista!");
        return;
    }

    const item = {
        link: textoDecodificado,
        data: new Date().toLocaleString('pt-BR'),
        operador: operadorAtual,
        grupo: grupoAtual
    };

    listaEscaneamentos.unshift(item);
    atualizarTabelaNaTela();
    salvarNoFirebase(item);
    alert("✅ Escaneado com sucesso!");
}

async function salvarNoFirebase(item) {
    try {
        await addDoc(collection(db, "scans"), item);
    } catch (e) {
        console.error("Erro ao salvar:", e);
    }
}

function atualizarTabelaNaTela() {
    const corpo = document.getElementById("corpoTabela");
    corpo.innerHTML = "";
    listaEscaneamentos.forEach((item, index) => {
        corpo.innerHTML += `
            <tr>
                <td style="word-break: break-all;">${item.link}</td>
                <td>${item.data}</td>
                <td>${item.operador}</td>
                <td><button onclick="removerItem(${index})">X</button></td>
            </tr>`;
    });
}

window.removerItem = function(index) {
    if(confirm("Remover este registro?")) {
        listaEscaneamentos.splice(index, 1);
        atualizarTabelaNaTela();
    }
};

window.exportarParaCSV = function() {
    let csv = "Link;Data;Operador;Grupo\n";
    listaEscaneamentos.forEach(i => csv += `${i.link};${i.data};${i.operador};${i.grupo}\n`);
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "relatorio.csv";
    link.click();
};