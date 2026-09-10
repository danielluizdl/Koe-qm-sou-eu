/* ============================================================
   CLOUD FUNCTIONS

   1. derivarRank — deriva o agregado do rank
      Dispara quando o host grava o resultado da partida em
      `salas/{codigo}/hist/registro`. Para cada `pid` novo no mapa
      `items`, chama rank-server.js#processarPartida, que grava a
      partida imutável de cada participante com conta e reconstrói o
      agregado em `perfis/{uid}`.

      O cliente NÃO escreve mais `partidas` nem o agregado — as regras
      bloqueiam. É isso que fecha a inflação de saldo pelo console.

   2. entrarPorNick — login por nick, sem vazar e-mail
      Login por e-mail funciona direto no cliente. Login por NICK
      precisa achar o e-mail associado primeiro, e isso é uma leitura
      que as regras corretamente bloqueiam pra quem não provou quem é.
      Esta função resolve nick -> uid -> e-mail e verifica a senha
      TUDO do lado de dentro (nunca manda e-mail pro cliente) e
      devolve só um token — nick errado, senha errada e nick
      inexistente saem com a MESMA mensagem, pra ninguém conseguir
      varrer nicks e descobrir quais existem.

   Arquivos compartilhados (rank-server.js, pontuacao.js,
   login-server.js, contas.js, firebase-config.js) são copiados pra
   dentro de functions/ pelo predeploy (`node build.js
   --stage-functions`, configurado em firebase.json) — o deploy só
   sobe este diretório.

   REGIÃO: sem região explícita, roda em us-central1. Gatilhos do
   Firestore de 2ª geração precisam bater com o grupo de localização
   do banco (nam5 -> us-central1, eur3 -> europe-west4). Se o deploy
   reclamar de região, ajuste `setGlobalOptions({ region: ... })`.
   ============================================================ */
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

/* No deploy, o predeploy copia estes arquivos pra cá. No emulador
   local (sem predeploy) eles ainda estão só na raiz — cai no require
   relativo ao diretório pai. */
function requerCompartilhado(nome){
  try { return require("./" + nome); }
  catch (e) { return require("../" + nome); }
}
const RANK = requerCompartilhado("rank-server.js");
const LOGIN = requerCompartilhado("login-server.js");
const FIREBASE_CONFIG = requerCompartilhado("firebase-config.js");

initializeApp();

exports.derivarRank = onDocumentWritten(
  { document: "salas/{codigo}/hist/registro", maxInstances: 10 },
  async (event) => {
    const codigo = event.params.codigo;
    const antes = (event.data.before.exists && event.data.before.data().items) || {};
    const depois = (event.data.after.exists && event.data.after.data().items) || {};
    const novos = Object.keys(depois).filter((pid) => !(pid in antes));
    if (!novos.length) return;

    const db = getFirestore();
    for (const pid of novos) {
      try {
        const r = await RANK.processarPartida(db, codigo, pid);
        console.log("rank derivado", JSON.stringify({ codigo, pid, ...r }));
      } catch (e) {
        console.error("falha ao derivar rank", JSON.stringify({ codigo, pid, erro: e && e.message }));
      }
    }
  }
);

/* Verifica a senha chamando a MESMA API REST que o SDK do cliente usa
   por baixo dos panos — o Admin SDK não tem como conferir senha
   direto contra o hash salvo, só criar/editar conta. Redireciona pro
   emulador quando FIREBASE_AUTH_EMULATOR_HOST está setada (mesma
   variável que o próprio Admin SDK já usa pra se auto-redirecionar). */
async function chamarRestSignIn(email, senha){
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = host
    ? "http://" + host + "/identitytoolkit.googleapis.com"
    : "https://identitytoolkit.googleapis.com";
  const url = base + "/v1/accounts:signInWithPassword?key=" + FIREBASE_CONFIG.apiKey;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: senha, returnSecureToken: true })
  });
  return resp.ok;
}

exports.entrarPorNick = onCall({ maxInstances: 10 }, async (request) => {
  const dados = request.data || {};
  const db = getFirestore();
  const auth = getAuth();
  const authAdmin = {
    getUser: (uid) => auth.getUser(uid),
    createCustomToken: (uid) => auth.createCustomToken(uid)
  };
  try {
    const token = await LOGIN.resolverELogar(db, authAdmin, chamarRestSignIn, dados.nick, dados.senha);
    return { token };
  } catch (e) {
    throw new HttpsError("unauthenticated", "nick ou senha não conferem");
  }
});
