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
let isAdmin = false; 
let listaEscaneamentos = [];
let html5QrcodeScanner; 
let timerInatividade; 
let tempoInatividadeMS = 180000; 

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
            if (!dados.aprovado) { alert("Aguarde aprovação."); signOut(auth); return; }
            
            operadorAtual = dados.nome;
            grupoAtual = dados.grupo;
            isAdmin = dados.role === "admin"; // Verifica se é Admin

            // Preenche display e campo de troca de nome
            document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
            if(document.getElementById("nomeOperadorTroca")) {
                document.getElementById("nomeOperadorTroca").value = operadorAtual;
            }

            // Configura Seletor de Grupos para Relatório
            const selectGrupo = document.getElementById("filtroGrupo");
            if (selectGrupo) {
                if (isAdmin) {
                    selectGrupo.disabled = false;
                    selectGrupo.innerHTML = `
                        <option value="todos">-- TODOS OS GRUPOS --</option>
                        <option value="Grupo A">Grupo A</option>
                        <option value="Grupo B">Grupo B</option>
                        <option value="Grupo C">Grupo C</option>
                    `;
                } else {
                    selectGrupo.innerHTML = `<option value="${grupoAtual}">${grupoAtual}</option>`;
                    selectGrupo.disabled = true;
                }
            }

            document.getElementById("telaLogin").style.display = "none";
            document.getElementById("conteudoApp").style.display = "block";
            
            carregarConfiguracoesSalvas();
            iniciarScanner();
            carregarHistorico();
        }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

// --- MEMÓRIA E CONFIGURAÇÕES ---
function carregarConfiguracoesSalvas() {
    const fpsSalvo = localStorage.getItem("scannerFPS");
    const inatividadeSalva = localStorage.getItem("scannerInatividade");
    if (fpsSalvo) document.getElementById("setFPS").value = fpsSalvo;
    if (inatividadeSalva) document.getElementById("setInatividade").value = inatividadeSalva;
}

window.salvarPreferencias = () => {
    // 1. Troca de Nome (Substituição)
    const novoNome = document.getElementById("nomeOperadorTroca").value;
    if (novoNome) operadorAtual = novoNome;

    // 2. Troca de Grupo Ativo (Se for Admin e quiser bipar para outro grupo)
    if (isAdmin) {
        const grupoSel = document.getElementById("filtroGrupo").value;
        if (grupoSel !== "todos") grupoAtual = grupoSel;
    }

    // 3. Persistência de Hardware
    localStorage.setItem("scannerFPS", document.getElementById("setFPS").value);
    localStorage.setItem("scannerInatividade", document.getElementById("setInatividade").value);

    document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
    document.getElementById("painelAjustes").style.display = "none";
    iniciarScanner();
    alert("⚙️ Perfil e Scanner atualizados!");
};

// --- LÓGICA DE ECONOMIA ---
function resetarTimerInatividade() {
    if (timerInatividade) clearTimeout(timerInatividade);
    if (tempoInatividadeMS === 0) return;
    timerInatividade = setTimeout(() => {
        if (html5QrcodeScanner) {
            html5QrcodeScanner.clear().then(() => {
                document.getElementById("reader").innerHTML = `
                    <div style="text-align:center; padding: 25px; border: 2px dashed #ff9800; border-radius: 10px; background: #fff5e6; color: #333;">
                        <p>🔋 <strong>Modo de Economia</strong></p>
                        <button onclick="window.location.reload()" style="background:#27ae60; color:white; border:none; padding:10px; border-radius:5px; cursor:pointer;">🔄LIGAR CÂMERA</button>
                    </div>`;
            });
        }
    }, tempoInatividadeMS); 
}

// --- SCANNER ---
function iniciarScanner() {
    const fpsDesejado = parseInt(document.getElementById("setFPS").value) || 25;
    tempoInatividadeMS = parseInt(document.getElementById("setInatividade").value);

    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().catch(e => console.log("Limpando..."));
    }

    let boxSize = 250;
    if (fpsDesejado >= 35) boxSize = 300;

    const config = { fps: fpsDesejado, qrbox: { width: boxSize, height: boxSize }, aspectRatio: 1.0 };
    html5QrcodeScanner = new Html5QrcodeScanner("reader", config, false);
    html5QrcodeScanner.render(onScanSuccess);
    resetarTimerInatividade();
}

async function onScanSuccess(texto) {
    resetarTimerInatividade();

    // Verificação de Grupo para Admin
    if (grupoAtual === "todos") {
        alert("⚠️ Selecione um grupo específico nos Ajustes antes de bipar.");
        return;
    }

    const q = query(collection(db, "scans"), where("link", "==", texto), where("grupo", "==", grupoAtual));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
        alert("⚠️ Já registrado por este grupo!");
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
        alert("✅ Salvo!");
    } catch (e) {
        alert("Erro: " + e.message);
    } finally {
        status.style.display = "none";
    }
}

// --- RELATÓRIOS E FILTROS ---
window.gerarRelatorio = async function() {
    const grupoFiltro = document.getElementById("filtroGrupo").value;
    const dataInicio = document.getElementById("filtroDataInicio").value;
    const dataFim = document.getElementById("filtroDataFim").value;
    const nomeFiltro = document.getElementById("filtroOperador").value.toLowerCase();

    try {
        let q;
        if (grupoFiltro === "todos" && isAdmin) {
            q = query(collection(db, "scans"), orderBy("timestamp", "desc"));
        } else {
            q = query(collection(db, "scans"), where("grupo", "==", grupoFiltro), orderBy("timestamp", "desc"));
        }

        const snap = await getDocs(q);
        let resultados = snap.docs.map(d => d.data());

        // Filtro Manual de Data
        if (dataInicio && dataFim) {
            const inicio = new Date(dataInicio + "T00:00:00").getTime();
            const fim = new Date(dataFim + "T23:59:59").getTime();
            resultados = resultados.filter(r => r.timestamp >= inicio && r.timestamp <= fim);
        }

        // Filtro Manual de Operador
        if (nomeFiltro) {
            resultados = resultados.filter(r => r.operador.toLowerCase().includes(nomeFiltro));
        }

        listaEscaneamentos = resultados;
        atualizarTabela();
        alert(`Relatório gerado: ${resultados.length} registros.`);
    } catch (e) {
        alert("Erro: " + e.message);
    }
};

// --- INTERFACE E HISTÓRICO ---
window.toggleConfig = () => {
    const p = document.getElementById("painelAjustes");
    p.style.display = p.style.display === "none" ? "block" : "none";
};

window.toggleDarkMode = () => {
    document.body.classList.toggle("dark-mode");
    localStorage.setItem("modoEscuro", document.body.classList.contains("dark-mode"));
};

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
            <td><span style="color: #27ae60;">✅ Ok</span></td>
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
    alert(`QR: ${scan.link}\nData: ${scan.data}\nOperador: ${scan.operador}\nGrupo: ${scan.grupo}`);
};

if (localStorage.getItem("modoEscuro") === "true") document.body.classList.add("dark-mode");