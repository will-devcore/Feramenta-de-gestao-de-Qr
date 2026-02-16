import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// --- CONFIGURAÇÃO (COLE SUAS CREDENCIAIS AQUI) ---
const firebaseConfig = {
apiKey: "AIzaSyA-Un2ijd0Ao-sIeVFjq5lWU-0wBfwrEhk",
authDomain: "https://www.google.com/search?q=sistema-qr-master.firebaseapp.com",
projectId: "sistema-qr-master",
storageBucket: "https://www.google.com/search?q=sistema-qr-master.appspot.com",
messagingSenderId: "587607393218",
appId: "1:587607393218:web:1cc6d38577f69cc0110c5b"
};

console.log("1. Script carregado e Firebase iniciando...");
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- FUNÇÃO DE LOGIN GLOBAL ---
window.fazerLogin = function() {
    const email = document.getElementById("emailLogin").value;
    const senha = document.getElementById("senhaLogin").value;
    
    console.log("2. Tentando login com:", email);

    signInWithEmailAndPassword(auth, email, senha)
        .then((userCredential) => {
            console.log("3. Auth do Firebase deu OK!");
        })
        .catch((error) => {
            console.error("ERRO NO AUTH:", error.code, error.message);
            alert("Erro de autenticação: " + error.message);
        });
};

// --- OBSERVADOR DE ESTADO ---
onAuthStateChanged(auth, async (user) => {
    const telaLogin = document.getElementById("telaLogin");
    const conteudoApp = document.getElementById("conteudoApp");

    if (user) {
        console.log("4. Usuário logado detectado. UID:", user.uid);
        
        try {
            const docRef = doc(db, "usuarios", user.uid);
            const userDoc = await getDoc(docRef);

            if (userDoc.exists()) {
                console.log("5. Perfil encontrado no Firestore!", userDoc.data());
                const dados = userDoc.data();
                
                document.getElementById("infoUsuario").innerText = `Operador: ${dados.nome} (${dados.grupo})`;
                telaLogin.style.display = "none";
                conteudoApp.style.display = "block";
            } else {
                console.warn("ALERTA: Documento não existe para o UID:", user.uid);
                alert("Perfil não configurado no banco. Fale com o Admin.");
                signOut(auth);
            }
        } catch (error) {
            console.error("ERRO AO BUSCAR FIRESTORE:", error);
            alert("Erro ao ler banco de dados. Verifique as Regras de Segurança.");
        }
    } else {
        console.log("X. Nenhum usuário logado.");
        telaLogin.style.display = "block";
        conteudoApp.style.display = "none";
    }
});

window.fazerLogout = () => signOut(auth).then(() => location.reload());