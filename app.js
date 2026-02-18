import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, getDoc, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

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
const storage = getStorage(app);

let operadorAtual = "";
let grupoAtual = "";
let listaEscaneamentos = [];

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

// --- SCANNER COM FOTO E TRAVA ---
function iniciarScanner() {
    const scanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 });
    scanner.render(async (texto) => {
        // Trava de Duplicados
        const q = query(collection(db, "scans"), where("link", "==", texto), where("grupo", "==", grupoAtual));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            alert("⚠️ Este código já foi registrado pelo seu grupo!");
            return;
        }

        const status = document.getElementById("statusEnvio");
        status.style.display = "block";

        try {
            // Captura frame
            const video = document.querySelector('video');
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);
            const fotoData = canvas.toDataURL('image/jpeg', 0.6);

            // Upload Storage
            const caminho = `evidencias/${Date.now()}.jpg`;
            const storageRef = ref(storage, caminho);
            await uploadString(storageRef, fotoData, 'data_url');
            const urlFoto = await getDownloadURL(storageRef);

            // Salva Firestore
            const novoDoc = {
                link: texto,
                data: new Date().toLocaleString('pt-BR'),
                operador: operadorAtual,
                grupo: grupoAtual,
                foto: urlFoto,
                timestamp: Date.now()
            };
            await addDoc(collection(db, "scans"), novoDoc);
            listaEscaneamentos.unshift(novoDoc);
            atualizarTabela();
        } catch (e) {
            alert("Erro ao salvar: " + e.message);
        } finally {
            status.style.display = "none";
        }
    });
}

async function carregarHistorico() {
    const q = query(collection(db, "scans"), where("grupo", "==", grupoAtual), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    listaEscaneamentos = snap.docs.map(d => d.data());
    atualizarTabela();
}

function atualizarTabela() {
    const corpo = document.getElementById("corpoTabela");
    corpo.innerHTML = listaEscaneamentos.map(item => `
        <tr>
            <td style="word-break:break-all">${item.link}</td>
            <td>${item.data}</td>
            <td><a href="${item.foto}" target="_blank"><img src="${item.foto}" class="img-miniatura"></a></td>
        </tr>
    `).join('');
}

window.exportarParaCSV = function() {
    let csv = "Link;Data;Operador;Foto\n";
    listaEscaneamentos.forEach(i => csv += `${i.link};${i.data};${i.operador};${i.foto}\n`);
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Relatorio_${grupoAtual}.csv`;
    link.click();
};

window.filtrar = (tipo) => {
    alert("Filtro '" + tipo + "' ativado. Buscando dados recentes...");
    carregarHistorico();
};