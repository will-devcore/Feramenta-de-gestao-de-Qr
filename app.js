/* * SCANNER QR MASTER - VERSÃO PRO 2.0 BLINDADA (FUSÃO DEFINITIVA)
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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const codeReader = new ZXing.BrowserQRCodeReader();

// --- ESTADO GLOBAL ---
let operadorAtual = "Carregando...";
let grupoAtual = "";
let isAdmin = false; 
let processandoAcao = false; 
let listaEscaneamentos = [];
let timerInatividade;

const URL_PADRAO_MG = "https://portalsped.fazenda.mg.gov.br/portalsped/sistema/consultaunificada.xhtml?chaveAcesso=";
let urlConfigurada = URL_PADRAO_MG;

// --- 1. VÍNCULOS COM O HTML (WINDOW) ---
window.fazerLogin = () => {
    const e = document.getElementById("emailLogin").value;
    const s = document.getElementById("senhaLogin").value;
    signInWithEmailAndPassword(auth, e, s).catch(err => alert("Erro: " + err.message));
};
window.fazerLogout = () => { 
    localStorage.removeItem('prefsQR'); 
    signOut(auth).then(() => location.reload()); 
};
window.toggleConfig = () => {
    const p = document.getElementById("painelAjustes");
    p.style.display = p.style.display === "none" ? "block" : "none";
};
window.toggleDarkMode = () => {
    document.body.classList.toggle("dark-mode");
    window.salvarPreferencias();
};

// --- 2. GESTÃO DE PREFERÊNCIAS E SELEÇÃO RÁPIDA ---

// --- NOVO: FILTRO DE NITIDEZ E BINARIZAÇÃO ---
function processarImagemParaLeitura(videoElement) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Define o tamanho do canvas igual ao vídeo para não perder resolução
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    
    // Desenha o frame atual do vídeo no canvas
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    
    // Captura os pixels para manipulação
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Algoritmo de Binarização por Contraste (Filtro de Nitidez)
    for (let i = 0; i < data.length; i += 4) {
        // Converte para escala de cinza (Luminosidade)
        const avg = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
        
        // Aplica o Threshold (Binarização): 
        // Se for mais escuro que 128 (meio), vira PRETO (0), senão BRANCO (255)
        // Isso remove sombras de papel amassado e reflexos de luz
        const valor = avg < 128 ? 0 : 255;
        
        data[i]     = valor; // R
        data[i + 1] = valor; // G
        data[i + 2] = valor; // B
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas; // Retorna a imagem "limpa" para o decodificador
}

async function carregarListaOperadores() {
    const select = document.getElementById("nomeOperadorTroca");
    if (!select) return;
    try {
        const q = query(collection(db, "usuarios"), where("grupo", "==", grupoAtual));
        const snap = await getDocs(q);
        let opcoes = `<option value="">-- Selecione seu Nome --</option>`;
        snap.forEach(doc => {
            const nome = doc.data().nome;
            opcoes += `<option value="${nome}" ${nome === operadorAtual ? 'selected' : ''}>${nome}</option>`;
        });
        select.innerHTML = opcoes;
    } catch (e) { console.error("Erro ao carregar nomes:", e); }
}

window.salvarPreferencias = () => {
    const nomeSel = document.getElementById("nomeOperadorTroca").value;
    const urlSel = document.getElementById("inputURLSefaz").value;
    const tempoSel = document.getElementById("setInatividade").value;
    const darkMode = document.body.classList.contains('dark-mode');

    const prefs = {
        nome: nomeSel || operadorAtual,
        url: urlSel || URL_PADRAO_MG,
        tempo: tempoSel,
        dark: darkMode
    };

    localStorage.setItem('prefsQR', JSON.stringify(prefs));
    operadorAtual = prefs.nome;
    urlConfigurada = prefs.url;
    
    document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
    alert("✅ Ajustes salvos no dispositivo!");
    resetarTimer();
};

function carregarPreferenciasLocais() {
    const salvas = localStorage.getItem('prefsQR');
    if (salvas) {
        const p = JSON.parse(salvas);
        operadorAtual = p.nome;
        urlConfigurada = p.url || URL_PADRAO_MG;
        if (p.dark) document.body.classList.add('dark-mode');
        
        if(document.getElementById("setInatividade")) document.getElementById("setInatividade").value = p.tempo || "180000";
        if(document.getElementById("inputURLSefaz")) document.getElementById("inputURLSefaz").value = urlConfigurada;
    }
}

// --- 3. MONITOR DE ACESSO (FIREBASE) ---

onAuthStateChanged(auth, async (user) => {
    carregarPreferenciasLocais(); 

    if (user) {
        const userDoc = await getDoc(doc(db, "usuarios", user.uid));
        if (userDoc.exists()) {
            const d = userDoc.data();
            grupoAtual = d.grupo;
            isAdmin = (d.cargo === "admin");

            // Se for a primeira vez ou estiver vazio, usa o nome do cadastro
            if (operadorAtual === "Carregando...") {
                operadorAtual = d.nome;
            }

            await carregarListaOperadores(); // Popula o Select de Nomes

            document.getElementById("infoUsuario").innerText = `Operador: ${operadorAtual} (${grupoAtual})`;
            document.getElementById("telaLogin").style.display = "none";
            document.getElementById("conteudoApp").style.display = "block";
            
            configurarFiltrosAdmin();
            await carregarHistorico();
            resetarTimer();
        }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});

// --- 4. MOTOR DE CAPTURA E RECONSTRUÇÃO ---

function validarChaveNF(chave) {
    const limpa = chave.replace(/\D/g, '');
    if (limpa.length !== 44) return false;
    let soma = 0, peso = 2;
    for (let i = 42; i >= 0; i--) {
        soma += parseInt(limpa[i]) * peso;
        peso = (peso === 9) ? 2 : peso + 1;
    }
    const resto = soma % 11;
    const dv = (resto === 0 || resto === 1) ? 0 : 11 - resto;
    return dv === parseInt(limpa[43]);
}

let chaveTemporaria = "";

// --- FUNÇÃO MAESTRO: PROCESSAR ENTRADA ---
async function processarEntrada(texto) {
    if (processandoAcao) return;
    processandoAcao = true;

    console.log("Conteúdo bruto lido:", texto);

    // 1. EXTRAÇÃO: Remove tudo que não é número
    // Isso limpa links da SEFAZ, protocolos e textos extras
    const apenasNumeros = texto.replace(/\D/g, '');

    // 2. FILTRAGEM: Pegamos apenas os primeiros 44 dígitos
    // (Se o scanner ler 70, ele ignora os 26 finais que costumam ser lixo)
    const chaveSugestao = apenasNumeros.substring(0, 44);

    if (chaveSugestao.length > 0) {
        // 3.DIRECIONAMENTO: Abre o modal para o operador conferir e editar
        abrirModalConferencia(chaveSugestao);
    } else {
        alert("❌ Não foi possível identificar números no QR Code. Tente focar melhor ou use a Recuperação Híbrida.");
    }

    processandoAcao = false;
}

// --- FUNÇÃO DE APOIO: MONTAGEM DO GRID DE CONFERÊNCIA ---
function abrirModalConferencia(numeros) {
    const modal = document.getElementById("modalConferencia");
    const grid = document.getElementById("gridChave");
    
    // Limpa o grid antes de gerar
    grid.innerHTML = "";

    // Gera os 11 blocos de 4 dígitos
    for (let i = 0; i < 11; i++) {
        let trecho = numeros.substring(i * 4, (i * 4) + 4);
        
        // Criamos o input com o "pulo automático" (focus) para o próximo campo
        grid.innerHTML += `
            <input type="number" 
                   class="input-chave-bloco" 
                   id="bloco${i}" 
                   value="${trecho}" 
                   placeholder="0000"
                   oninput="if(this.value.length >= 4 && ${i} < 10) document.getElementById('bloco${i+1}').focus()"
            >`;
    }

    // Exibe o modal na tela
    modal.style.display = "block";

    // Para o scanner para não ficar tentando ler enquanto o usuário edita
    if (window.codeReader) {
        window.codeReader.reset();
        document.getElementById("reader").style.display = "none";
        document.getElementById("btnLigarCamera").style.display = "block";
    }
    document.addEventListener('keydown', function(event) {
    if (event.key === 'Backspace' && event.target.classList.contains('input-chave-bloco')) {
        const input = event.target;
        if (input.value.length === 0) {
            const idAtual = parseInt(input.id.replace('bloco', ''));
            if (idAtual > 0) {
                document.getElementById(`bloco${idAtual - 1}`).focus();
            }
        }
    }
});
}


window.confirmarEnvioFinal = async () => {
    let chaveMontada = "";
    for (let i = 0; i < 11; i++) {
        // Pega o valor de cada uma das 11 caixinhas
        chaveMontada += document.getElementById(`bloco${i}`).value;
    }

    // AQUI A FUNÇÃO É CHAMADA (Ela deixará de ser transparente no editor)
    if (!validarChaveNF(chaveMontada)) {
        alert("⚠️ ATENÇÃO: Os números digitados não formam uma chave válida (Dígito Verificador incorreto). Por favor, confira a nota!");
        return; // Impede o salvamento de dados errados
    }

    const link = urlConfigurada + chaveMontada;
    await salvarNoFirebase(link);
    fecharModal();
};

window.fecharModal = () => {
    document.getElementById("modalConferencia").style.display = "none";
    document.getElementById("btnLigarCamera").style.display = "block"; // Permite ligar a câmera de novo
};

async function salvarNoFirebase(link) {
    try {
        const q = query(collection(db, "scans"), where("link", "==", link), where("grupo", "==", grupoAtual));
        const snap = await getDocs(q);
        if (!snap.empty) return alert("⚠️ Nota já registrada por este grupo!");

        await addDoc(collection(db, "scans"), {
            link: link,
            data: new Date().toLocaleString('pt-BR'),
            operador: operadorAtual,
            grupo: grupoAtual,
            timestamp: Date.now()
        });
        
        // Alerta sonoro ou feedback visual
        const status = document.getElementById("statusEnvio");
        if(status) { status.innerText = "✅ SALVO!"; status.style.display="block"; setTimeout(()=>status.style.display="none", 1500); }
        
        document.getElementById("urlManual").value = "";
        await carregarHistorico();
    } catch (e) { alert("Erro ao salvar."); }
}

// --- 5. INTERFACE E DISPOSITIVOS ---

window.ativarScannerAoVivo = async () => {
    const video = document.getElementById("reader");
    video.style.display = "block";
    document.getElementById("btnLigarCamera").style.display = "none";

    try {
        const devices = await codeReader.listVideoInputDevices();
        const selectedDevice = devices[devices.length - 1].deviceId;

        // Inicia o stream da câmera sem o ZXing ler direto
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { deviceId: selectedDevice, focusMode: 'continuous' } 
        });
        video.srcObject = stream;
        video.play();

        // Loop de processamento manual
        const scanLoop = async () => {
            if (processandoAcao || video.paused || video.ended) return;

            // 1. Processa o frame com o nosso filtro de binarização
            const canvasLimpo = processarImagemParaLeitura(video);

            try {
                // 2. Tenta decodificar a partir da imagem binarizada (Muito mais nítido!)
                const res = await codeReader.decodeFromCanvas(canvasLimpo);
                if (res) processarEntrada(res.text);
            } catch (err) {
                // Se não ler, continua tentando no próximo frame (FPS definido no seu select)
                const fps = parseInt(document.getElementById("setFPS").value) || 25;
                setTimeout(() => requestAnimationFrame(scanLoop), 1000 / fps);
            }
        };

        requestAnimationFrame(scanLoop);

    } catch (e) {
        alert("Erro ao acessar câmera: " + e.message);
        document.getElementById("btnLigarCamera").style.display = "block";
    }
};

window.lerQrDeArquivo = (e) => {
    const file = e.target.files[0];
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = async () => {
        try {
            const res = await codeReader.decodeFromImageElement(img);
            processarEntrada(res.text);
        } catch {
            const { data: { text } } = await Tesseract.recognize(img, 'por');
            processarEntrada(text);
        }
    };
};

async function carregarHistorico() {
    const g = document.getElementById("filtroGrupo").value;
    const q = (g === "todos" && isAdmin) ? 
        query(collection(db, "scans"), orderBy("timestamp", "desc"), limit(50)) :
        query(collection(db, "scans"), where("grupo", "==", grupoAtual), orderBy("timestamp", "desc"), limit(30));
    
    const snap = await getDocs(q);
    listaEscaneamentos = snap.docs.map(d => d.data());
    const corpo = document.getElementById("corpoTabela");
    corpo.innerHTML = listaEscaneamentos.map(i => `
        <tr>
            <td style="color: green">✅</td>
            <td style="font-size:11px; font-family: monospace;">${i.link.substring(i.link.length - 44)}</td>
            <td>${i.data.split(' ')[0]}</td>
            <td>${i.operador}</td>
            <td><button class="btn-tabela" onclick="window.open('${i.link}', '_blank')">🔗</button></td>
        </tr>`).join('');
}

function configurarFiltrosAdmin() {
    const sel = document.getElementById("filtroGrupo");
    if (isAdmin) {
        sel.innerHTML = `<option value="${grupoAtual}">${grupoAtual}</option><option value="todos">Todos os Grupos</option>`;
        sel.disabled = false;
    } else {
        sel.innerHTML = `<option>${grupoAtual}</option>`;
        sel.disabled = true;
    }
}

window.gerarRelatorio = () => carregarHistorico();
window.enviarManual = () => {
    const val = document.getElementById("urlManual").value.replace(/\s/g, '');
    if (val) processarEntrada(val);
};

window.exportarParaCSV = () => {
    let csv = "\uFEFFLink;Data;Operador;Grupo\n";
    listaEscaneamentos.forEach(i => csv += `${i.link};${i.data};${i.operador};${i.grupo}\n`);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Relatorio_${grupoAtual}.csv`;
    a.click();
};

function resetarTimer() {
    clearTimeout(timerInatividade);
    const t = parseInt(document.getElementById("setInatividade").value);
    if (t > 0) {
        timerInatividade = setTimeout(() => {
            codeReader.reset();
            document.getElementById("reader").style.display = "none";
            document.getElementById("btnLigarCamera").style.display = "block";
            document.getElementById("btnLigarCamera").innerText = "🚀 CÂMERA EM REPOUSO (TOQUE P/ VOLTAR)";
        }, t);
    }
}

document.addEventListener("click", resetarTimer);

// Máscara Visual para o campo manual
document.getElementById("urlManual").oninput = function() {
    this.value = this.value.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ').substring(0, 55);
};