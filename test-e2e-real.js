/* Ponta a ponta contra o projeto REAL — cria contas de verdade.

   Fora da bateria de propósito: toca a rede, gasta cota e deixa dois
   perfis no banco (a regra proíbe apagar perfis/, porque salas são
   permanentes). Rode à mão quando quiser provar que a corrente inteira
   funciona de ponta a ponta: Auth, Firestore, regras e contas.js.

   Foi ele que provou que o cadastro funciona depois que o provedor de
   e-mail e senha foi ativado no console.

   node test-e2e-real.js */
const { initializeApp } = require("firebase/app");
const { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
        signOut, deleteUser } = require("firebase/auth");
const fsSdk = require("firebase/firestore");
const criarDbFirestore = require("./firestore-adapter.js");
const CONFIG = require("./firebase-config.js");
const { CriarContas } = require("./contas.js");

const m = Date.now().toString(36).slice(-5);
const A = { email: "e2e-a-" + m + "@exemplo-teste.com", senha: "134312", nick: "e2ea" + m, nome: "Ana Teste" };
const B = { email: "e2e-b-" + m + "@exemplo-teste.com", senha: "134312", nick: "e2eb" + m, nome: "Bia Teste" };

let ok = 0; const falhas = [];
function t(nome, cond, extra){
  if (cond){ ok++; console.log("  ok    " + nome); }
  else { falhas.push(nome); console.log("  FALHA " + nome + (extra ? " — " + extra : "")); }
}
const pega = async p => { try { return { v: await p }; } catch(e){ return { e: e.code || e.message }; } };

(async function(){
  const app = initializeApp(CONFIG);
  const auth = getAuth(app);
  const fire = fsSdk.getFirestore(app);
  const db = criarDbFirestore({
    db: fire, doc: fsSdk.doc, collection: fsSdk.collection,
    getDoc: fsSdk.getDoc, getDocs: fsSdk.getDocs, setDoc: fsSdk.setDoc,
    updateDoc: fsSdk.updateDoc, deleteDoc: fsSdk.deleteDoc,
    onSnapshot: fsSdk.onSnapshot, runTransaction: fsSdk.runTransaction,
    query: fsSdk.query, where: fsSdk.where, orderBy: fsSdk.orderBy, limit: fsSdk.limit
  });
  const contas = CriarContas(db);
  let uidA = null, uidB = null;

  console.log("\nPONTA A PONTA — projeto real quem-sou-eu-e3e32\n");

  const r1 = await pega(createUserWithEmailAndPassword(auth, A.email, A.senha));
  t("cria a conta no Auth com e-mail e senha", !!r1.v, String(r1.e));
  if (!r1.v){
    console.log("\n  >>> o provedor ainda esta desligado (" + r1.e + ")");
    process.exit(1);
  }
  uidA = r1.v.user.uid;

  const r2 = await pega(contas.criar(uidA, { nick: A.nick, nome: A.nome, email: A.email }));
  t("grava o perfil (perfis + usuarios + nicks)", !!r2.v, String(r2.e));
  t("perfil volta com o apelido", r2.v && r2.v.nick === A.nick);
  t("perfil volta com o nome completo", r2.v && r2.v.nome === A.nome);
  t("agregado começa zerado", r2.v && r2.v.partidas === 0 && r2.v.saldo === 0);

  const pub = await pega(contas.perfilPublico(uidA));
  t("perfil público existe", !!pub.v, String(pub.e));
  t("perfil público NÃO expõe e-mail", pub.v && pub.v.email === undefined,
    pub.v ? JSON.stringify(pub.v) : "");

  const achado = await pega(contas.porNick(A.nick.toUpperCase()));
  t("acha por apelido, sem ligar pra caixa", achado.v && achado.v.uid === uidA, String(achado.e));

  /* segunda conta, pra provar apelido repetido e o rank */
  const r3 = await pega(createUserWithEmailAndPassword(auth, B.email, B.senha));
  t("cria a segunda conta", !!r3.v, String(r3.e));
  uidB = r3.v ? r3.v.user.uid : null;

  if (uidB){
    const dup = await pega(contas.criar(uidB, { nick: A.nick, nome: B.nome, email: B.email }));
    t("apelido repetido é recusado", dup.e === "nick_em_uso", String(dup.e));

    const r4 = await pega(contas.criar(uidB, { nick: B.nick, nome: B.nome, email: B.email }));
    t("com outro apelido, cria", !!r4.v, String(r4.e));

    const am = await pega(contas.pedir(uidB, uidA));
    t("pedido de amizade sai", am.v === "pedido", String(am.e));
  }

  /* sair e entrar de novo com a senha */
  await signOut(auth);
  const r5 = await pega(signInWithEmailAndPassword(auth, A.email, "000000"));
  t("senha errada é recusada", r5.e === "auth/invalid-credential", String(r5.e));
  const r6 = await pega(signInWithEmailAndPassword(auth, A.email, A.senha));
  t("senha certa entra", !!r6.v, String(r6.e));

  const ordem = [{ id: uidA, chave: 1 }, { id: uidB, chave: 2 }, { id: "x", chave: 3 }];
  const r7 = await pega(contas.registrarMinhaPartida(uidA, { pid: "e2e-" + m, sala: "TESTE", ordem }));
  t("registra a própria partida", r7.v === "registrada", String(r7.e));

  const p2 = await pega(contas.perfil(uidA));
  t("agregado somou a partida", p2.v && p2.v.partidas === 1, p2.v ? JSON.stringify(p2.v) : String(p2.e));
  t("vencer de 3 dá saldo +2", p2.v && p2.v.saldo === 2, p2.v ? String(p2.v.saldo) : "");

  const rank = await pega(contas.rankAmigos(uidA));
  t("ranking responde", Array.isArray(rank.v), String(rank.e));

  /* ---- limpeza ---- */
  console.log("\n  limpando…");
  const limpar = async (uid, nick) => {
    if (!uid) return;
    await pega(db.doc("nicks/" + nick)["delete"]());
    await pega(db.doc("usuarios/" + uid + "/partidas/e2e-" + m)["delete"]());
    await pega(db.doc("usuarios/" + uid + "/amigos/" + (uid === uidA ? uidB : uidA))["delete"]());
    await pega(db.doc("usuarios/" + uid)["delete"]());
  };
  await limpar(uidA, A.nick);
  if (r6.v) await pega(deleteUser(auth.currentUser));
  if (uidB){
    const rb = await pega(signInWithEmailAndPassword(auth, B.email, B.senha));
    if (rb.v){ await limpar(uidB, B.nick); await pega(deleteUser(auth.currentUser)); }
  }
  console.log("  (perfis/ nao pode ser apagado pela regra — 2 perfis de teste ficam)");

  console.log("\n" + ok + " passaram, " + falhas.length + " falharam");
  process.exit(falhas.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
