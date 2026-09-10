/* PROVA DE FOGO — entrarPorNick de ponta a ponta, tudo de verdade:
   Cloud Function real (emulada), Auth real, REST real contra o
   emulador, Firestore real. Nada simulado além dos três emuladores
   rodando localmente.

   npm run test:login  (roda os três emuladores juntos)
   ou direto:
   firebase emulators:exec --only firestore,auth,functions --project demo-quem-sou-eu "node test-login-server-emulador.js"

   Sem isso, test-login-server.js só prova que a LÓGICA está certa com
   dependências de mentira — não prova que a Function de verdade, o
   Admin SDK e a chamada REST pro emulador de Auth realmente se
   encaixam. Foi rodando ESTE tipo de teste, contra o Firestore de
   verdade, que apareceu o bug do runTransaction em firestore-fake.js —
   dependência simulada demais esconde bug de integração.
*/
const { initializeApp } = require("firebase/app");
const {
  getAuth, connectAuthEmulator, createUserWithEmailAndPassword,
  signInWithCustomToken, signOut
} = require("firebase/auth");
const {
  getFirestore, connectFirestoreEmulator, doc, setDoc
} = require("firebase/firestore");
const {
  getFunctions, connectFunctionsEmulator, httpsCallable
} = require("firebase/functions");

let ok = 0, falhas = [];
function t(nome, cond, extra){
  if (cond) ok++; else falhas.push(nome + (extra ? " — " + extra : ""));
}
const pega = async p => { try { return { v: await p }; } catch(e){ return { e: e.code, msg: e.message }; } };

(async function(){
  const app = initializeApp({ projectId: "demo-quem-sou-eu", apiKey: "fake-key-emulador" });
  const auth = getAuth(app);
  const db = getFirestore(app);
  const fns = getFunctions(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(fns, "127.0.0.1", 5001);

  const entrarPorNick = httpsCallable(fns, "entrarPorNick");
  const m = Date.now().toString(36).slice(-6);
  const EMAIL = "login-" + m + "@exemplo-teste.com";
  const SENHA = "134312";
  const NICK = "loginteste" + m;

  console.log("\nPROVA DE FOGO — login por nick, emuladores de verdade\n");

  /* cadastro real, e o próprio dono reserva o nick (satisfaz a regra) */
  const cred = await createUserWithEmailAndPassword(auth, EMAIL, SENHA);
  const uidOriginal = cred.user.uid;
  await setDoc(doc(db, "nicks/" + NICK), { uid: uidOriginal, chave: NICK, nick: NICK, em: Date.now() });
  await signOut(auth);
  t("preparo: usuário criado e nick reservado, agora deslogado", !auth.currentUser);

  /* ---- o caminho feliz ---- */
  const r1 = await pega(entrarPorNick({ nick: NICK, senha: SENHA }));
  t("função devolve um token, sem estar logado antes", !!(r1.v && r1.v.data && r1.v.data.token),
    JSON.stringify(r1));

  if (r1.v && r1.v.data && r1.v.data.token){
    const cred2 = await signInWithCustomToken(auth, r1.v.data.token);
    t("o token de verdade autentica, e é o MESMO usuário",
      cred2.user.uid === uidOriginal, cred2.user.uid + " vs " + uidOriginal);
    await signOut(auth);
  }

  /* ---- senha errada ---- */
  const r2 = await pega(entrarPorNick({ nick: NICK, senha: "000000" }));
  t("senha errada é recusada", r2.e === "functions/unauthenticated", JSON.stringify(r2));

  /* ---- nick que não existe ---- */
  const r3 = await pega(entrarPorNick({ nick: "naoexisteninguem" + m, senha: SENHA }));
  t("nick inexistente é recusado", r3.e === "functions/unauthenticated", JSON.stringify(r3));

  /* ---- a mensagem não distingue os dois casos ---- */
  t("senha errada e nick inexistente dão a MESMA mensagem",
    r2.msg === r3.msg, JSON.stringify([r2.msg, r3.msg]));

  /* ---- login por e-mail continua funcionando normalmente ---- */
  const cred3 = await pega(require("firebase/auth").signInWithEmailAndPassword(auth, EMAIL, SENHA));
  t("login por e-mail direto continua funcionando", cred3.v && cred3.v.user.uid === uidOriginal,
    JSON.stringify(cred3.e || "ok"));

  console.log("\n" + ok + " passaram, " + falhas.length + " falharam");
  if (falhas.length){ falhas.forEach(f => console.log("  x " + f)); }
  process.exit(falhas.length ? 1 : 0);
})().catch(function(e){ console.error("ERRO GERAL:", e); process.exit(1); });
