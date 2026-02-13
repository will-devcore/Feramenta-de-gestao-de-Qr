// --- VARIÁVEIS GLOBAIS ---
// Criamos uma lista (Array) vazia para guardar os escaneamentos temporariamente
let listaEscaneamentos = [];

// --- CONFIGURAÇÃO DO SCANNER ---
// Criamos uma nova instância do scanner e apontamos para o ID 'reader' do HTML
const html5QrcodeScanner = new Html5QrcodeScanner("reader", { 
    fps: 10, // Velocidade: 10 quadros por segundo
    qrbox: { width: 250, height: 250 } // Área útil de leitura (o quadradinho)
});

// --- FUNÇÃO DE SUCESSO ---
// Esta função roda toda vez que a câmera lê um QR Code
function aoLerSucesso(textoDecodificado) {
    // Pegamos a data e hora do momento exato da leitura
    const agora = new Date();
    const dataFormatada = agora.toLocaleString('pt-BR');

    // Criamos um objeto 'item' com as informações que você quer correlacionar
    const itemEscaneado = {
        link: textoDecodificado, // O link que estava no QR Code
        data: dataFormatada,     // A data/hora escrita
        operador: "Admin Teste", // Nome fixo por enquanto (até termos o login)
        grupo: "Grupo 01"        // Grupo fixo por enquanto
    };

    // Adicionamos esse item no topo da nossa lista
    listaEscaneamentos.unshift(itemEscaneado);

    // Chamamos a função para mostrar esses dados na tabela do site
    atualizarTabelaNaTela();
    
    // Alerta visual para o operador saber que funcionou
    console.log("Link capturado: " + textoDecodificado);
}

// Ativa o scanner de fato
html5QrcodeScanner.render(aoLerSucesso);

// --- FUNÇÃO PARA MOSTRAR OS DADOS NA TABELA ---
function atualizarTabelaNaTela() {
    const corpoTabela = document.getElementById("corpoTabela");
    corpoTabela.innerHTML = ""; // Limpa a tabela antes de colocar os novos dados

    // Para cada item na nossa lista, criamos uma linha (tr) na tabela
    listaEscaneamentos.forEach(item => {
        const linha = `
            <tr>
                <td>${item.link}</td>
                <td>${item.data}</td>
                <td>${item.operador}</td>
            </tr>
        `;
        corpoTabela.innerHTML += linha;
    });
}

// --- FUNÇÃO DE EXPORTAÇÃO PARA EXCEL (CSV) ---
function exportarParaCSV() {
    // Definimos o cabeçalho do arquivo. O Excel entende o ';' como separador de colunas.
    let conteudoCSV = "Link;Data_Hora;Operador;Grupo\n";

    // Percorremos a lista e adicionamos cada escaneamento ao texto do arquivo
    listaEscaneamentos.forEach(item => {
        conteudoCSV += `${item.link};${item.data};${item.operador};${item.grupo}\n`;
    });

    // Criamos um 'Blob' (um arquivo binário de texto)
    const blob = new Blob([conteudoCSV], { type: 'text/csv;charset=utf-8;' });
    
    // Criamos um link de download invisível e clicamos nele via código
    const linkBaixar = document.createElement("a");
    linkBaixar.href = URL.createObjectURL(blob);
    linkBaixar.download = "Relatorio_QR_Master.csv"; // Nome do arquivo que será baixado
    linkBaixar.click();
}