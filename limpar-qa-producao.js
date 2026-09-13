/* Apaga só as 10 contas do Auth criadas por test-qa-producao.js (autosserviço,
   já que sabemos a senha de cada uma). As coleções do Firestore são apagadas
   à parte, via `firebase firestore:delete` (bypassa regra, mais rápido).
   node limpar-qa-producao.js */
const { initializeApp } = require("firebase/app");
const { getAuth, signInWithEmailAndPassword, deleteUser } = require("firebase/auth");
const CONFIG = require("./firebase-config.js");

const PERSONAS = [
  { email: "ana.martins95@exemplo-teste.com",      senha: "482910" },
  { email: "bruno.costa88@exemplo-teste.com",      senha: "719345" },
  { email: "carla.souza91@exemplo-teste.com",      senha: "364827" },
  { email: "diego.rocha87@exemplo-teste.com",      senha: "590172" },
  { email: "elisa.gomes93@exemplo-teste.com",      senha: "813627" },
  { email: "felipe.dias90@exemplo-teste.com",      senha: "247158" },
  { email: "gabriela.lima96@exemplo-teste.com",    senha: "605931" },
  { email: "henrique.melo85@exemplo-teste.com",    senha: "938214" },
  { email: "isabela.teixeira94@exemplo-teste.com", senha: "156789" },
  { email: "joao.andrade89@exemplo-teste.com",     senha: "402568" },
];

(async function(){
  for (let i = 0; i < PERSONAS.length; i++){
    const p = PERSONAS[i];
    const app = initializeApp(CONFIG, "cleanup" + i);
    const auth = getAuth(app);
    try {
      const cred = await signInWithEmailAndPassword(auth, p.email, p.senha);
      await deleteUser(cred.user);
      console.log("  apagado: " + p.email);
    } catch (e){
      console.log("  pulado (" + (e.code || e.message) + "): " + p.email);
    }
  }
})();
