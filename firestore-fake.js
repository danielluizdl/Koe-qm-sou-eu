/* ============================================================
   FIRESTORE DE MENTIRA, SEMÂNTICA DE VERDADE
   SDK modular do Firebase em memória, dirigido por fila — o mesmo
   modelo de `queue` + `_drain()` que o db falso do test-salas.js
   usa, pra que o suite de salas rode contra os dois backends.

   Não é complacente de propósito. Ele reproduz o que morde:
     - updateDoc SÓ entende dot-path; mapa aninhado SUBSTITUI
     - updateDoc falha com not-found se o documento não existe
     - exists() é MÉTODO
     - onSnapshot reemite no eco local, mesmo sem mudança de valor

   Se o adaptador não traduzir, o jogo quebra aqui — que é o ponto.

   makeFirestoreDb() devolve o db JÁ no contrato da capability
   (adaptador aplicado), com os helpers _drain/_reset/_dump/_count
   que o harness de teste espera.
   ============================================================ */
const criarDbFirestore = require("./firestore-adapter.js");

function makeFirestoreSdk(){
  const store = new Map();
  const listeners = [];
  const queue = [];
  let scheduled = false;
  let cadeiaTransacoes = Promise.resolve();   // serializa runTransaction de verdade

  const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const err = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };

  function schedule(){
    if (scheduled) return;
    scheduled = true;
    queue.push(() => { scheduled = false; fireAll(); });
  }
  function mutate(fn){ fn(); schedule(); }

  const snap = path => {
    const d = store.get(path);
    return {
      id: path.split("/").pop(),
      exists: () => d !== undefined,
      data: () => clone(d),
      metadata: { fromCache: false, hasPendingWrites: false }
    };
  };

  function filhos(collPath){
    const pre = collPath + "/", n = collPath.split("/").length + 1;
    const out = [];
    for (const k of store.keys())
      if (k.startsWith(pre) && k.split("/").length === n) out.push(k);
    out.sort();
    return out;
  }

  function cmp(a, op, b){
    switch (op){
      case "==": return a === b;
      case "!=": return a !== b;
      case ">": return a > b;
      case ">=": return a >= b;
      case "<": return a < b;
      case "<=": return a <= b;
      case "in": return Array.isArray(b) && b.indexOf(a) >= 0;
      case "not-in": return Array.isArray(b) && b.indexOf(a) < 0;
      case "array-contains": return Array.isArray(a) && a.indexOf(b) >= 0;
      default: throw err("invalid-argument", "operador desconhecido: " + op);
    }
  }

  function qsnap(collPath, rs){
    let docs = filhos(collPath).map(snap);
    for (const r of (rs || [])){
      if (r.tipo === "where") docs = docs.filter(d => cmp(d.data()[r.campo], r.op, r.valor));
      else if (r.tipo === "orderBy") docs.sort((a, b) => {
        const x = a.data()[r.campo], y = b.data()[r.campo];
        return (x > y ? 1 : x < y ? -1 : 0) * (r.dir === "desc" ? -1 : 1);
      });
      else if (r.tipo === "limit") docs = docs.slice(0, r.n);
    }
    return {
      forEach: fn => docs.forEach(fn),
      size: docs.length,
      metadata: { fromCache: false, hasPendingWrites: false }
    };
  }

  /* Sem dedupe: o Firestore reemite no eco local do próprio write.
     Quem deduplica é o adaptador — e tem teste pra isso. */
  function fireAll(){
    for (const L of listeners.slice()){
      if (L.dead) continue;
      try {
        L.next(L.tipo === "doc" ? snap(L.path) : qsnap(L.path, L.rs));
      } catch (e) { /* engole, igual ao runtime */ }
    }
  }

  /* A semântica que morde: dot-path e só dot-path. */
  function aplicarUpdate(alvo, dados){
    for (const k of Object.keys(dados)){
      const v = clone(dados[k]);
      if (k.indexOf(".") < 0){ alvo[k] = v; continue; }
      const partes = k.split(".");
      let no = alvo;
      for (let i = 0; i < partes.length - 1; i++){
        const p = partes[i];
        if (!no[p] || typeof no[p] !== "object" || Array.isArray(no[p])) no[p] = {};
        no = no[p];
      }
      no[partes[partes.length - 1]] = v;
    }
  }

  function inscrever(L){
    listeners.push(L);
    queue.push(() => {
      if (L.dead) return;
      try { L.next(L.tipo === "doc" ? snap(L.path) : qsnap(L.path, L.rs)); } catch (e) {}
    });
    return () => { L.dead = true; };
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

    setDoc: (ref, dados) => {
      mutate(() => store.set(ref.path, clone(dados)));
      return Promise.resolve();
    },

    updateDoc: (ref, dados) => {
      if (!store.has(ref.path))
        return Promise.reject(err("not-found", "no document to update: " + ref.path));
      mutate(() => {
        const cur = store.get(ref.path);
        aplicarUpdate(cur, dados);
        store.set(ref.path, cur);
      });
      return Promise.resolve();
    },

    deleteDoc: ref => {
      mutate(() => store.delete(ref.path));
      return Promise.resolve();
    },

    onSnapshot: (ref, next, onErr) => inscrever(
      ref.__doc ? { tipo: "doc", path: ref.path, next, dead: false }
                : { tipo: "coll", path: ref.path, rs: ref.rs, next, dead: false }
    ),

    /* Serializada DE VERDADE: cada transação só começa a executar
       depois que a anterior terminou por completo (sucesso ou erro).

       Uma versão anterior disto só agendava fn() via microtask sem
       encadear nada — com N chamadas concorrentes a runTransaction,
       TODAS as N leituras (tx.get) aconteciam antes de QUALQUER
       escrita (tx.set), porque cada fn() é ela mesma uma cadeia de
       promises que intercala com as das outras no microtask queue.
       Resultado: N "transações" concorrentes todas liam "livre" e
       todas concluíam que tinham ganhado o mesmo lock — o Firestore
       de verdade nunca permitiria isso (controle de concorrência
       otimista: uma commitaria, as outras dariam retry). Achado
       testando 5 cadastros simultâneos de propósito: as 5 saíram com
       o mesmo ID, prova de que a serialização era só aparência.

       A fila abaixo é uma simplificação válida do mesmo contrato
       observável: já que este db é um processo só, em memória, sem
       conflito distribuído de verdade, executar uma transação só
       depois da outra terminar dá a MESMA garantia de isolamento que
       o retry otimista do Firestore real — só que sem precisar
       reimplementar detecção de conflito. */
    runTransaction: (db, fn) => {
      const resultado = cadeiaTransacoes.then(() => fn({
        get: ref => Promise.resolve(snap(ref.path)),
        set: (ref, dados) => { mutate(() => store.set(ref.path, clone(dados))); }
      }));
      cadeiaTransacoes = resultado.then(() => {}, () => {});
      return resultado;
    },

    _store: store,
    _queue: queue,
    _listeners: listeners,
    _resetInterno(){
      store.clear(); listeners.length = 0; queue.length = 0; scheduled = false;
      cadeiaTransacoes = Promise.resolve();
    }
  };
}

/* db no contrato da capability + helpers do harness.
   _dump/_count ignoram `_locks`: são a tradução do acquire, não dado
   do jogo. No db da capability os leases viviam num Map separado que
   também não entrava na contagem — então isso mantém a paridade. */
function makeFirestoreDb(){
  const sdk = makeFirestoreSdk();
  const db = criarDbFirestore(sdk);
  const doJogo = k => k.indexOf("_locks/") !== 0;

  db._drain = async function(){
    let g = 0;
    while (sdk._queue.length && g++ < 200000){
      sdk._queue.shift()();
      await Promise.resolve();
    }
  };
  db._reset = function(){ sdk._resetInterno(); };
  db._dump = function(){
    const o = {};
    for (const [k, v] of sdk._store) if (doJogo(k)) o[k] = v;
    return o;
  };
  db._count = function(){
    let n = 0;
    for (const k of sdk._store.keys()) if (doJogo(k)) n++;
    return n;
  };
  db._sdk = sdk;
  return db;
}

module.exports = { makeFirestoreSdk, makeFirestoreDb };
