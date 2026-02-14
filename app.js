import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
let listaEscaneamentos = [];
let ultimoCodigoLido = "";

// Pergunta o nome e o grupo se não estiverem salvos no celular
let operadorAtual = localStorage.getItem("operador") || prompt("Digite seu nome de Operador:") || "Visitante";
let grupoAtual = localStorage.getItem("grupo") || prompt("Digite seu Grupo (ex: Grupo 01):") || "Geral";

// Salva para não ter que digitar toda vez
localStorage.setItem("operador", operadorAtual);
localStorage.setItem("grupo", grupoAtual);

// ATUALIZA A TELA: Substitui o "Carregando..." pelo nome real
const pInfo = document.getElementById("infoUsuario");
if (pInfo) {
    pInfo.innerText = `Operador: ${operadorAtual} | Grupo: ${grupoAtual}`;
}

async function enviarParaNuvem(link, data, operador, grupo) {
try {
await addDoc(collection(db, "scans"), {
link: link,
data: data,
operador: operador,
grupo: grupo
});
console.log("Salvo no Firebase!");
} catch (e) {
console.error("Erro ao salvar: ", e);
}
}

const html5QrcodeScanner = new Html5QrcodeScanner("reader", {
fps: 10,
qrbox: { width: 250, height: 250 }
});

function aoLerSucesso(textoDecodificado) {
    // VERIFICAÇÃO DE OURO: Procura se esse link já existe na lista atual
    const jaExiste = listaEscaneamentos.some(item => item.link === textoDecodificado);

    if (jaExiste) {
        alert("⚠️ ERRO: Este link já foi escaneado e já está na lista!");
        return; // Para tudo aqui e não salva nada
    }

    // Se passou pela trava, segue o processo normal
    const agora = new Date();
    const dataFormatada = agora.toLocaleString('pt-BR');
    const item = {
        link: textoDecodificado,
        data: dataFormatada,
        operador: operadorAtual,
        grupo: grupoAtual
    };

    listaEscaneamentos.unshift(item);
    atualizarTabelaNaTela();
    enviarParaNuvem(item.link, item.data, item.operador, item.grupo);

    alert("✅ QR Code registrado com sucesso!");
}

html5QrcodeScanner.render(aoLerSucesso, { qrbox: 250, preferredCamera: "back" });

function atualizarTabelaNaTela() {
    const corpoTabela = document.getElementById("corpoTabela");
    if (!corpoTabela) return;

    corpoTabela.innerHTML = "";
    listaEscaneamentos.forEach((item, index) => {
        // Corta o link para mostrar apenas os primeiros 15 caracteres + ...
        const linkCurto = item.link.length > 15 ? item.link.substring(0, 15) + "..." : item.link;

        corpoTabela.innerHTML += `
            <tr>
                <td title="${item.link}" style="font-size: 11px; color: #007bff;">${linkCurto}</td>
                <td style="font-size: 11px;">${item.data}</td>
                <td style="font-size: 11px;">${item.operador}</td>
                <td style="text-align:center;">
                    <button onclick="removerItem(${index})" style="background:#ff4d4d; color:white; border:none; padding:4px 8px; border-radius:4px; font-size: 10px; font-weight:bold;">X</button>
                </td>
            </tr>`;
    });
}

window.removerItem = function(index) {
if(confirm("Deseja apagar este escaneamento?")) {
listaEscaneamentos.splice(index, 1);
atualizarTabelaNaTela();
}
};

window.exportarParaCSV = function() {
    if (listaEscaneamentos.length === 0) {
        alert("Não há dados para exportar ainda!");
        return;
    }

    // Cabeçalho do arquivo Excel
    let conteudoCSV = "Link Completo;Data e Hora;Operador;Grupo\n";

    listaEscaneamentos.forEach(item => {
        // Aqui usamos item.link (o link original sem cortes)
        conteudoCSV += `${item.link};${item.data};${item.operador};${item.grupo}\n`;
    });

    // Cria o arquivo com codificação que o Excel entende (UTF-8 com BOM)
    const blob = new Blob(["\ufeff" + conteudoCSV], { type: 'text/csv;charset=utf-8;' });
    const linkBaixar = document.createElement("a");
    linkBaixar.href = URL.createObjectURL(blob);
    linkBaixar.download = `Relatorio_QR_${operadorAtual}.csv`;
    linkBaixar.click();
};