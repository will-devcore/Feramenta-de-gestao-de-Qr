import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, getDoc, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
// Vamos usar a versão Browser que já vem pronta para câmeras
import { BrowserQRCodeReader } from "https://cdn.skypack.dev/@zxing/library";

const firebaseConfig = {
    apiKey: "AIzaSyA-Un2ijd0Ao-sIeVFjq5lWU-0wBfwrEhk",
    authDomain: "sistema-qr-master.firebaseapp.com",
    projectId: "sistema-qr-master",
    storageBucket: "sistema-qr-master.appspot.com",
    messagingSenderId: "587607393218",
    appId: "1:587607393218:web:1cc6d38577f69cc0110c5b"
};

// 3. Inicialize o leitor fora das funções para ele ficar sempre pronto
const codeReader = new BrowserQRCodeReader();
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- VARIÁVEIS GLOBAIS ---
let operadorAtual = "";
let grupoAtual = "";
let isAdmin = false; 
let processandoBipe = false; 
let listaEscaneamentos = [];
let html5QrcodeScanner = null; 
let timerInatividade = null; 
let tempoInatividadeMS = 180000; 

// --- FUNÇÕES DE APOIO (GRUPOS E OPERADORES) ---

async function carregarGruposDinamicos() {
    const selectGrupo = document.getElementById("filtroGrupo");
    if (!selectGrupo) return;
    try {
        const querySnapshot = await getDocs(collection(db, "usuarios"));
        const gruposSet = new Set();
        querySnapshot.forEach(doc => {
            const d = doc.data();
            if (d.grupo) gruposSet.add(d.grupo);
        });
        let opcoes = '<option value="todos">-- TODOS OS GRUPOS --</option>';
        gruposSet.forEach(g => { opcoes += `<option value="${g}">${g}</option>`; });
        selectGrupo.innerHTML = opcoes;
        selectGrupo.disabled = false;
        selectGrupo.onchange = () => window.carregarOperadoresDoGrupo();
    } catch (e) { console.error("Erro grupos:", e); }
}

window.carregarOperadoresDoGrupo = async function() {
    const select = document.getElementById("filtroGrupo");
    if (!select) return;
    const grupoSelecionado = select.value;
    const datalist = document.getElementById("listaOperadoresSugestao");
    if (!datalist) return;
    try {
        let q = (grupoSelecionado === "todos") ? query(collection(db, "usuarios")) : query(collection(db, "usuarios"), where("grupo", "==", grupoSelecionado));
        const snap = await getDocs(q);
        let html = "";
        snap.forEach(doc => { html += `<option value="${doc.data().nome}">`; });
        datalist.innerHTML = html;
    } catch (e) { console.error("Erro operadores:", e); }
};

// --- MONITOR DE ACESSO (LOGIN) ---

onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            if (userDoc.exists()) {
                const dados = userDoc.data();
                if (!dados.aprovado) { alert("Aguarde aprovação."); signOut(auth); return; }
                
                operadorAtual = dados.nome;
                grupoAtual = dados.grupo;
                isAdmin = dados.cargo === "admin"; 

                document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
                if(document.getElementById("nomeOperadorTroca")) {
                    document.getElementById("nomeOperadorTroca").value = operadorAtual;
                }

                const selectGrupo = document.getElementById("filtroGrupo");
                if (selectGrupo) {
                    if (isAdmin) {
                        await carregarGruposDinamicos();
                    } else {
                        selectGrupo.innerHTML = `<option value="${grupoAtual}">${grupoAtual}</option>`;
                        selectGrupo.disabled = true;
                    }
                }
                
                await window.carregarOperadoresDoGrupo();

                document.getElementById("telaLogin").style.display = "none";
                document.getElementById("conteudoApp").style.display = "block";
                
                carregarConfiguracoesSalvas();
                iniciarScanner();
                carregarHistorico();
            }
        } catch (e) { console.error("Erro no login:", e); }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

window.fazerLogin = function() {
    const email = document.getElementById("emailLogin").value;
    const senha = document.getElementById("senhaLogin").value;
    signInWithEmailAndPassword(auth, email, senha).catch(e => alert("Erro: " + e.message));
};

window.fazerLogout = () => signOut(auth).then(() => location.reload());

// --- SCANNER E LOGICA DE BIPES ---

// --- NOVO MOTOR DE SCANNER (ZXing) ---
async function iniciarScanner() {
    try {
        // 1. Reseta o leitor antes de começar
        codeReader.reset();
        console.log("ZXing: Motor reiniciado.");

        // 2. Busca os dispositivos de vídeo
        const videoInputDevices = await codeReader.listVideoInputDevices();
        
        if (videoInputDevices.length === 0) {
            alert("Nenhuma câmera encontrada.");
            return;
        }

        // 3. Tenta encontrar especificamente a câmera traseira (environment)
        // Se não encontrar pelo nome, pega a última da lista (geralmente a traseira)
        let selectedDeviceId = videoInputDevices[0].deviceId;
        
        const cameraTraseira = videoInputDevices.find(device => 
            device.label.toLowerCase().includes('back') || 
            device.label.toLowerCase().includes('traseira') ||
            device.label.toLowerCase().includes('environment')
        );

        if (cameraTraseira) {
            selectedDeviceId = cameraTraseira.deviceId;
        } else if (videoInputDevices.length > 1) {
            selectedDeviceId = videoInputDevices[videoInputDevices.length - 1].deviceId;
        }

        console.log("Iniciando na câmera:", selectedDeviceId);

        // 4. Inicia a decodificação contínua
        // O primeiro parâmetro 'reader' deve ser o ID da tag <video> no HTML
        await codeReader.decodeFromVideoDevice(selectedDeviceId, 'reader', (result, err) => {
            if (result) {
                console.log("Código lido:", result.text);
                onScanSuccess(result.text); 
            }
            // Ignoramos erros de 'NotFoundException' para não sujar o console
            if (err && !(err.name === 'NotFoundException')) {
                // Se for um erro real (permissão, etc), mostramos
                if (err.name !== 'TypeError') console.error("Erro ZXing:", err);
            }
        });

    } catch (e) {
        console.error("Falha crítica no Scanner:", e);
        alert("Erro ao acessar câmera: " + e.message);
    }
}

async function onScanSuccess(texto) {
    if (processandoBipe) return;
    processandoBipe = true;
    resetarTimerInatividade();

    if (!grupoAtual || grupoAtual === "todos") {
        alert("⚠️ Selecione um grupo específico nos Ajustes antes de bipar.");
        processandoBipe = false;
        return;
    }

    const status = document.getElementById("statusEnvio");
    status.style.display = "block";

    try {
        const q = query(collection(db, "scans"), where("link", "==", texto.trim()), where("grupo", "==", grupoAtual));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            alert("⚠️ Já registrado por este grupo!");
            status.style.display = "none";
            processandoBipe = false;
            return;
        }

        const novoDoc = {
            link: texto.trim(),
            data: new Date().toLocaleString('pt-BR'),
            operador: operadorAtual,
            grupo: grupoAtual,
            timestamp: Date.now()
        };

        await addDoc(collection(db, "scans"), novoDoc);
        listaEscaneamentos.unshift(novoDoc);
        atualizarTabela();
        console.log("✅ Salvo!");
    } catch (e) {
        alert("Erro: " + e.message);
    } finally {
        status.style.display = "none";
        processandoBipe = false; 
    }
}

// --- HISTÓRICO E INTERFACE ---

async function carregarHistorico() {
    try {
        const q = query(collection(db, "scans"), where("grupo", "==", grupoAtual), orderBy("timestamp", "desc"));
        const snap = await getDocs(q);
        listaEscaneamentos = snap.docs.map(d => d.data());
        atualizarTabela();
    } catch (e) { console.error("Erro histórico:", e); }
}

function atualizarTabela() {
    const corpo = document.getElementById("corpoTabela");
    if (!corpo) return;
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

// --- CONFIGURAÇÕES E OUTROS ---

function carregarConfiguracoesSalvas() {
    const fpsSalvo = localStorage.getItem("scannerFPS");
    const inatividadeSalva = localStorage.getItem("scannerInatividade");
    if (fpsSalvo) document.getElementById("setFPS").value = fpsSalvo;
    if (inatividadeSalva) document.getElementById("setInatividade").value = inatividadeSalva;
}

window.salvarPreferencias = () => {
    const novoNome = document.getElementById("nomeOperadorTroca").value;
    if (novoNome) operadorAtual = novoNome;
    if (isAdmin) {
        const grupoSel = document.getElementById("filtroGrupo").value;
        if (grupoSel !== "todos") grupoAtual = grupoSel;
    }
    localStorage.setItem("scannerFPS", document.getElementById("setFPS").value);
    localStorage.setItem("scannerInatividade", document.getElementById("setInatividade").value);
    document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
    document.getElementById("painelAjustes").style.display = "none";
    iniciarScanner();
    alert("⚙️ Perfil e Scanner atualizados!");
};

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
        if (dataInicio && dataFim) {
            const inicio = new Date(dataInicio + "T00:00:00").getTime();
            const fim = new Date(dataFim + "T23:59:59").getTime();
            resultados = resultados.filter(r => r.timestamp >= inicio && r.timestamp <= fim);
        }
        if (nomeFiltro) {
            resultados = resultados.filter(r => r.operador.toLowerCase().includes(nomeFiltro));
        }
        listaEscaneamentos = resultados;
        atualizarTabela();
        alert(`Relatório gerado: ${resultados.length} registros.`);
    } catch (e) { alert("Erro: " + e.message); }
};

window.toggleConfig = () => {
    const p = document.getElementById("painelAjustes");
    p.style.display = p.style.display === "none" ? "block" : "none";
};

window.toggleDarkMode = () => {
    document.body.classList.toggle("dark-mode");
    localStorage.setItem("modoEscuro", document.body.classList.contains("dark-mode"));
};

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