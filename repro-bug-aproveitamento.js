/* BUG CONFIRMADO — divisão inteira em firestore.rules (linha ~171-172).

   Em usuarios/{uid}/partidas/{pid}, a regra valida:
     campos().aproveitamento <= (campos().n - campos().posicao) / (campos().n - 1) + 0.0001
   `n` e `posicao` são exigidos como `int` pelas cláusulas anteriores da
   mesma regra. No CEL (linguagem das Firestore Rules), dividir int por
   int trunca — não promove pra float. Então (n-posicao)/(n-1) dá 0
   sempre que o resultado matemático real está entre 0 e 1 (exclusive),
   ou seja: SEMPRE que o jogador não terminou em 1º nem em último lugar.

   Efeito real: em toda partida de 3+ jogadores, `registrarResultado`
   (contas.js) falha silenciosamente para todo mundo que não ficou em 1º
   ou último — nem o próprio resultado (usuarios/{uid}/partidas/{pid})
   nem o agregado do rank geral (perfis/{uid}) são gravados. O ranking
   POR SALA (aba Classificação) não é afetado — é calculado 100% no
   cliente a partir do hist, sem passar por essa regra.

   Isso muito provavelmente é a causa real da "pendência 1" da sessão
   anterior (avaliação/resultado não registrado ao reconectar): o
   jogador que reconectou só não teve o resultado gravado porque ele
   tinha terminado no meio da tabela — nada a ver com reconexão ou
   localStorage.

   O test-regras.js existente só cobre partidas de n=2 (arquivo atual,
   linhas ~125-146) — com 2 jogadores toda posição já É extrema (1º ou
   último), então esse buraco nunca apareceu na suíte.

   Roda só contra o EMULADOR — não toca produção.
     npx firebase emulators:exec --only firestore --project demo-quem-sou-eu "node repro-bug-aproveitamento.js"

   Correção sugerida: forçar divisão float, ex.:
     (campos().n - campos().posicao) / (campos().n - 1.0)
   ou usar double(...) explícito nos dois lados. */
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const fs = require("fs");
const { doc, setDoc } = require("firebase/firestore");

(async function(){
  const env = await initializeTestEnvironment({
    projectId: "demo-quem-sou-eu",
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 }
  });
  const ana = env.authenticatedContext("ana").firestore();   // idx0, posicao 2 de 3 (MEIO)
  const bia = env.authenticatedContext("bia").firestore();   // idx1, posicao 1 (extremo)
  const zeca = env.authenticatedContext("zeca").firestore(); // idx2, posicao 3 (extremo)
  await env.clearFirestore();
  const semear = fn => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore()));
  await semear(async db => {
    await setDoc(doc(db, "salas/FESTA"), { codigo: "FESTA", hostId: "host", fase: "fim", mask: 1, nivel: 0 });
    await setDoc(doc(db, "salas/FESTA/hist/registro"), {
      items: { p1: { terminadaEm: 100, resultados: [
        { id: "ana", nick: "Ana", carta: "A", posicao: 2 },
        { id: "bia", nick: "Bia", carta: "B", posicao: 1 },
        { id: "zeca", nick: "Zeca", carta: "C", posicao: 3 }
      ] } }
    });
  });

  const tenta = (db, uid, posicao, saldo, aproveitamento, idx) =>
    setDoc(doc(db, "usuarios/" + uid + "/partidas/p1"), {
      pid: "p1", sala: "FESTA", terminadaEm: 100, n: 3, posicao, saldo, aproveitamento, idxResultado: idx
    }).then(() => "SUCESSO", e => "NEGADO: " + e.message.split("\n")[0]);

  console.log("bia, posicao=1 de 3 (extremo, valores corretos):", await tenta(bia, "bia", 1, 2, 1, 1));
  console.log("zeca, posicao=3 de 3 (extremo, valores corretos):", await tenta(zeca, "zeca", 3, -2, 0, 2));
  console.log("ana, posicao=2 de 3 (MEIO, valores matematicamente corretos — deveria passar e NÃO passa):",
    await tenta(ana, "ana", 2, 0, 0.5, 0));

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
