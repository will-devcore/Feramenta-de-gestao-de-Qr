/* * SCANNER QR MASTER - VERSÃO PRO 2.0 BLINDADA (UNIFICADA)
 * -----------------------------------------------------------
 * COPYRIGHT (C) 2026, WILLIAM VA PEREIRA. (github.com/will-devcore)
 * TODOS OS DIREITOS RESERVADOS.
 */
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

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
const codeReader = new ZXing.BrowserQRCodeReader();

// --- VARIÁVEIS GLOBAIS E CONFIGURAÇÕES EDITÁVEIS ---
let operadorAtual = "";
let grupoAtual = "";
let isAdmin = false;
let processandoAcao = false;
let listaEscaneamentos = [];
let timerInatividade;

// Configurações Padrão (Podem ser mudadas nos Ajustes)
let configApp = {
    urlSefaz: "https://portalsped.fazenda.mg.gov.br/portalsped/sistema/consultaunificada.xhtml?chaveAcesso=",
    estadoUF: "MG"
};

// --- 1. NÚCLEO DE VALIDAÇÃO (Módulo 11 + Recuperação) ---
function validarChaveNF(chave) {
    const limpa = chave.replace(/\D/g, '');
    if (limpa.length !== 44) return false;
    let soma = 0, peso = 2;
    for (let i = 42; i >= 0; i--) {
        soma += parseInt(limpa[i]) * peso;
        peso = (peso === 9) ? 2 : peso + 1;
    }
    const resto = soma % 11;
    const dvCalculado = (resto === 0 || resto === 1) ? 0 : 11 - resto;
    return dvCalculado === parseInt(limpa[43]);
}

// Se faltar 1 dígito, o sistema "chuta" matematicamente
function recuperarChaveIncompleta(chave43) {
    const limpa = chave43.replace(/\D/g, '');
    if (limpa.length !== 43) return null;
    for (let i = 0; i <= 9; i++) {
        if (validarChaveNF(limpa + i)) return limpa + i;
    }
    return null;
}

// --- 2. FILTRO DE BLINDAGEM (Sua ideia de Contraste Forçado) ---
function aplicarFiltroBlindagem(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        // Converte para escala de cinza e força binarização (P/B)
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const v = avg > 130 ? 255 : 0; // Limiar ajustado para notas térmicas
        data[i] = data[i+1] = data[i+2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL();
}

// --- 3. MOTOR DE PROCESSAMENTO EM DEGRAUS ---
async function processarEntrada(origem) {
    if (processandoAcao) return;
    processandoAcao = true;
    atualizarStatusUI("🔍 Analisando...");

    let numerosExtraidos = "";

    // --- PASSO 1: EXTRAÇÃO ---
    if (typeof origem === "string") {
        numerosExtraidos = origem.replace(/\D/g, ''); 
    } else {
        try {
            const res = await codeReader.decodeFromImageElement(origem);
            numerosExtraidos = res.text.replace(/\D/g, '');
        } catch (e) {
            atualizarStatusUI("🤖 Recuperando via OCR...");
            const canvas = document.createElement('canvas');
            canvas.width = origem.width; 
            canvas.height = origem.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(origem, 0, 0);
            
            const imgBlindada = aplicarFiltroBlindagem(canvas);
            const { data: { text } } = await Tesseract.recognize(imgBlindada, 'por');
            numerosExtraidos = text.replace(/\D/g, ''); 
        }
    }

    // --- PASSO 2: FILTRAGEM (Pega o bloco de 44 dígitos) ---
    const match = numerosExtraidos.match(/\d{44}/);
    const chaveCandidata = match ? match[0] : numerosExtraidos.substring(0, 44);

    // --- PASSO 3: VALIDAÇÃO E RECONSTRUÇÃO ---
    if (chaveCandidata.length === 44 && validarChaveNF(chaveCandidata)) {
        
        const confirmada = confirm(`Chave Detectada:\n${formatarChaveParaExibicao(chaveCandidata)}\n\nDeseja salvar?`);
        
        if (confirmada) {
            // RECONSTRUÇÃO: Monta o link oficial usando a base configurada
            const linkFinal = configApp.urlSefaz + chaveCandidata;
            await salvarRegistro(linkFinal);
            document.getElementById("urlManual").value = ""; 
        } else {
            preencherCampoManual(chaveCandidata);
        }
    } else {
        // Se a nota for ilegível ou a chave estiver errada
        alert("❌ Nota ilegível ou chave inválida. Verifique o foco ou complete no campo manual.");
        preencherCampoManual(chaveCandidata);
    }

    processandoAcao = false;
    atualizarStatusUI(null);
}

// --- FUNÇÕES DE APOIO (Mantenha-as logo abaixo da processarEntrada) ---
function preencherCampoManual(valor) {
    const campo = document.getElementById("urlManual");
    if (campo) {
        campo.value = formatarChaveParaExibicao(valor);
        campo.focus();
    }
}

function formatarChaveParaExibicao(valor) {
    // Adiciona os espaços para ficar igual à nota fiscal: 0000 0000...
    return valor.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

// --- 4. PERSISTÊNCIA E VALIDAÇÃO DE DUPLICIDADE ---
async function salvarRegistro(linkCompleto) {
    try {
        // Busca duplicata apenas no grupo atual
        const q = query(collection(db, "scans"), where("link", "==", linkCompleto), where("grupo", "==", grupoAtual));
        const snap = await getDocs(q);
        if (!snap.empty) {
            alert("⚠️ Atenção! Esta nota já foi registrada por alguém do grupo " + grupoAtual);
            return;
        }

        const novoDoc = {
            link: linkCompleto,
            data: new Date().toLocaleString('pt-BR'),
            operador: operadorAtual,
            grupo: grupoAtual,
            timestamp: Date.now(),
            chaveAcesso: linkCompleto.split('chaveAcesso=')[1] || ""
        };

        await addDoc(collection(db, "scans"), novoDoc);
        await carregarHistorico();
        alert("✅ Nota salva e link oficial reconstruído!");
        document.getElementById("urlManual").value = ""; 
    } catch (err) {
        alert("❌ Erro ao salvar no Firebase.");
    }
}

// --- 5. GESTÃO DE ACESSO E CONFIGURAÇÕES ---
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
                
                carregarPreferenciasLocalStorage();
                document.getElementById("telaLogin").style.display = "none";
                document.getElementById("conteudoApp").style.display = "block";
                
                await carregarHistorico();
                resetarTimer();
            }
        } catch (e) { console.error(e); }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

// --- 6. INTERFACE E AJUSTES (WINDOW) ---
window.salvarPreferencias = () => {
    const novoNome = document.getElementById("nomeOperadorTroca").value;
    const novaURL = document.getElementById("inputURLSefaz")?.value || configApp.urlSefaz;
    const novaUF = document.getElementById("inputUF")?.value || configApp.estadoUF;

    if (novoNome) operadorAtual = novoNome;
    configApp.urlSefaz = novaURL;
    configApp.estadoUF = novaUF;

    const objetoPrefs = {
        nomePersonalizado: novoNome,
        urlSefaz: novaURL,
        uf: novaUF,
        darkMode: document.body.classList.contains('dark-mode')
    };
    localStorage.setItem('prefsQR', JSON.stringify(objetoPrefs));
    alert("✅ Ajustes salvos!");
    resetarTimer();
};

function carregarPreferenciasLocalStorage() {
    const dados = localStorage.getItem('prefsQR');
    if (dados) {
        const prefs = JSON.parse(dados);
        if (prefs.darkMode) document.body.classList.add('dark-mode');
        if (prefs.urlSefaz) configApp.urlSefaz = prefs.urlSefaz;
        if (prefs.uf) configApp.estadoUF = prefs.uf;
        
        // Preenche os campos se eles existirem na UI
        if(document.getElementById("inputURLSefaz")) document.getElementById("inputURLSefaz").value = configApp.urlSefaz;
    }
}

// Mantendo suas outras funções (Login, Logout, UI) conforme o original...
window.fazerLogin = () => {
    const email = document.getElementById("emailLogin").value;
    const senha = document.getElementById("senhaLogin").value;
    signInWithEmailAndPassword(auth, email, senha).catch(e => alert("Erro: " + e.message));
};
window.fazerLogout = () => signOut(auth).then(() => location.reload());
window.toggleConfig = () => {
    const p = document.getElementById("painelAjustes");
    p.style.display = p.style.display === "none" ? "block" : "none";
};
window.enviarManual = () => {
    const val = document.getElementById("urlManual").value.trim();
    if (val) processarEntrada(val);
};

window.ativarScannerAoVivo = async () => {
    const btn = document.getElementById("btnLigarCamera");
    const video = document.getElementById("reader");
    btn.innerText = "⌛ Iniciando...";
    try {
        video.style.display = "block";
        const devices = await codeReader.listVideoInputDevices();
        const selectedId = devices[devices.length - 1].deviceId;
        codeReader.decodeFromVideoDevice(selectedId, 'reader', (result) => {
            if (result && !processandoAcao) processarEntrada(result.text);
        });
        btn.style.display = "none";
    } catch (e) { alert("Câmera indisponível."); btn.innerText = "🚀 LIGAR SCANNER AO VIVO"; }
};

window.lerQrDeArquivo = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => processarEntrada(img);
};

// --- RELATÓRIOS ---
async function carregarHistorico() {
    try {
        const q = query(collection(db, "scans"), where("grupo", "==", grupoAtual), orderBy("timestamp", "desc"), limit(20));
        const snap = await getDocs(q);
        listaEscaneamentos = snap.docs.map(d => d.data());
        atualizarTabela();
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
            <td>${item.operador}</td>
            <td><button onclick="window.open('${item.link}', '_blank')">🔗</button></td>
        </tr>`).join('');
}

function atualizarStatusUI(msg) {
    const st = document.getElementById("statusEnvio");
    if (!st) return;
    if (msg) { st.innerText = msg; st.style.display = "block"; }
    else st.style.display = "none";
}

function resetarTimer() {
    clearTimeout(timerInatividade);
    timerInatividade = setTimeout(() => {
        codeReader.reset();
        if(document.getElementById("reader")) document.getElementById("reader").style.display = "none";
        const b = document.getElementById("btnLigarCamera");
        if (b) { b.style.display = "block"; b.innerText = "🚀 CÂMERA EM REPOUSO (TOQUE P/ VOLTAR)"; }
    }, 180000); // 3 minutos
}

document.addEventListener("click", resetarTimer);
// Garante que os botões de busca e exportação funcionem
window.gerarRelatorio = carregarHistorico; 

window.exportarParaCSV = () => {
    if (listaEscaneamentos.length === 0) return alert("Não há dados para exportar.");
    
    let csv = "\uFEFF"; // BOM para o Excel entender acentos
    csv += "Status;Chave;Data;Operador;Grupo\n";
    
    listaEscaneamentos.forEach(item => {
        csv += `OK;${item.link};${item.data};${item.operador};${item.grupo}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', `relatorio_scans_${grupoAtual}.csv`);
    a.click();
};