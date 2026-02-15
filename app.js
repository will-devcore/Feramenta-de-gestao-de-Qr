// 1. IMPORTS (Mantendo a ordem correta)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, getDoc, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// 2. CONFIGURAÇÃO (Preencha com suas chaves)
const firebaseConfig = {
    apiKey: "sua_chave",
    authDomain: "sistema-qr-master.firebaseapp.com",
    projectId: "sistema-qr-master",
    storageBucket: "sistema-qr-master.appspot.com",
    messagingSenderId: "seu_id",
    appId: "seu_id"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Persistência da Trava (Lê o que está salvo no celular)
let listaEscaneamentos = JSON.parse(localStorage.getItem('cacheScans')) || [];
let operadorAtual = "";
let grupoAtual = "";
let scannerIniciado = false;

// --- LOGIN (Seu código original com tratamento de erro) ---
window.fazerLogin = function() {
    const email = document.getElementById("emailLogin").value;
    const senha = document.getElementById("senhaLogin").value;
    if(!email || !senha) {
        alert("Preencha e-mail e senha.");
        return;
    }
    signInWithEmailAndPassword(auth, email, senha).catch(err => {
        alert("Erro: E-mail ou senha inválidos.");
    });
};

window.fazerLogout = function() {
    signOut(auth).then(() => location.reload());
};

// --- MONITOR DE ACESSO (Onde o sistema travava) ---
onAuthStateChanged(auth, async (user) => {
    const telaLogin = document.getElementById("telaLogin");
    const conteudoApp = document.getElementById("conteudoApp");
    const btnSair = document.getElementById("btnSair");

    if (user) {
        try {
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            if (userDoc.exists() && userDoc.data().aprovado) {
                const dados = userDoc.data();
                operadorAtual = dados.nome;
                grupoAtual = dados.grupo;
                
                if (dados.cargo === "admin") {
                    document.getElementById("painelAdmin").style.display = "block";
                }

                document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} | Grupo: ${grupoAtual}`;
                telaLogin.style.display = "none";
                conteudoApp.style.display = "block";
                btnSair.style.display = "block";
                
                if (!scannerIniciado) { iniciarScanner(); }
                atualizarTabelaNaTela(); // Garante que a lista apareça
            } else {
                alert("Acesso pendente ou usuário não encontrado.");
                signOut(auth);
            }
        } catch (e) {
            console.error(e);
        }
    } else {
        telaLogin.style.display = "block";
        conteudoApp.style.display = "none";
        btnSair.style.display = "none";
    }
});

// --- SCANNER E FOTO (Aqui entra a mágica nova) ---
function iniciarScanner() {
    const html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 });
    html5QrcodeScanner.render(aoLerSucesso);
    scannerIniciado = true;
}

async function aoLerSucesso(textoDecodificado) {
    // 1. TRAVA DE SEGURANÇA (Persistente)
    if (listaEscaneamentos.some(item => item.link === textoDecodificado)) {
        alert("⚠️ Duplicado! Já está na memória.");
        return;
    }

    try {
        // 2. CAPTURA AUTOMÁTICA (Print do Vídeo)
        const video = document.querySelector('video');
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        const fotoBase64 = canvas.toDataURL('image/jpeg', 0.6);

        // 3. STORAGE E BANCO
        const nomeArquivo = `scans/${Date.now()}.jpg`;
        const storageRef = ref(storage, nomeArquivo);
        const snapshot = await uploadString(storageRef, fotoBase64, 'data_url');
        const urlFoto = await getDownloadURL(snapshot.ref);

        const item = {
            link: textoDecodificado,
            foto: urlFoto, // Segunda coluna do Excel
            data: new Date().toLocaleString('pt-BR'),
            operador: operadorAtual,
            grupo: grupoAtual
        };

        // Salva na Memória Local (Trava)
        listaEscaneamentos.unshift(item);
        localStorage.setItem('cacheScans', JSON.stringify(listaEscaneamentos));

        await addDoc(collection(db, "scans"), item);
        atualizarTabelaNaTela();
    } catch (err) {
        alert("Erro ao processar foto. Verifique as regras do Storage.");
    }
}

// --- FUNÇÕES DE EXIBIÇÃO E EXPORTAÇÃO ---
function atualizarTabelaNaTela() {
    const corpo = document.getElementById("corpoTabela");
    if (!corpo) return;
    corpo.innerHTML = "";
    listaEscaneamentos.forEach((item, index) => {
        corpo.innerHTML += `
            <tr>
                <td>${item.link.substring(0,10)}...</td>
                <td><a href="${item.foto}" target="_blank">Ver Foto</a></td>
                <td>${item.data}</td>
                <td><button onclick="removerItem(${index})">X</button></td>
            </tr>`;
    });
}

window.removerItem = function(index) {
    listaEscaneamentos.splice(index, 1);
    localStorage.setItem('cacheScans', JSON.stringify(listaEscaneamentos));
    atualizarTabelaNaTela();
};

window.exportarParaCSV = function() {
    let csv = "Link;Link da Foto;Data;Operador;Grupo\n";
    listaEscaneamentos.forEach(i => csv += `${i.link};${i.foto};${i.data};${i.operador};${i.grupo}\n`);
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "relatorio.csv";
    link.click();
};

window.limparCacheTrava = function() {
    if(confirm("Limpar memória de travas?")) {
        localStorage.removeItem('cacheScans');
        listaEscaneamentos = [];
        atualizarTabelaNaTela();
    }
};