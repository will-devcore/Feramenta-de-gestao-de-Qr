// 1. TODOS OS IMPORTS NO TOPO
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, getDoc, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// 2. CONFIGURAÇÃO
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

let listaEscaneamentos = [];
let operadorAtual = "";
let grupoAtual = "";
let scannerIniciado = false;

// --- FUNÇÕES DE ACESSO ---
window.fazerLogin = function() {
    const email = document.getElementById("emailLogin").value;
    const senha = document.getElementById("senhaLogin").value;
    signInWithEmailAndPassword(auth, email, senha).catch(err => alert("Erro: E-mail ou senha inválidos."));
};

window.fazerLogout = function() {
    signOut(auth).then(() => location.reload());
};

onAuthStateChanged(auth, async (user) => {
    const telaLogin = document.getElementById("telaLogin");
    const conteudoApp = document.getElementById("conteudoApp");
    const btnSair = document.getElementById("btnSair");

    if (user) {
        // Busca os dados do seu documento que criamos no Firestore
        const userDoc = await getDoc(doc(db, "usuarios", user.uid));
        
        if (userDoc.exists() && userDoc.data().aprovado) {
            const dados = userDoc.data();
            operadorAtual = dados.nome;
            grupoAtual = dados.grupo;       
            // LIBERA O PAINEL SE FOR ADMIN
            if (dados.cargo === "admin") {
                document.getElementById("painelAdmin").style.display = "block";
            }

            document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} | Grupo: ${grupoAtual}`;
            telaLogin.style.display = "none";
            conteudoApp.style.display = "block";
            btnSair.style.display = "block";       
            if (!scannerIniciado) { iniciarScanner(); }
        } else {
            alert("Acesso pendente de aprovação.");
            signOut(auth);
        }
    } else {
        telaLogin.style.display = "block";
        conteudoApp.style.display = "none";
        btnSair.style.display = "none";
    }
});

// --- SCANNER E TABELA ---
function iniciarScanner() {
    const html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 });
    html5QrcodeScanner.render(aoLerSucesso);
    scannerIniciado = true;
}

function aoLerSucesso(textoDecodificado) {
    if (listaEscaneamentos.some(item => item.link === textoDecodificado)) {
        alert("⚠️ Este link já consta na sua lista!");
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
    enviarParaNuvem(item);
}

async function enviarParaNuvem(item) {
    try {
        await addDoc(collection(db, "scans"), item);
    } catch (e) { console.error("Erro ao salvar:", e); }
}

function atualizarTabelaNaTela() {
    const corpoTabela = document.getElementById("corpoTabela");
    if (!corpoTabela) return;
    corpoTabela.innerHTML = "";
    listaEscaneamentos.forEach((item, index) => {
        const linkCurto = item.link.substring(0, 15) + "...";
        corpoTabela.innerHTML += `
            <tr>
                <td title="${item.link}">${linkCurto}</td>
                <td>${item.data}</td>
                <td>${item.operador}</td>
                <td><button onclick="removerItem(${index})" style="background:red; color:white; border:none; padding:4px 8px; border-radius:4px;">X</button></td>
            </tr>`;
    });
}

window.removerItem = (index) => {
    if(confirm("Remover da lista?")) {
        listaEscaneamentos.splice(index, 1);
        atualizarTabelaNaTela();
    }
};

// --- FUNÇÕES DE ADMIN E EXPORTAÇÃO ---

window.exportarParaCSV = function() {
    let csv = "Link;Data;Operador;Grupo\n";
    listaEscaneamentos.forEach(i => csv += `${i.link};${i.data};${i.operador};${i.grupo}\n`);
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Relatorio_${operadorAtual}.csv`;
    link.click();
};

window.puxarDadosFiltro = async function() {
    const grupoBusca = document.getElementById("filtroGrupo").value;
    if(!grupoBusca) return alert("Digite o nome do grupo!");

    try {
        const q = query(collection(db, "scans"), where("grupo", "==", grupoBusca));
        const querySnapshot = await getDocs(q);

        listaEscaneamentos = []; 
        querySnapshot.forEach((doc) => {
            listaEscaneamentos.push(doc.data());
        });

        atualizarTabelaNaTela();
        alert(`Mostrando ${listaEscaneamentos.length} registros do ${grupoBusca}`);
    } catch (e) {
        alert("Erro ao buscar dados. Verifique sua conexão.");
    }
};

window.exportarMasterGeral = async function() {
    if(!confirm("Deseja baixar TODOS os registros do banco de dados?")) return;

    try {
        const querySnapshot = await getDocs(collection(db, "scans"));
        let csv = "Link;Data;Operador;Grupo\n";

        querySnapshot.forEach((doc) => {
            const d = doc.data();
            csv += `${d.link};${d.data};${d.operador};${d.grupo}\n`;
        });

        const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "RELATORIO_GERAL_MASTER.csv";
        link.click();
    } catch (e) {
        alert("Erro na exportação mestre.");
    }
};