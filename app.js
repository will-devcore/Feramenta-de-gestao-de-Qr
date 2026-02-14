import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
// SUAS CHAVES AQUI
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
let listaEscaneamentos = [];
let ultimoCodigoLido = "";

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
return;
}
ultimoCodigoLido = textoDecodificado;

const agora = new Date();
const dataFormatada = agora.toLocaleString('pt-BR');
const item = {
    link: textoDecodificado,
    data: dataFormatada,
    operador: "Admin Inicial",
    grupo: "Grupo 01"
};

listaEscaneamentos.unshift(item);
atualizarTabelaNaTela();
enviarParaNuvem(item.link, item.data, item.operador, item.grupo);

alert("QR Code Escaneado com Sucesso!");

setTimeout(() => { ultimoCodigoLido = ""; }, 3000);
}

html5QrcodeScanner.render(aoLerSucesso, { qrbox: 250, preferredCamera: "back" });

function atualizarTabelaNaTela() {
const corpoTabela = document.getElementById("corpoTabela");
if (!corpoTabela) return;

corpoTabela.innerHTML = "";
listaEscaneamentos.forEach((item, index) => {
    corpoTabela.innerHTML += `
        <tr>
            <td>${item.link}</td>
            <td>${item.data}</td>
            <td style="text-align:center;">
                <button onclick="removerItem(${index})" style="background:red; color:white; border:none; padding:5px; border-radius:5px; cursor:pointer;">X</button>
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