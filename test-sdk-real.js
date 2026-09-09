/* Confere o adaptador contra o SDK REAL do Firebase — sem rede, sem
   emulador, sem credencial. Não valida comportamento (isso exige o
   emulador, que precisa de Java); valida a SUPERFÍCIE: se um nome que
   o adaptador chama não existir, ou mudar de assinatura numa versão
   futura, isso quebra aqui em vez de quebrar no celular de alguém.

   node test-sdk-real.js */
const criarDbFirestore = require("./firestore-adapter.js");
const fsSdk = require("firebase/firestore");
const appSdk = require("firebase/app");
const authSdk = require("firebase/auth");
const versao = require("firebase/package.json").version;

let ok = 0, falhas = [];
function t(nome, cond, extra){
  if (cond) ok++; else falhas.push(nome + (extra ? " — " + extra : ""));
}

/* ---- 1. Tudo que o adaptador injeta precisa existir e ser função ---- */
const precisa = ["doc","collection","getDoc","getDocs","setDoc","updateDoc",
                 "deleteDoc","onSnapshot","runTransaction","query","where",
                 "orderBy","limit","getFirestore"];
precisa.forEach(function(n){
  t("firestore exporta " + n + "()", typeof fsSdk[n] === "function", typeof fsSdk[n]);
});

/* ---- 2. O que o boot usa fora do adaptador ---- */
t("app exporta initializeApp()", typeof appSdk.initializeApp === "function");
["getAuth","signInWithEmailLink","sendSignInLinkToEmail","isSignInWithEmailLink",
 "onAuthStateChanged","signOut"].forEach(function(n){
  t("auth exporta " + n + "()", typeof authSdk[n] === "function", typeof authSdk[n]);
});

/* ---- 3. exists é MÉTODO no SDK modular ----
   O contrato da capability expõe como propriedade. Se um dia o SDK
   voltar atrás, o adaptador já trata os dois — mas é bom saber. */
t("DocumentSnapshot.exists é método",
  typeof fsSdk.DocumentSnapshot.prototype.exists === "function",
  typeof fsSdk.DocumentSnapshot.prototype.exists);

/* ---- 4. As sentinelas que precisam continuar sendo FOLHA no achatar ----
   Se ehMapaSimples() achatasse um Timestamp, gravaria {seconds, nanoseconds}
   soltos e destruiria o valor. */
{
  const db = criarDbFirestore({ db: {}, doc: () => ({}), collection: () => ({}) });
  const achatar = db._achatar;

  const ts = new fsSdk.Timestamp(1700000000, 0);
  t("Timestamp real não é achatado",
    Object.keys(achatar({ criadoEm: ts })).join(",") === "criadoEm",
    Object.keys(achatar({ criadoEm: ts })).join(","));

  const gp = new fsSdk.GeoPoint(-23.5, -46.6);
  t("GeoPoint real não é achatado",
    Object.keys(achatar({ onde: gp })).join(",") === "onde",
    Object.keys(achatar({ onde: gp })).join(","));

  const fv = fsSdk.serverTimestamp();
  t("serverTimestamp() não é achatado",
    Object.keys(achatar({ quando: fv })).join(",") === "quando",
    Object.keys(achatar({ quando: fv })).join(","));

  const inc = fsSdk.increment(1);
  t("increment() não é achatado",
    Object.keys(achatar({ n: inc })).join(",") === "n",
    Object.keys(achatar({ n: inc })).join(","));

  const arr = fsSdk.arrayUnion("x");
  t("arrayUnion() não é achatado",
    Object.keys(achatar({ tags: arr })).join(",") === "tags",
    Object.keys(achatar({ tags: arr })).join(","));

  /* e o caso oposto: mapa comum PRECISA ser achatado, senão o
     update do histórico apaga as partidas anteriores */
  t("mapa comum continua sendo achatado",
    Object.keys(achatar({ items: { p1: { n: 1 } } })).join(",") === "items.p1.n",
    Object.keys(achatar({ items: { p1: { n: 1 } } })).join(","));
}

/* ---- 5. O app inicializa com a config real (offline, sem rede) ---- */
{
  const CONFIG = require("./firebase-config.js");
  t("config tem projectId", CONFIG.projectId === "quem-sou-eu-e3e32", CONFIG.projectId);
  t("config tem authDomain", /firebaseapp\.com$/.test(CONFIG.authDomain), CONFIG.authDomain);
  t("config tem apiKey", typeof CONFIG.apiKey === "string" && CONFIG.apiKey.length > 20);

  let app = null, erro = null;
  try { app = appSdk.initializeApp(CONFIG, "teste-surface"); }
  catch(e){ erro = e.message; }
  t("initializeApp aceita a config", !!app && !erro, String(erro));

  let db = null;
  try { db = fsSdk.getFirestore(app); } catch(e){ erro = e.message; }
  t("getFirestore devolve uma instância", !!db, String(erro));

  /* o adaptador monta em cima de uma instância real */
  let adaptado = null;
  try {
    adaptado = criarDbFirestore({
      db: db, doc: fsSdk.doc, collection: fsSdk.collection,
      getDoc: fsSdk.getDoc, getDocs: fsSdk.getDocs, setDoc: fsSdk.setDoc,
      updateDoc: fsSdk.updateDoc, deleteDoc: fsSdk.deleteDoc,
      onSnapshot: fsSdk.onSnapshot, runTransaction: fsSdk.runTransaction,
      query: fsSdk.query, where: fsSdk.where, orderBy: fsSdk.orderBy, limit: fsSdk.limit
    });
  } catch(e){ erro = e.message; }
  t("adaptador monta sobre o Firestore real", !!adaptado, String(erro));

  /* referências resolvem sem tocar a rede */
  let ref = null;
  try { ref = adaptado.doc("salas/ABC"); } catch(e){ erro = e.message; }
  t("db.doc() resolve um caminho real", !!ref && ref.id === "ABC", String(erro));
  t("ref.collection() encadeia", !!ref && !!ref.collection("jogadores"));
  t("caminho inválido ainda é recusado antes de sair da máquina",
    (function(){ try { adaptado.doc("salas"); return false; } catch(e){ return true; } })());
}

console.log("\nfirebase " + versao + " · " + ok + " passaram, " + falhas.length + " falharam");
if (falhas.length){ falhas.forEach(f => console.log("  x " + f)); process.exit(1); }
