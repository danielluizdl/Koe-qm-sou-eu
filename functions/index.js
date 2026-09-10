/* ============================================================
   CLOUD FUNCTION — deriva o agregado do rank

   Dispara quando o host grava o resultado da partida em
   `salas/{codigo}/hist/registro`. Para cada `pid` novo no mapa
   `items`, chama rank-server.js#processarPartida, que grava a partida
   imutável de cada participante com conta e reconstrói o agregado
   em `perfis/{uid}`.

   O cliente NÃO escreve mais `partidas` nem o agregado — as regras
   bloqueiam. É isso que fecha a inflação de saldo pelo console.

   rank-server.js e pontuacao.js são copiados para dentro de
   functions/ pelo predeploy (`node build.js --stage-functions`,
   configurado em firebase.json) — o deploy só sobe este diretório.

   REGIÃO: sem região explícita, roda em us-central1. Gatilhos do
   Firestore de 2ª geração precisam bater com o grupo de localização
   do banco (nam5 -> us-central1, eur3 -> europe-west4). Se o deploy
   reclamar de região, ajuste `setGlobalOptions({ region: ... })`.
   ============================================================ */
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

/* No deploy, o predeploy copia rank-server.js pra cá. No emulador local
   (sem predeploy) ele ainda está só na raiz — cai no require de cima. */
let RANK;
try { RANK = require("./rank-server.js"); }
catch (e) { RANK = require("../rank-server.js"); }

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
