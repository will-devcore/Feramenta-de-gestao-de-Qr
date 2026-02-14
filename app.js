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
    if (textoDecodificado === ultimoCodigoLido) {
        alert("ERRO: Este QR Code já foi registrado agora mesmo!");
        return; 
    }

    ultimoCodigoLido = textoDecodificado;
    
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

    alert("Sucesso! Código guardado.");
}

html5QrcodeScanner.render(aoLerSucesso, { qrbox: 250, preferredCamera: "back" });

function atualizarTabelaNaTela() {
    const corpoTabela = document.getElementById("corpoTabela");
    if (!corpoTabela) return;

    corpoTabela.innerHTML = "";
    listaEscaneamentos.forEach((item, index) => {
        corpoTabela.innerHTML += `
            <tr>
                <td><small>${item.link.substring(0, 15)}...</small></td>
                <td>${item.data}</td>
                <td>${item.operador} (${item.grupo})</td>
                <td style="text-align:center;">
                    <button onclick="removerItem(${index})" style="background:red; color:white; border:none; padding:5px 10px; border-radius:5px; font-weight:bold;">X</button>
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

let conteudoCSV = "Link;Data_Hora;Operador;Grupo\n";
listaEscaneamentos.forEach(item => {
    conteudoCSV += `${item.link};${item.data};${item.operador};${item.grupo}\n`;
});

const blob = new Blob(["\ufeff" + conteudoCSV], { type: 'text/csv;charset=utf-8;' });
const linkBaixar = document.createElement("a");
linkBaixar.href = URL.createObjectURL(blob);
linkBaixar.download = "Relatorio_QR.csv";
linkBaixar.click();
};