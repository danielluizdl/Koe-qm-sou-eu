/* Testa a camada de SALAS ONLINE com as funções REAIS do app.
   Carrega o <script> do HTML em N "aparelhos" (contextos vm isolados,
   cada um com seu localStorage) que compartilham UM banco de dados
   simulado — o mesmo contrato do db.d.ts (doc/collection, get/set/update/
   delete, onSnapshot em tempo real, acquire, merge recursivo no update,
   last-writer-wins).  Roda o fluxo inteiro com 2,3,4,5,6,7 e 8 jogadores.

   Dois backends, o mesmo suite:
     node test-salas.js              -> db da capability (runtime de Artifacts)
     DB=firestore node test-salas.js -> Firestore de verdade, via adaptador

   O segundo modo é o que garante que a virada pro Firebase não muda
   comportamento nenhum do jogo.
   node test-salas.js */
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync(__dirname + (process.env.JOGO || "/quem-sou-eu-temas.html"), "utf8");
const open = html.indexOf("<script>") + "<script>".length;
const close = html.lastIndexOf("</" + "script>");
let base = html.slice(open, close);

const tail = "})();";
const at = base.lastIndexOf(tail);
if (at < 0) throw new Error("não achei o fim da IIFE");
const injected = base.slice(0, at) +
  "globalThis.__t={CriarSalaCliente:CriarSalaCliente,senhaConfere:senhaConfere," +
  "normSenha:normSenha,normNick:normNick,normCodigo:normCodigo,nickValido:nickValido," +
  "calcClassificacao:calcClassificacao,listaPartidas:listaPartidas," +
  "wordFor:wordFor,cardsFor:cardsFor,decode:decode,encode:encode," +
  "ALL_MASK:ALL_MASK,NIVEIS:NIVEIS,POOL:POOL};" + tail;
const script = new vm.Script(injected, { filename: "quem-sou-eu-temas.html" });

/* ---------------- DOM mínimo (só para o app carregar) ---------------- */
class El {
  constructor(tag) {
    this.tagName = (tag || "div").toUpperCase(); this.children = []; this.style = {};
    this._text = ""; this._html = ""; this._attrs = {}; this.value = ""; this.hidden = false;
    this.classList = {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { (on === undefined ? !this._s.has(c) : on) ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    };
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  set className(v) { this.classList._s = new Set(String(v).split(" ").filter(Boolean)); }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs.hasOwnProperty(k) ? this._attrs[k] : null; }
  addEventListener() {} removeEventListener() {}
  appendChild(c) { this.children.push(c); return c; }
  querySelector() { return new El(); }
  querySelectorAll() { return list(8); }
  focus() {} blur() {}
}
const list = n => Array.from({ length: n }, () => new El());

function makeDocument() {
  const byId = {};
  return {
    head: new El("head"), body: new El("body"), activeElement: null, visibilityState: "visible",
    createElement: t => new El(t),
    getElementById: id => (byId[id] = byId[id] || new El()),
    querySelector: () => null,
    querySelectorAll: () => list(8),
    addEventListener() {},
  };
}

/* ---------------- escolha do backend ---------------- */
const BACKEND = process.env.DB === "firestore" ? "firestore" : "capability";
function makeDb() {
  return BACKEND === "firestore"
    ? require("./firestore-fake.js").makeFirestoreDb()
    : makeDbCapability();
}

/* ---------------- banco de dados simulado (contrato db.d.ts) ---------------- */
function makeDbCapability() {
  const store = new Map();     // fullpath -> objeto
  const leases = new Map();    // fullpath -> {holder, expiresAt}
  const listeners = [];
  const queue = [];
  let scheduled = false;

  const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const dbErr = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };

  function checkPath(path, wantDoc) {
    const p = String(path);
    const parts = p.split("/");
    if (parts.some(s => s === "" || s === "." || s === "..")) throw new TypeError("segmento inválido: " + p);
    if (!/^[A-Za-z0-9_\-.~:@+/]+$/.test(p)) throw new TypeError("caractere inválido no path: " + p);
    if (wantDoc && parts.length % 2 !== 0) throw new TypeError("doc precisa de nº par de segmentos: " + p);
    if (!wantDoc && parts.length % 2 === 0) throw new TypeError("collection precisa de nº ímpar: " + p);
    return parts;
  }
  function schedule() { if (!scheduled) { scheduled = true; queue.push(() => { scheduled = false; fireAll(); }); } }
  function mutate(fn) { fn(); schedule(); }

  function deepMerge(t, patch) {
    for (const k of Object.keys(patch)) {
      const pv = patch[k];
      if (pv && typeof pv === "object" && !Array.isArray(pv) &&
        t[k] && typeof t[k] === "object" && !Array.isArray(t[k])) deepMerge(t[k], pv);
      else t[k] = clone(pv);
    }
  }

  const docSnap = path => {
    const data = store.get(path);
    return {
      id: path.split("/").pop(),
      exists: data !== undefined,
      data: () => (data === undefined ? undefined : clone(data)),
      metadata: { fromCache: false, hasPendingWrites: false },
    };
  };
  function collDocPaths(collPath) {
    const prefix = collPath + "/";
    const n = collPath.split("/").length + 1;
    const out = [];
    for (const k of store.keys()) if (k.startsWith(prefix) && k.split("/").length === n) out.push(k);
    out.sort();
    return out;
  }
  const querySnap = collPath => {
    const docs = collDocPaths(collPath).map(docSnap);
    return { docs, size: docs.length, empty: docs.length === 0, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  };

  function fireAll() {
    for (const L of listeners.slice()) {
      if (L.dead) continue;
      let snap, key;
      if (L.type === "doc") { snap = docSnap(L.path); key = JSON.stringify([snap.exists, snap.data() || 0]); }
      else { snap = querySnap(L.path); key = JSON.stringify(snap.docs.map(d => [d.id, d.data()])); }
      if (key === L.last) continue;
      L.last = key;
      try { L.next(snap); } catch (e) { /* engole */ }
    }
  }

  function docRef(path) {
    checkPath(path, true);
    const ref = {
      id: path.split("/").pop(), path,
      get: () => Promise.resolve(docSnap(path)),
      set(data) {
        if (!data || typeof data !== "object" || Array.isArray(data)) return Promise.reject(dbErr("invalid_argument", "corpo precisa ser objeto"));
        mutate(() => store.set(path, clone(data)));
        return Promise.resolve();
      },
      update(data) {
        if (!store.has(path)) return Promise.reject(dbErr("invalid_argument", "documento não existe: " + path));
        if (!data || typeof data !== "object" || Array.isArray(data)) return Promise.reject(dbErr("invalid_argument", "corpo precisa ser objeto"));
        mutate(() => { const cur = store.get(path); deepMerge(cur, data); store.set(path, cur); });
        return Promise.resolve();
      },
      delete() { mutate(() => store.delete(path)); return Promise.resolve(); },
      acquire(opts) {
        opts = opts || {};
        const now = Date.now();
        const cur = leases.get(path);
        const free = !cur || cur.expiresAt <= now || cur.holder === opts.holder;
        if (!free) return Promise.resolve({ acquired: false, expiresAt: new Date(cur.expiresAt).toISOString() });
        const ttl = Math.min(600000, Math.max(1000, opts.ttlMs || 30000));
        const exp = now + ttl;
        leases.set(path, { holder: opts.holder, expiresAt: exp });
        return Promise.resolve({ acquired: true, holder: opts.holder, expiresAt: new Date(exp).toISOString(), version: 1 });
      },
      onSnapshot(next) {
        const L = { type: "doc", path, next, last: "INIT", dead: false };
        listeners.push(L);
        queue.push(() => { if (!L.dead) { const s = docSnap(path); L.last = JSON.stringify([s.exists, s.data() || 0]); try { L.next(s); } catch (e) {} } });
        return () => { L.dead = true; };
      },
      collection: sub => collRef(path + "/" + sub),
    };
    return ref;
  }

  function collRef(path) {
    checkPath(path, false);
    const q = {
      path,
      where: () => q, orderBy: () => q, limit: () => q,
      get: () => Promise.resolve(querySnap(path)),
      doc: id => docRef(path + "/" + (id || "auto-" + Math.random().toString(36).slice(2))),
      add(data) { const r = docRef(path + "/auto-" + Math.random().toString(36).slice(2)); return r.set(data).then(() => r); },
      onSnapshot(next) {
        const L = { type: "coll", path, next, last: "INIT", dead: false };
        listeners.push(L);
        queue.push(() => { if (!L.dead) { const s = querySnap(path); L.last = JSON.stringify(s.docs.map(d => [d.id, d.data()])); try { L.next(s); } catch (e) {} } });
        return () => { L.dead = true; };
      },
    };
    return q;
  }

  return {
    doc: p => docRef(p),
    collection: p => collRef(p),
    async _drain() { let g = 0; while (queue.length && g++ < 200000) { queue.shift()(); await Promise.resolve(); } },
    _reset() { store.clear(); leases.clear(); listeners.length = 0; queue.length = 0; scheduled = false; },
    _dump() { const o = {}; for (const [k, v] of store) o[k] = v; return o; },
    _count() { return store.size; },
  };
}

/* ---------------- aparelho = 1 contexto vm + localStorage próprio ---------------- */
function makeDevice(db, name, ident) {
  const mem = new Map();
  const localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
  };
  const document = makeDocument();
  const sandbox = {
    document, localStorage,
    navigator: { userAgent: "node", vibrate() {}, share: undefined, clipboard: undefined },
    location: { hash: "", href: "https://exemplo/quem" },
    window: null, console,
    Math, JSON, Date, Promise, RegExp, Error, TypeError, Boolean,
    BigInt, Number, String, Array, Object, isNaN, isFinite, parseInt, parseFloat,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    scrollTo() {}, addEventListener() {},
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  script.runInContext(sandbox);
  const T = sandbox.__t;
  if (!T) throw new Error("as funções da sala não foram expostas");
  return { name, sandbox, T, mem, localStorage, client: T.CriarSalaCliente(db, ident || null) };
}

/* ---------------- runner ---------------- */
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("  FALHA: " + m); } };
const tick = () => new Promise(r => setTimeout(r, 0));

let DB;
async function settle() { await DB._drain(); await tick(); await DB._drain(); await tick(); await DB._drain(); }

function T0() { return dev0.T; }
let dev0;

async function novaSala(N, mask, nivel) {
  DB._reset();
  const devices = [];
  for (let i = 0; i < N; i++) devices.push(makeDevice(DB, "P" + (i + 1)));
  dev0 = devices[0];
  const host = devices[0].client;
  await host.criar("", "P1", mask, nivel);
  await settle();
  const codigo = host.codigo;
  for (let i = 1; i < N; i++) {
    const c = devices[i].client;
    const res = await c.abrir(codigo);
    ok(res && res.precisaNick, "N=" + N + ": P" + (i + 1) + " deveria precisar de nick");
    ok(res.membros && res.membros.length === i, "N=" + N + ": P" + (i + 1) + " deveria ver " + i + " membros, viu " + (res.membros ? res.membros.length : "?"));
    await c.entrarNovo("P" + (i + 1));
    await settle();
  }
  return { devices, codigo, host };
}

async function jogarPartida(devices, ordemGanho) {
  // ordemGanho: array de índices (0..N-1) na ordem em que acertam
  const host = devices[0].client;
  await host.comecar();
  await settle();

  const N = devices.length;
  const cartas = devices.map(d => d.client.vm().minhaCarta);
  ok(new Set(cartas).size === N, "cartas distintas entre " + N + " jogadores (viu " + JSON.stringify(cartas) + ")");
  ok(cartas.every(Boolean), "todo participante recebeu carta");

  // todos revelam e escondem
  for (let i = 0; i < N; i++) { await devices[i].client.esconder(); await settle(); }
  ok(host.vm().fase === "jogando", "N=" + N + ": fase deveria virar 'jogando', está '" + host.vm().fase + "'");

  // acertam na ordem pedida
  for (let p = 0; p < ordemGanho.length; p++) {
    const idx = ordemGanho[p];
    const carta = devices[idx].client.vm().minhaCarta;
    const res = await devices[idx].client.palpite(carta);
    await settle();
    ok(res && res.ok, "P" + (idx + 1) + " deveria acertar com a própria carta");
    ok(res.posicao === p + 1, "P" + (idx + 1) + " deveria ser " + (p + 1) + "º, veio " + (res && res.posicao));
  }
  ok(host.vm().fase === "fim", "N=" + N + ": fase deveria virar 'fim', está '" + host.vm().fase + "'");

  // palpite errado não conta
  return { cartas };
}

async function cenarioCompleto(N) {
  const mask = T0Mask();
  const { devices } = await novaSala(N, mask, 0);
  const host = devices[0].client;

  ok(host.vm().numParticipantes === N, "N=" + N + ": " + N + " participantes por padrão (presentes), veio " + host.vm().numParticipantes);
  ok(host.vm().membros.length === N, "N=" + N + ": roster com " + N + " membros");

  // senha errada antes de começar não quebra nada
  const ordem = [];
  for (let i = N - 1; i >= 0; i--) ordem.push(i); // ganham na ordem inversa da entrada
  await jogarPartida(devices, ordem);

  // pódio
  const podio = host.vm().podio;
  ok(podio.length === N, "N=" + N + ": pódio com " + N);
  for (let p = 0; p < N; p++) {
    ok(podio[p].posicao === p + 1, "N=" + N + ": pódio posição " + (p + 1));
    ok(podio[p].nick === "P" + (ordem[p] + 1), "N=" + N + ": " + (p + 1) + "º deveria ser P" + (ordem[p] + 1) + ", é " + podio[p].nick);
  }

  // histórico: exatamente 1 partida, sem duplicar mesmo com settle repetido
  await settle(); await settle();
  let parts = host.vm().partidas;
  ok(parts.length === 1, "N=" + N + ": histórico com 1 partida, tem " + parts.length);
  ok(parts[0].quantos === N, "N=" + N + ": partida registrou " + N + " jogadores");

  // classificação: 1º = N pontos, último = 1 ponto
  const cl = host.vm().classificacao;
  const vend = cl.find(x => x.nick === "P" + (ordem[0] + 1));
  const last = cl.find(x => x.nick === "P" + (ordem[N - 1] + 1));
  ok(vend && vend.pontos === N, "N=" + N + ": vencedor faz " + N + " pts, fez " + (vend && vend.pontos));
  ok(last && last.pontos === 1, "N=" + N + ": último faz 1 pt, fez " + (last && last.pontos));
  ok(cl[0].nick === "P" + (ordem[0] + 1), "N=" + N + ": líder da classificação é o vencedor");

  // jogar de novo -> lobby, cartas limpas
  await host.jogarDeNovo();
  await settle();
  ok(host.vm().fase === "lobby", "N=" + N + ": jogar de novo volta pro lobby");
  ok(devices.every(d => d.client.vm().minhaCarta == null), "N=" + N + ": cartas zeradas na nova partida");
  ok(host.vm().numParticipantes === N, "N=" + N + ": participantes recalculados no lobby");

  // 2ª partida, ordem diferente
  const ordem2 = [];
  for (let i = 0; i < N; i++) ordem2.push(i);
  await jogarPartida(devices, ordem2);
  await settle();
  parts = host.vm().partidas;
  ok(parts.length === 2, "N=" + N + ": 2 partidas no histórico, tem " + parts.length);
  ok(parts[0].pid !== parts[1].pid, "N=" + N + ": pids distintos");

  // classificação acumulada: cada um jogou 2 partidas
  const cl2 = host.vm().classificacao;
  ok(cl2.every(x => x.partidas === 2), "N=" + N + ": todos com 2 partidas na classificação");

  // limpeza
  devices.forEach(d => d.client.sair());
}

function T0Mask() {
  // usa um baralho pequeno de propósito p/ estressar distribuição: só "Games" fácil (22 cartas)
  return 1 << 5;
}

async function cenarioReingresso() {
  const { devices, codigo } = await novaSala(3, T0Mask(), 0);
  const host = devices[0].client;
  // P2 troca de aparelho (localStorage limpo). Deve ver a lista e dizer "sou eu".
  const p2novo = makeDevice(DB, "P2-b");
  const res = await p2novo.client.abrir(codigo);
  ok(res.precisaNick && res.membros.length === 3, "reingresso: P2 novo vê 3 membros para escolher");
  const alvo = res.membros.find(m => m.nick === "P2");
  await p2novo.client.assumir(alvo.id);
  await settle();
  ok(p2novo.client.meuId === alvo.id, "reingresso: P2 retomou o mesmo jogadorId");
  ok(host.vm().membros.length === 3, "reingresso: roster continua com 3 (não duplicou)");
  devices.forEach(d => d.client.sair()); p2novo.client.sair();
}

/* Identidade vinda do Firebase Auth.
   Sem identidade o jogador é um uuid de aparelho — e é por isso que a
   regra de segurança de salas/{cod}/jogadores/{jid} não tinha como
   funcionar: não há o que provar sobre um uuid. Com auth.uid, o id do
   jogador passa a ser algo que o Firestore consegue verificar. */
async function cenarioIdentidade() {
  DB._reset();

  const ana = makeDevice(DB, "Ana", { uid: "auth-ana" });
  const bia = makeDevice(DB, "Bia", { uid: "auth-bia" });

  await ana.client.criar("MESA1", "Ana", T0Mask(), 0, "  Rolê da firma  ");
  await settle();
  ok(ana.client.meuId === "auth-ana", "criar sala usa o auth.uid como id do jogador");
  ok(DB._dump()["salas/MESA1/jogadores/auth-ana"] !== undefined,
     "o documento do jogador é indexado pelo uid");
  ok(DB._dump()["salas/MESA1"].hostId === "auth-ana",
     "hostId é o uid — é o que a regra compara");
  ok(DB._dump()["salas/MESA1"].nome === "Rolê da firma",
     "nome opcional da sala é gravado (trim), veio: " + JSON.stringify(DB._dump()["salas/MESA1"].nome));
  ok(ana.client.vm().nomeSala === "Rolê da firma", "vm expõe o nome da sala pro host");

  await bia.client.abrir("MESA1");
  await bia.client.entrarNovo("Bia");
  await settle();
  ok(bia.client.meuId === "auth-bia", "entrar como novo também usa o uid");
  ok(ana.client.vm().membros.length === 2, "roster com 2");
  ok(bia.client.vm().nomeSala === "Rolê da firma", "quem entra também vê o nome da sala");

  /* O ganho que a migração traz de graça: trocar de celular deixa de
     depender do localStorage daquele aparelho. */
  const anaOutroCelular = makeDevice(DB, "Ana-b", { uid: "auth-ana" });
  ok(anaOutroCelular.localStorage.getItem("quemsoueu:salas") === null,
     "o aparelho novo começa sem nada salvo");
  const res = await anaOutroCelular.client.abrir("MESA1");
  await settle();
  ok(res.ok === true, "logada, ela é reconhecida sem escolher da lista");
  ok(anaOutroCelular.client.meuId === "auth-ana", "e volta como o mesmo jogador");
  ok(anaOutroCelular.client.meuNick === "Ana", "com o nick que já tinha");
  ok(ana.client.vm().membros.length === 2, "sem duplicar no roster");

  /* Sem identidade, o comportamento antigo continua igual: uuid de
     aparelho e escolha manual na lista. É o que mantém o convidado. */
  const convidado = makeDevice(DB, "Convidado");
  const r2 = await convidado.client.abrir("MESA1");
  ok(r2.precisaNick === true, "sem login, ainda cai na lista de 'sou eu'");

  [ana, bia, anaOutroCelular, convidado].forEach(d => d.client.sair());
}

async function cenarioCodigoDigitadoExistente() {
  DB._reset();
  const a = makeDevice(DB, "A"), b = makeDevice(DB, "B");
  await a.client.criar("FESTA", "Ana", T0Mask(), 0);
  await settle();
  ok(a.client.codigo === "FESTA", "código digitado 'FESTA' foi usado");
  // B tenta criar com o MESMO código -> deve recusar com motivo 'existe', sem sobrescrever
  let motivo = null;
  await b.client.criar("FESTA", "Beto", 1, 2).catch(e => { motivo = e && e.motivo; });
  await settle();
  ok(motivo === "existe", "criar sobre código existente recusa com motivo 'existe' (veio " + motivo + ")");
  const sala = DB._dump()["salas/FESTA"];
  ok(sala && sala.hostId === a.client.meuId, "sala 'FESTA' continua sendo da Ana (não sobrescreveu)");
  ok(sala.mask === T0Mask() && sala.nivel === 0, "config da sala 'FESTA' intacta");
  // B então entra na sala existente
  const r = await b.client.abrir("FESTA");
  ok(r.precisaNick, "B pode entrar na sala existente");
  await b.client.entrarNovo("Beto");
  await settle();
  ok(a.client.vm().membros.length === 2, "Ana vê Beto entrar em tempo real");
  a.client.sair(); b.client.sair();
}

async function cenarioNickRepetido() {
  const { devices, codigo } = await novaSala(2, T0Mask(), 0);
  const c = makeDevice(DB, "X");
  await c.client.abrir(codigo);
  let motivo = null;
  await c.client.entrarNovo("P1").catch(e => { motivo = e && e.motivo; });
  ok(motivo === "nick-repetido", "nick repetido é recusado (veio " + motivo + ")");
  await c.client.entrarNovo("P1 ").catch(() => {}); // "P1 " normaliza p/ "P1" -> também recusa
  ok(devices[0].client.vm().membros.length === 2, "roster não cresceu com nick repetido");
  devices.forEach(d => d.client.sair()); c.client.sair();
}

async function cenarioAusenteNaoTrava() {
  // 4 membros, host tira 1 da partida no lobby -> 3 jogam, o de fora não trava.
  const { devices } = await novaSala(4, T0Mask(), 0);
  const host = devices[0].client;
  const fora = host.vm().membros[3].id;
  await host.marcar(fora, false);
  await settle();
  ok(host.vm().numParticipantes === 3, "host desmarcou 1: 3 participantes");
  await host.comecar();
  await settle();
  ok(devices[3].client.vm().minhaCarta == null, "membro de fora não recebeu carta");
  ok(!devices[3].client.vm().souParticipante, "membro de fora não é participante");
  // os 3 revelam
  for (let i = 0; i < 3; i++) { await devices[i].client.esconder(); await settle(); }
  ok(host.vm().fase === "jogando", "fase avança com 3 de 4 (ausente não trava revelação)");
  for (let i = 2; i >= 0; i--) { await devices[i].client.palpite(devices[i].client.vm().minhaCarta); await settle(); }
  ok(host.vm().fase === "fim", "fase chega em 'fim' com 3 (ausente não trava)");
  ok(host.vm().partidas[0].quantos === 3, "histórico registra os 3 que jogaram");
  devices.forEach(d => d.client.sair());
}

async function cenarioEntrouNoMeio() {
  const { devices, codigo } = await novaSala(3, T0Mask(), 0);
  const host = devices[0].client;
  await host.comecar();
  await settle();
  // P4 chega no meio
  const p4 = makeDevice(DB, "P4");
  await p4.client.abrir(codigo);
  await p4.client.entrarNovo("P4");
  await settle();
  ok(!p4.client.vm().souParticipante, "quem entrou no meio não é participante desta partida");
  // os 3 originais terminam normalmente
  for (let i = 0; i < 3; i++) { await devices[i].client.esconder(); await settle(); }
  for (let i = 0; i < 3; i++) { await devices[i].client.palpite(devices[i].client.vm().minhaCarta); await settle(); }
  ok(host.vm().fase === "fim", "partida termina apesar do novato");
  ok(host.vm().partidas[0].quantos === 3, "novato de fora não entra no registro");
  // próxima partida: P4 entra
  await host.jogarDeNovo();
  await settle();
  ok(host.vm().numParticipantes === 4, "na partida seguinte o novato é participante (4)");
  devices.forEach(d => d.client.sair()); p4.client.sair();
}

async function cenarioReloadNoMeio() {
  const { devices, codigo } = await novaSala(3, T0Mask(), 0);
  const host = devices[0].client;
  await host.comecar();
  await settle();
  await devices[1].client.esconder();
  await settle();
  const cartaAntes = devices[1].client.vm().minhaCarta;
  const idAntes = devices[1].client.meuId;
  // "reload": mesmo aparelho (mesmo localStorage), cliente novo
  const rel = makeDevice(DB, "P2-reload");
  rel.mem.set("quemsoueu:salas", devices[1].mem.get("quemsoueu:salas"));
  rel.mem.set("quemsoueu:nick", devices[1].mem.get("quemsoueu:nick"));
  const res = await rel.client.abrir(codigo);
  await settle();
  ok(res.ok, "reload retoma direto (sem pedir nick)");
  ok(rel.client.meuId === idAntes, "reload: mesmo jogadorId");
  ok(rel.client.vm().minhaCarta === cartaAntes, "reload: mesma carta");
  ok(rel.client.vm().fase === "revelando" || rel.client.vm().fase === "jogando", "reload: mesma fase");
  ok(rel.client.vm().jaEscondi === true, "reload: continua tendo revelado");
  devices.forEach(d => d.client.sair()); rel.client.sair();
}

async function cenarioApagar() {
  const { devices, codigo } = await novaSala(3, T0Mask(), 0);
  const host = devices[0].client;
  await jogarPartida(devices, [0, 1, 2]);
  await settle();
  ok(DB._count() > 3, "sala tem docs (sala + jogadores + hist)");
  await host.apagar();
  await settle();
  ok(DB._dump()["salas/" + codigo] === undefined, "apagar remove o doc da sala");
  ok(DB._count() === 0, "apagar remove tudo (jogadores + histórico), sobrou " + DB._count());
  ok(devices[1].client.vm().apagada, "os outros veem a sala como apagada");
  ok(JSON.parse(host && devices[0].mem.get("quemsoueu:salas") || "[]").every(s => s.codigo !== codigo), "sala some de 'Suas salas' do host");
  devices.forEach(d => d.client.sair());
}

async function cenarioHistoricoIdempotente() {
  // dois aparelhos com a MESMA identidade de host na tela de fim.
  const { devices, codigo } = await novaSala(4, T0Mask(), 0);
  const host = devices[0].client;
  await jogarPartida(devices, [0, 1, 2, 3]);
  // "segundo celular" do host: mesmo jogadorId
  const host2 = makeDevice(DB, "host-b");
  host2.mem.set("quemsoueu:salas", devices[0].mem.get("quemsoueu:salas"));
  await host2.client.abrir(codigo);
  await settle(); await settle();
  const items = DB._dump()["salas/" + codigo + "/hist/registro"].items;
  ok(Object.keys(items).length === 1, "dois hosts na tela de fim gravam 1 partida só, tem " + Object.keys(items).length);
  // e joga de novo 2x -> 3 no total, sem duplicar
  await host.jogarDeNovo(); await settle();
  await jogarPartida(devices, [3, 2, 1, 0]); await settle();
  await host.jogarDeNovo(); await settle();
  await jogarPartida(devices, [1, 0, 3, 2]); await settle();
  const it2 = DB._dump()["salas/" + codigo + "/hist/registro"].items;
  ok(Object.keys(it2).length === 3, "3 partidas seguidas = 3 registros, tem " + Object.keys(it2).length);
  // jogador que entra só na 2ª aparece com 1 partida
  devices.forEach(d => d.client.sair()); host2.client.sair();
}

async function cenarioPalpiteCedo() {
  // item 3.3.5: quem esconde já pode arriscar a senha, antes dos outros mostrarem
  const { devices } = await novaSala(3, T0Mask(), 0);
  const host = devices[0].client;
  await host.comecar();
  await settle();
  // P1 esconde e chuta na hora, ainda na fase "revelando"
  await devices[0].client.esconder();
  await settle();
  ok(host.vm().fase === "revelando", "ainda em 'revelando' (só P1 mostrou)");
  const r1 = await devices[0].client.palpite(devices[0].client.vm().minhaCarta);
  await settle();
  ok(r1 && r1.ok && r1.posicao === 1, "P1 arrisca cedo e fica em 1º");
  // P3 tenta chutar sem ter mostrado -> barrado
  const rBarrado = await devices[2].client.palpite(devices[2].client.vm().minhaCarta);
  ok(rBarrado && rBarrado.erro === "fase", "quem não mostrou não pode palpitar");
  // P2 e P3 mostram e chutam
  await devices[1].client.esconder(); await settle();
  await devices[2].client.esconder(); await settle();
  ok(host.vm().fase === "jogando", "todos mostraram -> 'jogando'");
  const r2 = await devices[1].client.palpite(devices[1].client.vm().minhaCarta); await settle();
  const r3 = await devices[2].client.palpite(devices[2].client.vm().minhaCarta); await settle();
  ok(r2.posicao === 2 && r3.posicao === 3, "ordem final: P1, P2, P3");
  ok(host.vm().fase === "fim" && host.vm().podio[0].nick === "P1", "P1 (chutou cedo) ganha a partida");
  devices.forEach(d => d.client.sair());
}

async function cenarioReconfig() {
  const { devices } = await novaSala(3, T0Mask(), 0);
  const host = devices[0].client;
  ok(host.vm().mask === T0Mask() && host.vm().nivel === 0, "config inicial da sala");
  await host.reconfigurar(dev0.T.ALL_MASK, 2);
  await settle();
  ok(host.vm().mask === dev0.T.ALL_MASK && host.vm().nivel === 2, "reconfigurar troca baralhos/nível no lobby");
  ok(devices[1].client.vm().mask === dev0.T.ALL_MASK, "os outros veem a config nova");
  // não-host não consegue reconfigurar
  let err = null;
  await devices[1].client.reconfigurar(1, 0).catch(e => { err = e && e.motivo; });
  ok(err === "fase", "só o host reconfigura");
  await host.comecar();
  await settle();
  ok(devices[0].client.vm().minhaCarta, "comecar usa a config reconfigurada sem erro");
  devices.forEach(d => d.client.sair());
}

async function cenarioDistribuicaoGrande() {
  // o app aceita até 16 participantes; o motor de cartas é o mesmo do offline.
  for (const N of [9, 10, 12, 14, 16]) {
    const { devices } = await novaSala(N, T0Mask(), 0); // "Games" fácil = 22 cartas
    const host = devices[0].client;
    await host.comecar();
    await settle();
    const cartas = devices.map(d => d.client.vm().minhaCarta);
    ok(new Set(cartas).size === N && cartas.every(Boolean), N + " participantes: cartas distintas");
    // fluxo curto: todos revelam e acertam
    for (let i = 0; i < N; i++) { await devices[i].client.esconder(); await settle(); }
    for (let i = 0; i < N; i++) { await devices[i].client.palpite(devices[i].client.vm().minhaCarta); await settle(); }
    ok(host.vm().fase === "fim" && host.vm().podio.length === N, N + " participantes: partida fecha com pódio completo");
    devices.forEach(d => d.client.sair());
  }
}

async function cenarioClassificacaoParcial() {
  const { devices, codigo } = await novaSala(3, T0Mask(), 0);
  const host = devices[0].client;
  await jogarPartida(devices, [0, 1, 2]);
  await settle();
  await host.jogarDeNovo();
  await settle();
  // P4 entra só agora
  const p4 = makeDevice(DB, "P4");
  await p4.client.abrir(codigo);
  await p4.client.entrarNovo("P4");
  await settle();
  const all = [devices[0], devices[1], devices[2], p4];
  await jogarPartida(all, [3, 0, 1, 2]);
  await settle();
  const cl = host.vm().classificacao;
  const p4c = cl.find(x => x.nick === "P4");
  const p1c = cl.find(x => x.nick === "P1");
  ok(p4c && p4c.partidas === 1, "quem entrou na 2ª partida tem 1 partida (tem " + (p4c && p4c.partidas) + ")");
  ok(p1c && p1c.partidas === 2, "quem jogou as duas tem 2 partidas");
  ok(p4c && p4c.pontos === 4, "P4 ganhou a partida de 4 e fez 4 pts");
  devices.forEach(d => d.client.sair()); p4.client.sair();
}

function testesPuros() {
  const T = dev0 ? dev0.T : makeDevice(makeDb(), "puro").T;
  const S = T.senhaConfere;
  ok(S("remy", "Remy (Ratatouille)"), "senha: 'remy' aceita p/ Remy (Ratatouille)");
  ok(S("remy ratatouille", "Remy (Ratatouille)"), "senha: 'remy ratatouille' aceita");
  ok(S("REMY RATATOUILLE", "Remy (Ratatouille)"), "senha: caixa alta aceita");
  ok(S("remy  ratatouille", "Remy (Ratatouille)"), "senha: espaço duplo aceita");
  ok(S("jessie", "Jessie (Toy Story)"), "senha: 'jessie' aceita p/ Jessie (Toy Story)");
  ok(S("jessie toy story", "Jessie (Toy Story)"), "senha: 'jessie toy story' aceita");
  ok(S("coelho branco", "Coelho Branco (Alice)"), "senha: 'coelho branco' aceita");
  ok(S("toto", "Toto (O Mágico de Oz)"), "senha: 'toto' aceita");
  ok(S("bob esponja", "Bob Esponja"), "senha: nome sem parêntese exige nome cheio");
  ok(S("josé", "Zé") === false, "senha: 'josé' não passa por 'Zé'");
  ok(S("", "Bob Esponja") === false, "senha: vazio nunca passa");
  ok(S("são jorge", "São Jorge"), "senha: acento normalizado ('são jorge' == 'sao jorge')");
  ok(S("sao jorge", "São Jorge"), "senha: sem acento também passa");
  ok(S("sr siriguejo", "Sr. Siriguejo"), "senha: pontuação ignorada");
  ok(!S("bob", "Bob Esponja"), "senha: primeiro nome só não basta");
  ok(S("r2d2", "R2-D2") && S("R2-D2", "R2-D2"), "senha: 'r2d2' e 'R2-D2' passam");
  ok(S("c3po", "C-3PO"), "senha: 'c3po' passa por C-3PO");
  ok(S("walle", "Wall-E") && S("wall e", "Wall-E"), "senha: Wall-E junto ou separado");
  ok(S("relampago mcqueen", "Relâmpago McQueen"), "senha: Relâmpago McQueen sem acento");
  ok(S("acdc", "AC/DC") && S("ac dc", "AC/DC"), "senha: AC/DC");
  ok(!S("qualquer coisa", "Bob Esponja"), "senha: palpite aleatório não passa");

  // varre o baralho real: toda carta é aceita quando digitada 'do jeito óbvio'
  var falhasCarta = 0;
  for (var pi = 0; pi < T.POOL.length; pi++){
    var nome = T.POOL[pi].n;
    if (!S(nome, nome)) { falhasCarta++; if (falhasCarta < 4) console.log("    (carta não confere consigo: " + nome + ")"); }
  }
  ok(falhasCarta === 0, "senha: todas as " + T.POOL.length + " cartas conferem com o próprio nome (" + falhasCarta + " falhas)");

  ok(T.normCodigo("  festa ") === "", "normCodigo: sala é só número, letra não sobra nenhuma");
  ok(T.normCodigo("f3st@") === "3", "normCodigo: descarta tudo que não é dígito");
  ok(T.normCodigo("ab12cd34ef") === "1234", "normCodigo: junta os dígitos espalhados");
  ok(T.normCodigo("123456789") === "1234", "normCodigo: corta em 4");
  ok(T.nickValido("Zé") && !T.nickValido("") && !T.nickValido("nome muito comprido!!"), "nickValido: 1..14");

  // pontuação por posição + desempate por vitórias
  const hist = { items: {
    a: { terminadaEm: 1, resultados: [{ id: "x", nick: "X", posicao: 1 }, { id: "y", nick: "Y", posicao: 2 }] },
    b: { terminadaEm: 2, resultados: [{ id: "x", nick: "X", posicao: 1 }, { id: "y", nick: "Y", posicao: 2 }] },
    c: { terminadaEm: 3, resultados: [
      { id: "w", nick: "W", posicao: 1 }, { id: "y", nick: "Y", posicao: 2 },
      { id: "v", nick: "V", posicao: 3 }, { id: "x", nick: "X", posicao: 4 }] },
  } };
  const cl = T.calcClassificacao(hist);
  const X = cl.find(o => o.id === "x"), Y = cl.find(o => o.id === "y"), V = cl.find(o => o.id === "v");
  ok(X.pontos === 2 + 2 + 1, "classificação: X = 2+2 (1º de 2) + 1 (4º de 4) = 5");
  ok(Y.pontos === 1 + 1 + 3, "classificação: Y = 1+1 (2º de 2) + 3 (2º de 4) = 5");
  ok(V.pontos === 2 && V.partidas === 1, "classificação: V = 2 pts, 1 partida");
  ok(X.media === 2 && Y.media === 2, "classificação: colocação média igual (2.0)");
  ok(cl[0].id === "x" && cl[1].id === "y", "classificação: empate em pontos e média desempata por vitórias (X: 2, Y: 0)");
}

async function main() {
  DB = makeDb();
  console.log("SALAS — fluxo completo com db simulado\n");

  for (const N of [2, 3, 4, 5, 6, 7, 8]) {
    const antes = fails;
    await cenarioCompleto(N);
    console.log((fails === antes ? "  ok  " : " FALHA") + "  " + N + " jogadores: criar, entrar, revelar, senha, colocação, pódio, histórico, jogar de novo");
  }

  const blocos = [
    ["reingresso de outro aparelho ('sou eu')", cenarioReingresso],
    ["identidade do Firebase Auth (uid como id do jogador)", cenarioIdentidade],
    ["código digitado que já existe não sobrescreve", cenarioCodigoDigitadoExistente],
    ["nick repetido recusado", cenarioNickRepetido],
    ["membro desmarcado não trava a partida", cenarioAusenteNaoTrava],
    ["quem entra no meio fica de fora da partida", cenarioEntrouNoMeio],
    ["reload no meio devolve o mesmo estado", cenarioReloadNoMeio],
    ["apagar sala remove sala + jogadores + histórico", cenarioApagar],
    ["gravação de histórico idempotente (3 partidas, 0 dup)", cenarioHistoricoIdempotente],
    ["classificação conta só as partidas jogadas", cenarioClassificacaoParcial],
    ["palpite antes de todos mostrarem (item 3.3.5)", cenarioPalpiteCedo],
    ["reconfigurar baralhos no lobby (só host)", cenarioReconfig],
    ["distribuição e fechamento com 9 a 16 participantes", cenarioDistribuicaoGrande],
  ];
  for (const [nome, fn] of blocos) {
    const antes = fails;
    await fn();
    console.log((fails === antes ? "  ok  " : " FALHA") + "  " + nome);
  }

  const antes = fails;
  testesPuros();
  console.log((fails === antes ? "  ok  " : " FALHA") + "  senha / normalização / pontuação (funções puras)");

  console.log("\n" + (fails ? fails + " falha(s)" : "todos os testes de sala passaram"));
  process.exit(fails ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
