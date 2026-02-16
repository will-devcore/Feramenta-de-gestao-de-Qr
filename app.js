import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
apiKey: "AIzaSyA-Un2ijd0Ao-sIeVFjq5lWU-0wBfwrEhk",
authDomain: "https://www.google.com/search?q=sistema-qr-master.firebaseapp.com",
projectId: "sistema-qr-master",
storageBucket: "https://www.google.com/search?q=sistema-qr-master.appspot.com",
messagingSenderId: "587607393218",
appId: "1:587607393218:web:1cc6d38577f69cc0110c5b"
};

const app = initializeApp(firebaseConfig); // Conferido: initializeApp com dois 'p'
const db = getFirestore(app);
const auth = getAuth(app);

window.fazerLogin = function() {
    const email = document.getElementById("emailLogin").value;
    const senha = document.getElementById("senhaLogin").value;
    signInWithEmailAndPassword(auth, email, senha).catch(e => alert("Erro: " + e.message));
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            // Pequena pausa para o Firebase processar a permissão
            await new Promise(r => setTimeout(r, 500)); 
            
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            if (userDoc.exists()) {
                const dados = userDoc.data();
                document.getElementById("infoUsuario").innerText = `Operador: ${dados.nome} (${dados.grupo})`;
                document.getElementById("telaLogin").style.display = "none";
                document.getElementById("conteudoApp").style.display = "block";
            } else {
                alert("Usuário logado, mas perfil não encontrado no banco.");
            }
        } catch (error) {
            console.error(error);
            alert("Erro de permissão no banco. Verifique as Regras de Segurança no Console.");
        }
    } else {
        document.getElementById("telaLogin").style.display = "block";
        document.getElementById("conteudoApp").style.display = "none";
    }
});