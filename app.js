import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, getDoc, getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
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
const codeReader = new ZXing.BrowserQRCodeReader();

let operadorAtual = "";
let grupoAtual = "";
let isAdmin = false; 
let processandoBipe = false; 
let listaEscaneamentos = [];

// --- MONITOR DE ACESSO ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            if (userDoc.exists()) {
                const dados = userDoc.data();
                operadorAtual = dados.nome;
                grupoAtual = dados.grupo;
                isAdmin = dados.cargo === "admin"; 

                document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
                document.getElementById("nomeOperadorTroca").value = operadorAtual;
                document.getElementById("telaLogin").style.display = "none";
                document.getElementById("conteudoApp").style.display = "block";
                
                await carregarHistorico();
                await carregarGruposDinamicos();
                await window.carregarOperadoresDoGrupo();
                setTimeout(() => { iniciarScanner(); }, 1500);
            }
        } catch (e) { console.error("Erro no login:", e); }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

// --- FUNÇÕES EXPOSTAS AO HTML (window.) ---

window.fazerLogin = function() {
    const email = document.getElementById("emailLogin").value;
    const senha = document.getElementById("senhaLogin").value;
    signInWithEmailAndPassword(auth, email, senha).catch(e => alert("Erro: " + e.message));
};

window.fazerLogout = () => signOut(auth).then(() => location.reload());

window.toggleConfig = () => {
    const p = document.getElementById("painelAjustes");
    p.style.display = p.style.display === "none" ? "block" : "none";
};

window.toggleDarkMode = () => {
    document.body.classList.toggle("dark-mode");
};

window.salvarPreferencias = () => {
    const novoNome = document.getElementById("nomeOperadorTroca").value;
    if (novoNome) operadorAtual = novoNome;
    alert("Configurações aplicadas!");
    window.toggleConfig();
};

window.enviarManual = async function() {
    const input = document.getElementById("urlManual");
    if (!input.value.trim()) return;
    await onScanSuccess(input.value.trim());
    input.value = "";
    alert("✅ Enviado com sucesso!");
};

window.gerarRelatorio = async function() {
    const grupoFiltro = document.getElementById("filtroGrupo").value;
    const nomeFiltro = document.getElementById("filtroOperador").value.toLowerCase();
    try {
        let q = (grupoFiltro === "todos") ? 
            query(collection(db, "scans"), orderBy("timestamp", "desc"), limit(100)) : 
            query(collection(db, "scans"), where("grupo", "==", grupoFiltro), orderBy("timestamp", "desc"));

        const snap = await getDocs(q);
        let resultados = snap.docs.map(d => d.data());
        
        if (nomeFiltro) {
            resultados = resultados.filter(r => r.operador.toLowerCase().includes(nomeFiltro));
        }

        listaEscaneamentos = resultados;
        atualizarTabela();
    } catch (e) { alert("Erro na busca: " + e.message); }
};

window.exportarParaCSV = function() {
    let csv = "Link;Data;Operador;Grupo\n";
    listaEscaneamentos.forEach(i => csv += `${i.link};${i.data};${i.operador};${i.grupo}\n`);
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Relatorio_QR.csv`;
    link.click();
};

window.carregarOperadoresDoGrupo = async function() {
    const select = document.getElementById("filtroGrupo");
    const datalist = document.getElementById("listaOperadoresSugestao");
    if (!select || !datalist) return;
    try {
        const q = (select.value === "todos") ? collection(db, "usuarios") : query(collection(db, "usuarios"), where("grupo", "==", select.value));
        const snap = await getDocs(q);
        datalist.innerHTML = snap.docs.map(d => `<option value="${d.data().nome}">`).join('');
    } catch (e) { console.error(e); }
};

// --- MOTOR INTERNO ---

async function iniciarScanner() {
    try {
        await codeReader.reset();
        const devices = await codeReader.listVideoInputDevices();
        if (devices.length === 0) return;
        const selectedId = devices[devices.length - 1].deviceId;
        codeReader.decodeFromVideoDevice(selectedId, 'reader', (result, err) => {
            if (result && !processandoBipe) onScanSuccess(result.text);
        });
    } catch (e) { console.warn("Câmera indisponível"); }
}

async function onScanSuccess(texto) {
    if (processandoBipe) return false; // Retorna falso se já estiver ocupado
    processandoBipe = true;
    
    const linkLimpo = texto.trim();
    document.getElementById("statusEnvio").style.display = "block";

    try {
        // Verifica duplicidade
        const qDuplicado = query(
            collection(db, "scans"), 
            where("link", "==", linkLimpo),
            where("grupo", "==", grupoAtual)
        );
        
        const snapshotDuplicado = await getDocs(qDuplicado);

        if (!snapshotDuplicado.empty) {
            alert("⚠️ Atenção: Este link já foi registrado anteriormente pelo seu grupo!");
            finalizarProcessamento();
            return false; // AVISO: Não salvou!
        }

        // Salva se for novo
        const novoDoc = {
            link: linkLimpo,
            data: new Date().toLocaleString('pt-BR'),
            operador: operadorAtual,
            grupo: grupoAtual,
            timestamp: Date.now()
        };

        await addDoc(collection(db, "scans"), novoDoc);
        listaEscaneamentos.unshift(novoDoc);
        atualizarTabela();
        
        finalizarProcessamento();
        return true; // SUCESSO: Salvou!

    } catch (e) { 
        console.error(e);
        finalizarProcessamento();
        return false;
    }
}

// Função auxiliar para limpar o status
function finalizarProcessamento() {
    setTimeout(() => { 
        processandoBipe = false; 
        document.getElementById("statusEnvio").style.display = "none";
    }, 2000);
}

async function carregarHistorico() {
    try {
        const q = query(collection(db, "scans"), where("grupo", "==", grupoAtual), orderBy("timestamp", "desc"), limit(20));
        const snap = await getDocs(q);
        listaEscaneamentos = snap.docs.map(d => d.data());
        atualizarTabela();
    } catch (e) { console.error(e); }
}

async function carregarGruposDinamicos() {
    const selectGrupo = document.getElementById("filtroGrupo");
    if (!selectGrupo) return;
    try {
        if (!isAdmin) {
            selectGrupo.innerHTML = `<option value="${grupoAtual}">${grupoAtual}</option>`;
            return;
        }
        const snap = await getDocs(collection(db, "usuarios"));
        const gruposSet = new Set();
        snap.forEach(doc => { if (doc.data().grupo) gruposSet.add(doc.data().grupo); });
        let opcoes = '<option value="todos">-- TODOS OS GRUPOS --</option>';
        gruposSet.forEach(g => { opcoes += `<option value="${g}">${g}</option>`; });
        selectGrupo.innerHTML = opcoes;
        selectGrupo.disabled = false;
    } catch (e) { console.error(e); }
}

function atualizarTabela() {
    const corpo = document.getElementById("corpoTabela");
    if (!corpo) return;
    corpo.innerHTML = listaEscaneamentos.map(item => `
        <tr>
            <td>✅ Ok</td>
            <td style="word-break:break-all">${item.link}</td>
            <td>${item.data}</td>
            <td>${item.operador} (${item.grupo})</td>
            <td><button onclick="alert('${item.link}')">ℹ️</button></td>
        </tr>`).join('');
}