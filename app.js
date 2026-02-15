// 1. TODOS OS IMPORTS NO TOPO
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, getDoc, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// 2. CONFIGURAÇÃO (Mantenha suas chaves reais aqui)
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
const storage = getStorage(app);

// Carrega a memória local (Trava de segurança persistente)
let listaEscaneamentos = JSON.parse(localStorage.getItem('cacheScans')) || [];
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
    signOut(auth).then(() => {
        localStorage.removeItem('cacheScans'); // Opcional: limpa cache ao sair
        location.reload();
    });
};

onAuthStateChanged(auth, async (user) => {
    const telaLogin = document.getElementById("telaLogin");
    const conteudoApp = document.getElementById("conteudoApp");
    const btnSair = document.getElementById("btnSair");

    if (user) {
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
            atualizarTabelaNaTela(); // Garante que a tabela carregue o que está no cache
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

// --- SCANNER E LÓGICA DE CAPTURA ---
function iniciarScanner() {
    const html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 });
    html5QrcodeScanner.render(aoLerSucesso);
    scannerIniciado = true;
}

async function aoLerSucesso(textoDecodificado) {
    // 1. TRAVA DE SEGURANÇA (Compara com o que está na memória do navegador)
    if (listaEscaneamentos.some(item => item.link === textoDecodificado)) {
        alert("⚠️ Este link já foi processado e está na memória local.");
        return;
    }

    try {
        // 2. CAPTURA AUTOMÁTICA DA FOTO
        const video = document.querySelector('video');
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        // Qualidade 0.6 para equilibrar nitidez e velocidade de upload
        const fotoBase64 = canvas.toDataURL('image/jpeg', 0.6); 

        // 3. UPLOAD PARA O FIREBASE STORAGE
        const nomeArquivo = `scans/${auth.currentUser.uid}_${Date.now()}.jpg`;
        const storageRef = ref(storage, nomeArquivo);
        const snapshot = await uploadString(storageRef, fotoBase64, 'data_url');
        const urlFoto = await getDownloadURL(snapshot.ref);

        // 4. MONTAGEM DO OBJETO (Estrutura para o banco e Excel)
        const item = {
            link: textoDecodificado,
            foto: urlFoto,
            data: new Date().toLocaleString('pt-BR'),
            operador: operadorAtual,
            grupo: grupoAtual
        };

        // 5. SALVAR NA MEMÓRIA LOCAL (Trava Persistente)
        listaEscaneamentos.unshift(item);
        localStorage.setItem('cacheScans', JSON.stringify(listaEscaneamentos));
        
        // 6. SALVAR NA NUVEM (Firestore)
        await addDoc(collection(db, "scans"), item);
        
        atualizarTabelaNaTela();
        console.log("Sucesso: QR Code e Foto processados.");

    } catch (error) {
        console.error("Erro no processo completo:", error);
        alert("Erro ao salvar dados. Verifique sua conexão e as regras do Storage.");
    }
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
                <td><a href="${item.foto}" target="_blank">Ver Foto</a></td>
                <td>${item.data}</td>
                <td>${item.operador}</td>
                <td><button onclick="removerItem(${index})" style="background:red; color:white; border:none; padding:4px 8px; border-radius:4px;">X</button></td>
            </tr>`;
    });
}

window.removerItem = (index) => {
    if(confirm("Remover da lista local?")) {
        listaEscaneamentos.splice(index, 1);
        localStorage.setItem('cacheScans', JSON.stringify(listaEscaneamentos));
        atualizarTabelaNaTela();
    }
};

// --- EXPORTAÇÃO E ADMIN ---

window.exportarParaCSV = function() {
    // Ordem das colunas conforme solicitado: Link primeiro, depois foto
    let csv = "Link;Link da Foto;Data;Operador;Grupo\n";
    listaEscaneamentos.forEach(i => {
        csv += `${i.link};${i.foto};${i.data};${i.operador};${i.grupo}\n`;
    });
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Relatorio_${operadorAtual}.csv`;
    link.click();
};

window.exportarMasterGeral = async function() {
    if(!confirm("Deseja baixar TODOS os registros do banco de dados?")) return;
    try {
        const querySnapshot = await getDocs(collection(db, "scans"));
        let csv = "Link;Link da Foto;Data;Operador;Grupo\n";
        querySnapshot.forEach((doc) => {
            const d = doc.data();
            csv += `${d.link};${d.foto || "Sem Foto"};${d.data};${d.operador};${d.grupo}\n`;
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

window.limparCacheTrava = function() {
    if(confirm("Isso permitirá que QR Codes antigos sejam lidos novamente. Continuar?")) {
        localStorage.removeItem('cacheScans');
        listaEscaneamentos = [];
        atualizarTabelaNaTela();
        alert("Memória de travas limpa!");
    }
};