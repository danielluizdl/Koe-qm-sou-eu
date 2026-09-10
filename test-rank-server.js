/* RANK — LADO SERVIDOR
   rank-server.js#processarPartida é o código que a Cloud Function
   derivarRank chama. Aqui ele roda contra o firestore-fake.js (a
   semântica mais próxima do Admin SDK que temos sem emulador).

   O que importa provar:
   - o agregado sai do resultado que o HOST gravou em hist, não de
     nada que um cliente declare;
   - convidado sem conta é ignorado;
   - reprocessar a mesma partida não dobra nada;
   - o agregado é RECONSTRUÍDO da subcoleção inteira (auto-corretivo).

   node test-rank-server.js */
const RANK = require("./rank-server.js");
const { makeFirestoreDb } = require("./firestore-fake.js");

let ok = 0, falhas = [];
function t(nome, cond, extra){
  if (cond) ok++; else falhas.push(nome + (extra ? " — " + extra : ""));
}

/* Semeia perfis zerados e o resultado do host. `ordem` é do 1º ao
   último; vira `resultados` com posicao densa, como gravarHist faz. */
async function semear(db, perfis, sala, pid, ordem){
  for (const uid of perfis){
    await db.doc("perfis/" + uid).set({
      uid, nick: uid, nickChave: uid, id: uid.toUpperCase(), anonimo: false,
      criadoEm: 1, atualizadoEm: 1,
      partidas: 0, vitorias: 0, podios: 0, saldo: 0, somaAprov: 0
    });
  }
  const resultados = ordem.map((id, i) => ({ id, nick: id, carta: "c" + i, posicao: i + 1 }));
  const ref = db.doc("salas/" + sala + "/hist/registro");
  const snap = await ref.get();
  const items = (snap.exists && snap.data().items) || {};
  items[pid] = { terminadaEm: 1234, mask: 1, nivel: 0, resultados };
  await ref.set({ items });
}
const perfil = (db, uid) => db.doc("perfis/" + uid).get().then(s => s.data());

(async function(){

  /* ---- 1. pontua todo mundo com conta, de uma vez ---- */
  {
    const db = makeFirestoreDb();
    await semear(db, ["ana", "bia", "caio"], "FESTA", "p1", ["ana", "bia", "caio"]);
    const r = await RANK.processarPartida(db, "FESTA", "p1");
    t("processa os 3 participantes", r.processados.sort().join(",") === "ana,bia,caio", JSON.stringify(r));
    t("ninguém foi pulado", r.pulados.length === 0);

    const a = await perfil(db, "ana"), b = await perfil(db, "bia"), c = await perfil(db, "caio");
    t("1º de 3: saldo +2", a.saldo === 2 && a.vitorias === 1 && a.partidas === 1, JSON.stringify(a));
    t("2º de 3: saldo 0", b.saldo === 0 && b.vitorias === 0, JSON.stringify(b));
    t("3º de 3: saldo -2", c.saldo === -2, JSON.stringify(c));
    t("a partida da soma zero", a.saldo + b.saldo + c.saldo === 0);

    const pa = await db.doc("usuarios/ana/partidas/p1").get();
    t("partida imutável gravada", pa.exists && pa.data().posicao === 1 && pa.data().sala === "FESTA");
  }

  /* ---- 2. convidado sem conta é ignorado ---- */
  {
    const db = makeFirestoreDb();
    await semear(db, ["ana"], "FESTA", "p1", ["ana", "convidado"]);
    const r = await RANK.processarPartida(db, "FESTA", "p1");
    t("só ana é processada", r.processados.join(",") === "ana", JSON.stringify(r));
    t("convidado é pulado", r.pulados.join(",") === "convidado");
    const a = await perfil(db, "ana");
    t("ana venceu de 2: saldo +1", a.saldo === 1 && a.partidas === 1, JSON.stringify(a));
  }

  /* ---- 3. vale a ORDEM que o host gravou, não a de quem chamou ---- */
  {
    const db = makeFirestoreDb();
    /* host gravou: bia em 1º, ana em 2º */
    await semear(db, ["ana", "bia"], "FESTA", "p1", ["bia", "ana"]);
    await RANK.processarPartida(db, "FESTA", "p1");
    const a = await perfil(db, "ana"), b = await perfil(db, "bia");
    t("host diz ana em 2º: saldo -1", a.saldo === -1 && a.vitorias === 0, JSON.stringify(a));
    t("host diz bia em 1º: saldo +1", b.saldo === 1 && b.vitorias === 1, JSON.stringify(b));
    t("partida de ana registra posicao 2", (await db.doc("usuarios/ana/partidas/p1").get()).data().posicao === 2);
  }

  /* ---- 4. reprocessar não dobra ---- */
  {
    const db = makeFirestoreDb();
    await semear(db, ["ana"], "FESTA", "p1", ["ana", "bia"]);
    await RANK.processarPartida(db, "FESTA", "p1");
    await RANK.processarPartida(db, "FESTA", "p1");
    await RANK.processarPartida(db, "FESTA", "p1");
    const a = await perfil(db, "ana");
    t("3 execuções, 1 partida no agregado", a.partidas === 1 && a.saldo === 1, JSON.stringify(a));
  }

  /* ---- 5. duas partidas somam; o agregado reconstrói do histórico ---- */
  {
    const db = makeFirestoreDb();
    await semear(db, ["ana"], "FESTA", "p1", ["ana", "bia"]);          // +1
    await RANK.processarPartida(db, "FESTA", "p1");
    /* segunda partida no mesmo hist */
    const ref = db.doc("salas/FESTA/hist/registro");
    const items = (await ref.get()).data().items;
    items["p2"] = { terminadaEm: 2, mask: 1, nivel: 0,
      resultados: [{ id: "x", nick: "x", carta: "c0", posicao: 1 },
                   { id: "ana", nick: "ana", carta: "c1", posicao: 2 }] };   // ana 2ª de 2 = -1
    await ref.set({ items });
    await RANK.processarPartida(db, "FESTA", "p2");
    const a = await perfil(db, "ana");
    t("2 partidas: saldo 1 + (-1) = 0", a.saldo === 0 && a.partidas === 2, JSON.stringify(a));

    /* estraga o agregado e prova que reprocessar conserta */
    await db.doc("perfis/ana").update({ saldo: 999, partidas: 42 });
    const rec = await RANK.recalcularAgregado(db, "ana");
    t("recalcularAgregado conserta agregado adulterado",
      rec.saldo === 0 && rec.partidas === 2, JSON.stringify(rec));
  }

  /* ---- 6. pid sem resultado no hist é no-op ---- */
  {
    const db = makeFirestoreDb();
    await semear(db, ["ana"], "FESTA", "p1", ["ana", "bia"]);
    const r = await RANK.processarPartida(db, "FESTA", "nao-existe");
    t("pid ausente: semResultado", r.semResultado === true, JSON.stringify(r));
  }

  console.log("\n" + ok + " passaram, " + falhas.length + " falharam");
  if (falhas.length){ falhas.forEach(f => console.log("  x " + f)); process.exit(1); }
})();
