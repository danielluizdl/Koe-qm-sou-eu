/* Prova que o adaptador entrega o contrato da capability `db` por cima
   da semântica REAL do Firestore.

   O SDK falso aqui não é complacente: updateDoc só aceita dot-paths,
   substitui mapas aninhados e falha se o documento não existe — que é
   exatamente como o Firestore se comporta. Se o adaptador não traduzir,
   os testes quebram.

   node test-firestore-adapter.js */
const criarDbFirestore = require("./firestore-adapter.js");

let ok = 0, falhas = [];
function t(nome, cond, extra){
  if (cond) ok++; else falhas.push(nome + (extra ? " — " + extra : ""));
}
const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/* ---------------- Firestore de mentira, semântica de verdade ------------- */
function fakeSdk(){
  const store = new Map();          // path -> objeto
  const listeners = [];
  const log = [];                   // o que o SDK recebeu, pra inspeção

  const err = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };
  const snap = path => {
    const d = store.get(path);
    return { id: path.split("/").pop(), exists: () => d !== undefined,
             data: () => clone(d), metadata: { fromCache:false, hasPendingWrites:false } };
  };
  function emitir(){
    for (const L of listeners.slice()){
      if (L.dead) continue;
      if (L.tipo === "doc") L.next(snap(L.path));
      else L.next(qsnap(L.path, L.rs));
    }
  }
  function filhos(collPath){
    const pre = collPath + "/", n = collPath.split("/").length + 1;
    return [...store.keys()].filter(k => k.startsWith(pre) && k.split("/").length === n).sort();
  }
  function qsnap(collPath, rs){
    let docs = filhos(collPath).map(snap);
    for (const r of (rs || [])){
      if (r.tipo === "where") docs = docs.filter(d => cmp(d.data()[r.campo], r.op, r.valor));
      if (r.tipo === "orderBy") docs.sort((a,b) => {
        const x = a.data()[r.campo], y = b.data()[r.campo];
        return (x > y ? 1 : x < y ? -1 : 0) * (r.dir === "desc" ? -1 : 1);
      });
      if (r.tipo === "limit") docs = docs.slice(0, r.n);
    }
    return { forEach: fn => docs.forEach(fn), size: docs.length,
             metadata: { fromCache:false, hasPendingWrites:false } };
  }
  function cmp(a, op, b){
    if (op === "==") return a === b;
    if (op === "!=") return a !== b;
    if (op === ">") return a > b;
    if (op === ">=") return a >= b;
    if (op === "<") return a < b;
    if (op === "<=") return a <= b;
    if (op === "in") return b.indexOf(a) >= 0;
    if (op === "array-contains") return Array.isArray(a) && a.indexOf(b) >= 0;
    throw err("invalid-argument", "op desconhecido: " + op);
  }

  /* A parte que importa: dot-path, e SÓ dot-path. Um mapa aninhado
     passado direto substitui o mapa inteiro — igual ao Firestore. */
  function aplicarUpdate(alvo, dados){
    for (const k of Object.keys(dados)){
      const v = clone(dados[k]);
      if (k.indexOf(".") < 0){ alvo[k] = v; continue; }
      const partes = k.split(".");
      let no = alvo;
      for (let i = 0; i < partes.length - 1; i++){
        if (!no[partes[i]] || typeof no[partes[i]] !== "object" || Array.isArray(no[partes[i]]))
          no[partes[i]] = {};
        no = no[partes[i]];
      }
      no[partes[partes.length - 1]] = v;
    }
  }

  return {
    db: { __fake: true },
    doc: (db, path) => ({ __doc: true, path }),
    collection: (db, path) => ({ __coll: true, path, rs: [] }),
    query: (base, ...rs) => ({ __coll: true, path: base.path, rs: (base.rs || []).concat(rs) }),
    where: (campo, op, valor) => ({ tipo: "where", campo, op, valor }),
    orderBy: (campo, dir) => ({ tipo: "orderBy", campo, dir }),
    limit: n => ({ tipo: "limit", n }),
    getDoc: ref => Promise.resolve(snap(ref.path)),
    getDocs: q => Promise.resolve(qsnap(q.path, q.rs)),
    setDoc: (ref, dados) => { log.push(["set", ref.path, clone(dados)]);
      store.set(ref.path, clone(dados)); emitir(); return Promise.resolve(); },
    updateDoc: (ref, dados) => {
      log.push(["update", ref.path, clone(dados)]);
      if (!store.has(ref.path)) return Promise.reject(err("not-found", "no document to update"));
      const cur = store.get(ref.path); aplicarUpdate(cur, dados);
      store.set(ref.path, cur); emitir(); return Promise.resolve();
    },
    deleteDoc: ref => { store.delete(ref.path); emitir(); return Promise.resolve(); },
    onSnapshot: (ref, next, onErr) => {
      const L = ref.__doc ? { tipo:"doc", path:ref.path, next, dead:false }
                          : { tipo:"coll", path:ref.path, rs:ref.rs, next, dead:false };
      listeners.push(L);
      Promise.resolve().then(() => { if (!L.dead) L.tipo === "doc" ? L.next(snap(L.path)) : L.next(qsnap(L.path, L.rs)); });
      return () => { L.dead = true; };
    },
    /* transaction serializada: basta pro que o acquire precisa */
    runTransaction: (db, fn) => Promise.resolve().then(() => fn({
      get: ref => Promise.resolve(snap(ref.path)),
      set: (ref, dados) => { store.set(ref.path, clone(dados)); emitir(); }
    })),
    _store: store, _log: log,
    _dump: () => { const o = {}; for (const [k,v] of store) o[k] = v; return o; }
  };
}

const espera = () => new Promise(r => setTimeout(r, 0));

(async function(){

/* ============ 1. Básico: set / get / exists como PROPRIEDADE ============ */
{
  const sdk = fakeSdk(), db = criarDbFirestore(sdk);
  let s = await db.doc("salas/ABC").get();
  t("doc inexistente tem exists false", s.exists === false);
  t("exists é propriedade, não método", typeof s.exists === "boolean");
  t("data() de inexistente é undefined", s.data() === undefined);

  await db.doc("salas/ABC").set({ codigo: "ABC", fase: "lobby" });
  s = await db.doc("salas/ABC").get();
  t("depois do set, exists true", s.exists === true);
  t("data() traz o objeto", s.data().codigo === "ABC");
  t("id do snapshot", s.id === "ABC");
}

/* ============ 2. TRADUÇÃO 1: merge recursivo ============
   A regressão que mata o jogo: gravar a partida 2 não pode
   apagar a partida 1 do histórico. */
{
  const sdk = fakeSdk(), db = criarDbFirestore(sdk);
  const hist = db.doc("salas/ABC/hist/registro");
  await hist.set({ items: {} });

  await hist.update({ items: { p1: { terminadaEm: 1, resultados: ["ana"] } } });
  await hist.update({ items: { p2: { terminadaEm: 2, resultados: ["bia"] } } });

  const d = (await hist.get()).data();
  t("histórico manteve a partida 1", !!d.items.p1, JSON.stringify(d));
  t("histórico ganhou a partida 2", !!d.items.p2);
  t("partida 1 intacta", d.items.p1.terminadaEm === 1 && d.items.p1.resultados[0] === "ana");

  /* Achata até a folha (items.p2.terminadaEm), não só até items.p2:
     parar no meio substituiria a partida inteira num update parcial,
     que é justamente o que o deepMerge do contrato não faz. */
  const ult = sdk._log.filter(l => l[0] === "update").pop();
  const chaves = Object.keys(ult[2]);
  t("update virou dot-path até a folha",
    chaves.length === 2 && chaves.every(k => k.indexOf("items.p2.") === 0),
    JSON.stringify(ult[2]));

  /* e um update parcial numa partida já gravada preserva o resto dela */
  await hist.update({ items: { p1: { resultados: ["ana", "bia"] } } });
  const d2 = (await hist.get()).data();
  t("update parcial preserva irmãos do mesmo mapa",
    d2.items.p1.terminadaEm === 1 && d2.items.p1.resultados.length === 2,
    JSON.stringify(d2.items.p1));

  /* prova de que o teste não é complacente: sem tradução, apaga */
  const cru = fakeSdk();
  await cru.setDoc({ path:"x/y" }, { items: { p1: { a:1 } } });
  await cru.updateDoc({ path:"x/y" }, { items: { p2: { a:2 } } });
  t("SDK cru realmente apagaria (teste é honesto)", !cru._store.get("x/y").items.p1);
}

/* ============ 3. update: campos escalares, arrays e nulls ============ */
{
  const sdk = fakeSdk(), db = criarDbFirestore(sdk);
  const r = db.doc("salas/ABC/jogadores/j1");
  await r.set({ nick: "ana", vistoEm: 1, tags: ["a"], pos: null, cfg: { som: true, vibra: true } });

  await r.update({ vistoEm: 2 });
  t("escalar atualiza", (await r.get()).data().vistoEm === 2);

  await r.update({ tags: ["b", "c"] });
  t("array substitui, não mescla", (await r.get()).data().tags.join(",") === "b,c");

  await r.update({ pos: null });
  t("null é gravado como valor", (await r.get()).data().pos === null);

  await r.update({ cfg: { som: false } });
  const cfg = (await r.get()).data().cfg;
  t("mapa aninhado mescla (som mudou)", cfg.som === false);
  t("mapa aninhado mescla (vibra preservada)", cfg.vibra === true, JSON.stringify(cfg));
}

/* ============ 4. update em doc inexistente rejeita, como no contrato ==== */
{
  const sdk = fakeSdk(), db = criarDbFirestore(sdk);
  let cod = null;
  await db.doc("salas/NAO/jogadores/x").update({ a: 1 }).then(
    () => { cod = "resolveu"; }, e => { cod = e.code; });
  t("update em doc ausente rejeita com invalid_argument", cod === "invalid_argument", String(cod));
}

/* ============ 5. TRADUÇÃO 2: acquire ============ */
{
  const sdk = fakeSdk(), db = criarDbFirestore(sdk);
  const sala = db.doc("salas/ABC");

  const a = await sala.acquire({ holder: "j1", ttlMs: 8000 });
  t("primeiro acquire pega o lease", a.acquired === true);
  t("acquire devolve expiresAt ISO", typeof a.expiresAt === "string" && a.expiresAt.indexOf("T") > 0);

  /* O ponto que quebraria a criação de sala inteira */
  const s = await sala.get();
  t("acquire NÃO cria o doc da sala", s.exists === false, JSON.stringify(sdk._dump()));
  t("lease foi pra _locks", Object.keys(sdk._dump()).some(k => k.indexOf("_locks/") === 0),
    Object.keys(sdk._dump()).join(","));

  const b = await sala.acquire({ holder: "j2", ttlMs: 8000 });
  t("outro holder é barrado", b.acquired === false);
  const c = await sala.acquire({ holder: "j1", ttlMs: 8000 });
  t("o mesmo holder renova", c.acquired === true);

  /* lease vencido libera */
  const chave = "_locks/" + db._chaveDeLock("salas/ABC");
  sdk._store.set(chave, { holder: "j9", expiresAt: Date.now() - 1, version: 1 });
  const d = await sala.acquire({ holder: "j2", ttlMs: 8000 });
  t("lease vencido libera pro próximo", d.acquired === true);

  t("caminho vira chave sem barra", db._chaveDeLock("salas/ABC").indexOf("/") < 0);
  t("escape de ~ e / é reversível",
    db._chaveDeLock("a~b/c") === "a~7Eb~2Fc", db._chaveDeLock("a~b/c"));
}

/* ============ 6. onSnapshot: emite, deduplica, desinscreve ============ */
{
  const sdk = fakeSdk(), db = criarDbFirestore(sdk);
  const sala = db.doc("salas/ABC");
  await sala.set({ fase: "lobby" });

  const vistos = [];
  const off = sala.onSnapshot(s => vistos.push(s.data() && s.data().fase));
  await espera();
  t("onSnapshot emite o estado inicial", vistos.length === 1 && vistos[0] === "lobby", JSON.stringify(vistos));

  await sala.update({ fase: "jogando" });
  await espera();
  t("onSnapshot emite a mudança", vistos[vistos.length-1] === "jogando");

  const antes = vistos.length;
  await sala.update({ fase: "jogando" });
  await espera();
  t("não reemite quando nada mudou", vistos.length === antes, JSON.stringify(vistos));

  off();
  await sala.update({ fase: "fim" });
  await espera();
  t("desinscrever para de emitir", vistos.indexOf("fim") < 0);
}

/* ============ 7. Coleções: doc/get/onSnapshot e o formato do querySnap == */
{
  const sdk = fakeSdk(), db = criarDbFirestore(sdk);
  const jog = db.doc("salas/ABC").collection("jogadores");
  await jog.doc("j1").set({ nick: "ana", pontos: 3 });
  await jog.doc("j2").set({ nick: "bia", pontos: 9 });

  const qs = await jog.get();
  t("querySnapshot tem size", qs.size === 2);
  t("querySnapshot tem empty", qs.empty === false);
  t("querySnapshot tem docs[]", Array.isArray(qs.docs) && qs.docs.length === 2);
  t("docs trazem id", qs.docs.map(d => d.id).sort().join(",") === "j1,j2");
  t("docs trazem data()", qs.docs.find(d => d.id === "j1").data().nick === "ana");
  t("docChanges existe", typeof qs.docChanges === "function");

  const vistos = [];
  const off = jog.onSnapshot(s => vistos.push(s.size));
  await espera();
  t("coleção emite inicial", vistos[0] === 2);
  await jog.doc("j3").set({ nick: "caio", pontos: 1 });
  await espera();
  t("coleção emite ao entrar jogador", vistos[vistos.length-1] === 3);
  off();
}

/* ============ 8. Queries — não usadas hoje, mas o rank de amigos vai usar */
{
  const sdk = fakeSdk(), db = criarDbFirestore(sdk);
  const jog = db.collection("salas/ABC/jogadores");
  await jog.doc("j1").set({ nick: "ana", saldo: 3 });
  await jog.doc("j2").set({ nick: "bia", saldo: 9 });
  await jog.doc("j3").set({ nick: "caio", saldo: -2 });

  const top = await jog.orderBy("saldo", "desc").limit(2).get();
  t("orderBy + limit", top.docs.map(d => d.id).join(",") === "j2,j1", top.docs.map(d=>d.id).join(","));
  const pos = await jog.where("saldo", ">", 0).get();
  t("where filtra", pos.size === 2);
  t("query é encadeável sem mutar a original", (await jog.get()).size === 3);
}

/* ============ 9. Validação de caminho ============ */
{
  const sdk = fakeSdk(), db = criarDbFirestore(sdk);
  const joga = fn => { try { fn(); return null; } catch(e){ return e.constructor.name; } };
  t("doc com nº ímpar de segmentos falha", joga(() => db.doc("salas")) === "TypeError");
  t("collection com nº par falha", joga(() => db.collection("salas/ABC")) === "TypeError");
  t("segmento vazio falha", joga(() => db.doc("salas//x")) === "TypeError");
  t("'..' falha", joga(() => db.doc("salas/../x")) === "TypeError");
  t("caractere inválido falha", joga(() => db.doc("salas/a b")) === "TypeError");
  t("caminho válido passa", joga(() => db.doc("salas/ABC")) === null);
}

/* ============ 10. Guardas do update ============ */
{
  const sdk = fakeSdk(), db = criarDbFirestore(sdk);
  const r = db.doc("salas/ABC");
  await r.set({ a: 1 });
  const cod = async v => { let c = null; await r.update(v).then(()=>{c="ok";}, e=>{c=e.code;}); return c; };
  t("update com array rejeita", (await cod([1,2])) === "invalid_argument");
  t("update com null rejeita", (await cod(null)) === "invalid_argument");
  t("campo com ponto no nome rejeita", (await cod({ "a.b": 1 })) === "invalid_argument");
  t("update vazio é no-op", (await cod({})) === "ok");
  t("set com array rejeita", await (async()=>{ let c=null;
      await r.set([1]).then(()=>{c="ok";}, e=>{c=e.code;}); return c; })() === "invalid_argument");
}

/* ============ 11. Objetos de OUTRO REALM ainda são mapas ============
   Regressão de um bug que passou silencioso: o jogo roda dentro de um
   contexto vm nos testes (e de um iframe seria o mesmo), então seus
   objetos têm outro Object.prototype. Comparando protótipo por
   identidade, o patch aninhado virava folha e o update SUBSTITUÍA o
   histórico inteiro — apagando as partidas anteriores sem erro nenhum. */
{
  const vm = require("vm");
  const ctx = vm.createContext({});
  const alheio = vm.runInContext('({ items: { p2: { terminadaEm: 2 } } })', ctx);
  t("objeto de outro realm não é Object.prototype daqui",
    Object.getPrototypeOf(alheio) !== Object.prototype);

  const sdk = fakeSdk(), db = criarDbFirestore(sdk);
  const hist = db.doc("salas/ABC/hist/registro");
  await hist.set({ items: { p1: { terminadaEm: 1 } } });
  await hist.update(alheio);

  const d = (await hist.get()).data();
  t("patch de outro realm mescla, não substitui",
    !!d.items.p1 && !!d.items.p2, JSON.stringify(d));

  const chaves = Object.keys(sdk._log.filter(l => l[0] === "update").pop()[2]);
  t("patch de outro realm também vira dot-path",
    chaves[0] === "items.p2.terminadaEm", chaves.join(","));

  const arrAlheio = vm.runInContext('({ tags: ["a","b"] })', ctx);
  await hist.update(arrAlheio);
  t("array de outro realm continua folha",
    Array.isArray((await hist.get()).data().tags));
}

/* ============ 12. Instâncias de classe são FOLHAS ============
   Timestamp, FieldValue, GeoPoint e DocumentReference do Firestore são
   objetos de classe. Achatá-los destruiria o sentinel. */
{
  const sdk = fakeSdk(), db = criarDbFirestore(sdk);
  const r = db.doc("salas/ABC");
  await r.set({ a: 1 });

  class Timestamp { constructor(s){ this.seconds = s; this.nanoseconds = 0; } }
  await r.update({ criadoEm: new Timestamp(123) });
  let ult = sdk._log.filter(l => l[0] === "update").pop()[2];
  t("instância de classe não é achatada",
    Object.keys(ult).join(",") === "criadoEm", Object.keys(ult).join(","));

  await r.update({ quando: new Date(0) });
  ult = sdk._log.filter(l => l[0] === "update").pop()[2];
  t("Date não é achatada", Object.keys(ult).join(",") === "quando");

  const semProto = Object.create(null); semProto.x = 1;
  await r.update({ mapa: semProto });
  ult = sdk._log.filter(l => l[0] === "update").pop()[2];
  t("objeto sem protótipo é mapa comum", Object.keys(ult).join(",") === "mapa.x",
    Object.keys(ult).join(","));
}

console.log("\n" + ok + " passaram, " + falhas.length + " falharam");
if (falhas.length){ falhas.forEach(f => console.log("  x " + f)); process.exit(1); }
})();
