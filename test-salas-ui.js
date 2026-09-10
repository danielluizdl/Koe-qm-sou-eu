/* Fumaça da CAMADA DE UI das salas: carrega o app inteiro com um DOM
   que registra eventos e um claude/db simulados, e dirige o HOST por
   cliques reais (go-create, nick-ok, do-create, lobby-comecar,
   carta-mostrar, carta-hide, senha-ok, fim-hist, fim-denovo, apagar).
   Os outros jogadores entram pelo cliente direto. Pega erro de fiação,
   navegação de tela errada e pintor que estoura.
   node test-salas-ui.js */
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync(__dirname + (process.env.JOGO || "/quem-sou-eu-temas.html"), "utf8");
const headHtml = html.slice(0, html.indexOf("<script>"));
const scriptSrc = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</" + "script>"));

/* ids das telas estáticas (para querySelectorAll('.screen') e show()) */
const screenIds = [];
{ let m; const re = /<section class="screen[^"]*" id="([a-z0-9-]+)"/g; while (m = re.exec(headHtml)) screenIds.push(m[1]); }
/* todos os ids estáticos */
const staticIds = []; { let m; const re = /id="([a-z0-9-]+)"/g; while (m = re.exec(headHtml)) staticIds.push(m[1]); }

/* ---------- mini-DOM com eventos ---------- */
function makeDom() {
  const byId = {};
  function mkEl(tag) {
    const el = {
      tagName: (tag || "div").toUpperCase(), _cls: new Set(), _attr: {}, _lis: {},
      children: [], style: {}, value: "", hidden: false, disabled: false, type: "",
      _text: "", _html: "", _kids: [],
      get id() { return this._attr.id || ""; },
      set id(v) { this._attr.id = String(v); },
      get textContent() { return this._text; },
      set textContent(v) { this._text = String(v); },
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = String(v); this.children = []; this._kids = parseStubs(String(v)); },
      set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      get className() { return [...this._cls].join(" "); },
      classList: {
        add: c => el._cls.add(c), remove: c => el._cls.delete(c),
        toggle: (c, on) => { const has = el._cls.has(c); const want = on === undefined ? !has : !!on; want ? el._cls.add(c) : el._cls.delete(c); return want; },
        contains: c => el._cls.has(c),
      },
      setAttribute(k, v) { this._attr[k] = String(v); },
      getAttribute(k) { return this._attr.hasOwnProperty(k) ? this._attr[k] : null; },
      addEventListener(t, fn) { (this._lis[t] = this._lis[t] || []).push(fn); },
      removeEventListener(t, fn) { if (this._lis[t]) this._lis[t] = this._lis[t].filter(f => f !== fn); },
      _fire(t, ev) { (this._lis[t] || []).slice().forEach(fn => fn.call(this, ev || { key: "", preventDefault() {}, target: this })); },
      appendChild(c) { this.children.push(c); this._kids.push(c); return c; },
      querySelector(sel) { return matchOne(this._kids, sel) || mkEl(); },
      querySelectorAll(sel) { return matchAll(this._kids, sel); },
      focus() {}, blur() {},
      get parentElement() { return this._parent || mkEl(); },
    };
    return el;
  }
  function parseStubs(htmlStr) {
    const out = [];
    const re = /<([a-z0-9]+)([^>]*)>/gi; let m;
    while (m = re.exec(htmlStr)) {
      const tag = m[1].toLowerCase();
      if (tag === "br" || tag === "input" || tag === "img") continue;
      const attrs = m[2] || "";
      const el = mkEl(tag);
      const idm = /id="([^"]+)"/.exec(attrs); if (idm) { el._attr.id = idm[1]; byId[idm[1]] = el; }
      const cm = /class="([^"]+)"/.exec(attrs); if (cm) el._cls = new Set(cm[1].split(/\s+/).filter(Boolean));
      out.push(el);
    }
    return out;
  }
  function matchOne(kids, sel) { const a = matchAll(kids, sel); return a[0] || null; }
  function matchAll(kids, sel) {
    return kids.filter(k => {
      if (sel[0] === ".") return k._cls.has(sel.slice(1));
      if (sel[0] === "#") return k._attr.id === sel.slice(1);
      return k.tagName === sel.toUpperCase();
    });
  }

  const document = {
    head: mkEl("head"), body: mkEl("body"), activeElement: null, visibilityState: "visible",
    createElement: t => mkEl(t),
    getElementById: id => { const e = (byId[id] = byId[id] || mkEl()); e._attr.id = id; return e; },
    querySelector: sel => {
      if (sel && sel.indexOf("meta") === 0) return null;
      return null;
    },
    querySelectorAll: sel => {
      if (sel === ".screen") return screenIds.map(id => document.getElementById(id));
      if (sel === "[data-back]") return staticIds.map(id => byId[id]).filter(e => e && e.getAttribute("data-back"));
      return [mkEl(), mkEl(), mkEl(), mkEl(), mkEl(), mkEl(), mkEl(), mkEl()];
    },
    addEventListener() {},
  };
  // pré-cria ids estáticos, marca .screen e data-back
  staticIds.forEach(id => { document.getElementById(id); });
  screenIds.forEach(id => document.getElementById(id)._cls.add("screen"));
  document.getElementById("s-home")._cls.add("on");
  // data-back conforme o HTML
  { let m; const re = /<button class="back"[^>]*id="([a-z0-9-]+)"[^>]*data-back="([a-z0-9-]+)"/g; while (m = re.exec(headHtml)) document.getElementById(m[1]).setAttribute("data-back", m[2]); }
  { let m; const re = /<button class="back" data-back="([a-z0-9-]+)"/g; /* sem id: ignora no smoke */ }

  return { document, byId, mkEl };
}

/* ---------- db simulado (igual test-salas) ---------- */
function makeDb() {
  const store = new Map(), leases = new Map(), listeners = [], queue = [];
  let scheduled = false;
  const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const dbErr = (c, m) => { const e = new Error(m || c); e.code = c; return e; };
  function checkPath(p, wantDoc) {
    const parts = String(p).split("/");
    if (parts.some(s => !s || s === "." || s === "..")) throw new TypeError("path " + p);
    if (wantDoc && parts.length % 2) throw new TypeError("doc par " + p);
    if (!wantDoc && !(parts.length % 2)) throw new TypeError("coll ímpar " + p);
  }
  const sched = () => { if (!scheduled) { scheduled = true; queue.push(() => { scheduled = false; fire(); }); } };
  const mut = fn => { fn(); sched(); };
  function merge(t, p) { for (const k of Object.keys(p)) { const v = p[k]; if (v && typeof v === "object" && !Array.isArray(v) && t[k] && typeof t[k] === "object" && !Array.isArray(t[k])) merge(t[k], v); else t[k] = clone(v); } }
  const dsnap = path => { const d = store.get(path); return { id: path.split("/").pop(), exists: d !== undefined, data: () => (d === undefined ? undefined : clone(d)), metadata: {} }; };
  const cpaths = cp => { const pre = cp + "/", n = cp.split("/").length + 1, o = []; for (const k of store.keys()) if (k.startsWith(pre) && k.split("/").length === n) o.push(k); return o.sort(); };
  const qsnap = cp => { const docs = cpaths(cp).map(dsnap); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} }; };
  function fire() {
    for (const L of listeners.slice()) {
      if (L.dead) continue;
      let s, key;
      if (L.type === "doc") { s = dsnap(L.path); key = JSON.stringify([s.exists, s.data() || 0]); }
      else { s = qsnap(L.path); key = JSON.stringify(s.docs.map(d => [d.id, d.data()])); }
      if (key === L.last) continue; L.last = key;
      try { L.next(s); } catch (e) { console.log("  (snapshot handler jogou: " + e.message + ")"); }
    }
  }
  function dref(path) {
    checkPath(path, true);
    return {
      id: path.split("/").pop(), path,
      get: () => Promise.resolve(dsnap(path)),
      set(d) { if (!d || typeof d !== "object" || Array.isArray(d)) return Promise.reject(dbErr("invalid_argument")); mut(() => store.set(path, clone(d))); return Promise.resolve(); },
      update(d) { if (!store.has(path)) return Promise.reject(dbErr("invalid_argument", "sem doc " + path)); mut(() => { const c = store.get(path); merge(c, d); store.set(path, c); }); return Promise.resolve(); },
      delete() { mut(() => store.delete(path)); return Promise.resolve(); },
      acquire(o) { o = o || {}; const now = Date.now(), c = leases.get(path), free = !c || c.expiresAt <= now || c.holder === o.holder; if (!free) return Promise.resolve({ acquired: false }); leases.set(path, { holder: o.holder, expiresAt: now + Math.min(600000, Math.max(1000, o.ttlMs || 30000)) }); return Promise.resolve({ acquired: true, holder: o.holder, version: 1 }); },
      onSnapshot(next) { const L = { type: "doc", path, next, last: "INIT", dead: false }; listeners.push(L); queue.push(() => { if (!L.dead) { const s = dsnap(path); L.last = JSON.stringify([s.exists, s.data() || 0]); try { L.next(s); } catch (e) {} } }); return () => { L.dead = true; }; },
      collection: sub => cref(path + "/" + sub),
    };
  }
  function cref(path) {
    checkPath(path, false);
    const q = { path, where: () => q, orderBy: () => q, limit: () => q, get: () => Promise.resolve(qsnap(path)), doc: id => dref(path + "/" + (id || "a" + Math.random())), add(d) { const r = dref(path + "/a" + Math.random()); return r.set(d).then(() => r); }, onSnapshot(next) { const L = { type: "coll", path, next, last: "INIT", dead: false }; listeners.push(L); queue.push(() => { if (!L.dead) { const s = qsnap(path); L.last = JSON.stringify(s.docs.map(d => [d.id, d.data()])); try { L.next(s); } catch (e) {} } }); return () => { L.dead = true; }; } };
    return q;
  }
  return { doc: p => dref(p), collection: p => cref(p), async _drain() { let g = 0; while (queue.length && g++ < 200000) { queue.shift()(); await Promise.resolve(); } }, _dump() { const o = {}; for (const [k, v] of store) o[k] = v; return o; }, _count: () => store.size };
}

/* ---------- aparelho: sandbox com o app completo ---------- */
const compiled = new vm.Script(
  scriptSrc.slice(0, scriptSrc.lastIndexOf("})();")) +
  "globalThis.__t={CriarSalaCliente:CriarSalaCliente};" +
  "globalThis.__ui={get SC(){return SC;},get MESA(){return MESA;},get modoAtivo(){return modoAtivo;}," +
  "telaVisivel:telaVisivel,renderSala:renderSala};})();",
  { filename: "app" });

let intervals = [];
function makeApp(db, withClaude) {
  const dom = makeDom();
  const mem = new Map();
  const sandbox = {
    document: dom.document,
    localStorage: { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) },
    navigator: { userAgent: "node", vibrate() {}, share: undefined, clipboard: undefined },
    location: { hash: "", href: "https://exemplo/quem" },
    window: null, console,
    Math, JSON, Date, Promise, RegExp, Error, TypeError, Boolean, BigInt, Number, String, Array, Object,
    isNaN, isFinite, parseInt, parseFloat,
    setTimeout, clearTimeout,
    setInterval: (fn) => { const o = { fn }; intervals.push(o); return o; },
    clearInterval: (o) => { intervals = intervals.filter(x => x !== o); },
    scrollTo() {}, addEventListener() {},
  };
  if (withClaude) sandbox.claude = { use: n => Promise.resolve(n === "db" ? db : null) };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  compiled.runInContext(sandbox);
  return { dom, mem, sandbox, T: sandbox.__t, ui: sandbox.__ui, mkEl: dom.mkEl };
}

/* ---------- runner ---------- */
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("  FALHA: " + m); } };
const tick = () => new Promise(r => setTimeout(r, 0));
let DB;
async function settle() { for (let i = 0; i < 4; i++) { await DB._drain(); await tick(); } }
function flushCountdown() { intervals.slice().forEach(o => { for (let i = 0; i < 4; i++) o.fn(); }); }

async function main() {
  console.log("SALAS — fumaça da UI (host por cliques reais)\n");
  DB = makeDb();

  const A = makeApp(DB, true);
  await tick(); await tick(); // deixa claude.use resolver e ativarOnline rodar

  const g = A.dom.document.getElementById.bind(A.dom.document);
  const click = id => g(id)._fire("click");
  const tela = () => A.ui.telaVisivel();

  ok(!!A.ui.SC === false, "sem sala aberta, SC nulo no início");

  // 1. host cria a sala pela UI
  click("go-create");
  ok(tela() === "s-nick", "go-create (online) leva pra s-nick, foi pra " + tela());
  g("nick-input").value = "Ana";
  click("nick-ok");
  ok(tela() === "s-create", "nick-ok leva pra s-create");
  click("do-create");                          // código sempre sorteado, sem campo pra digitar
  await settle();
  ok(tela() === "s-lobby", "do-create abre o lobby, foi pra " + tela());
  const SC = A.ui.SC;
  ok(SC && /^[0-9]{4}$/.test(SC.codigo || ""), "código de sala com 4 dígitos, só número, veio: " + (SC && SC.codigo));
  const codigo = SC.codigo;

  // 2. B e C entram (cliente direto, sandbox próprio p/ localStorage isolado)
  const B = makeApp(DB, false), C = makeApp(DB, false);
  const cb = B.T.CriarSalaCliente(DB), cc = C.T.CriarSalaCliente(DB);
  await cb.abrir(codigo); await cb.entrarNovo("Bia"); await settle();
  await cc.abrir(codigo); await cc.entrarNovo("Cau"); await settle();
  ok(tela() === "s-lobby" && A.ui.SC.vm().membros.length === 3, "lobby do host mostra 3 membros em tempo real");
  ok(A.ui.SC.vm().numParticipantes === 3, "3 participantes marcados por padrão");

  // 3. host começa
  click("lobby-comecar");
  await settle();
  ok(tela() === "s-carta", "comecar leva o host pra s-carta, foi pra " + tela());

  // 4. host revela pela UI
  click("carta-mostrar");
  ok(intervals.length > 0, "carta-mostrar arma a contagem");
  flushCountdown();               // 3..2..1..0 -> cartaAberta
  // B revela agora: o snapshot que chega NÃO pode resetar a carta aberta do host
  await cb.esconder(); await settle();
  ok(g("carta-actions").innerHTML.indexOf("carta-hide") >= 0, "snapshot de outro jogador não interrompe a carta revelada do host");
  click("carta-flip");            // vira 180 (não pode estourar)
  click("carta-hide");
  await settle();
  ok(A.ui.SC.vm().jaEscondi === true, "host escondeu a carta");
  ok(tela() === "s-passar", "depois de esconder, vem a tela 'vire o celular', foi pra " + tela());
  await cc.esconder(); await settle();   // C revela enquanto host está no s-passar
  ok(tela() === "s-passar", "snapshot de outro jogador não tira o host da tela intermediária");
  click("passar-ok");
  await settle();
  ok(tela() === "s-play" && A.ui.SC.vm().fase === "jogando", "continuar leva pra s-play; todos revelaram -> jogando");
  ok(g("play-mesa-sec").hidden === false, "lista de adversários liberada depois de todos mostrarem");

  // C7.1: esconder/mostrar "Na mesa" — some só a lista, o botão continua ali
  ok(g("play-oponentes").hidden === false, "lista de oponentes visível por padrão");
  click("play-mesa-toggle");
  ok(g("play-oponentes").hidden === true, "esconder some com a lista, não com a seção inteira");
  ok(g("play-mesa-toggle").textContent === "Mostrar", "botão vira 'Mostrar'");
  click("play-mesa-toggle");
  ok(g("play-oponentes").hidden === false, "clicar de novo mostra de novo");

  // C7.2: anotações maiores (estático, essa DOM simulada não lê atributos por getAttribute)
  ok(/id="play-notas"[^>]*rows="6"/.test(headHtml), "anotações com rows=6 (era 3)");

  // C7.3: relógio soma tempo de verdade desde que a fase virou "jogando"
  ok(A.ui.SC.vm().iniciadaEm > 0, "sala.iniciadaEm gravado na virada pra jogando");
  ok(g("play-clock").hidden === false, "relógio aparece assim que a fase vira jogando");
  const relogio1 = g("play-clock").textContent;
  await new Promise(r => setTimeout(r, 1100));
  flushCountdown();
  const relogio2 = g("play-clock").textContent;
  ok(relogio1 !== relogio2, "relógio avança entre duas leituras, era " + relogio1 + " virou " + relogio2);

  // bloco de notas: salva com debounce e sobrevive a "reload"
  g("play-notas").value = "o Bia falou que eu voo";
  g("play-notas")._fire("input");
  await new Promise(r => setTimeout(r, 500));
  const notaKey = "quemsoueu:notas:" + codigo + ":" + A.ui.SC.meuId;
  ok(A.mem.get(notaKey) === "o Bia falou que eu voo", "anotações salvas no localStorage da sala");

  // 5. host dá o palpite certo pela UI
  const cartaHost = A.ui.SC.vm().minhaCarta;
  g("senha-input").value = "xxx errado";
  click("senha-ok");
  await settle();
  ok(tela() === "s-play" && !A.ui.SC.vm().jaAcertei, "palpite errado não avança");
  g("senha-input").value = cartaHost;
  click("senha-ok");
  await settle();
  ok(A.ui.SC.vm().jaAcertei === true, "palpite certo registra o acerto");

  // B acerta primeiro; C ainda não — dá pra ver o destaque no meio da partida
  await cb.palpite(cb.vm().minhaCarta); await settle();
  ok(tela() === "s-play", "com a Cau faltando, o host continua em s-play");

  // C7.4: acerto de outro jogador — borda verde (classe "win", já usada no
  // placar pro 1º lugar) + posição + tempo, na linha de QUEM acertou
  const opHtml = g("play-oponentes").innerHTML;
  ok(/class="row win"/.test(opHtml),
     "linha de quem acertou ganha a classe que pinta a borda verde, veio: " + opHtml);
  ok(/2º/.test(opHtml), "mostra a posição de quem acertou (2º, depois do host)");
  ok(/\d+:\d{2}/.test(opHtml), "mostra o tempo do acerto, veio: " + opHtml);

  await cc.palpite(cc.vm().minhaCarta); await settle();
  ok(tela() === "s-fim", "última pessoa acerta -> s-fim, foi pra " + tela());
  ok(g("fim-podio").querySelectorAll(".row").length === 3, "pódio pintado com 3 linhas");

  // 6. histórico pela UI
  click("fim-hist");
  ok(tela() === "s-hist", "fim-hist abre o histórico");
  click("aba-partidas"); click("aba-geral");   // trocar abas não estoura
  ok(g("hist-geral").querySelectorAll(".row").length === 3, "classificação geral com 3 jogadores");
  ok(g("hist-partidas").querySelectorAll(".row").length >= 1, "aba Partidas lista a partida jogada");
  click("hist-voltar");
  ok(tela() === "s-fim", "voltar do histórico volta pro fim");

  // 7. jogar de novo
  click("fim-denovo");
  await settle();
  ok(tela() === "s-lobby", "jogar de novo volta pro lobby");
  ok(A.ui.SC.vm().minhaCarta == null, "carta zerada");

  // 8. apagar sala (2 toques)
  click("lobby-apagar");
  click("lobby-apagar");
  await settle();
  ok(tela() === "s-home", "apagar sala volta pra home, foi pra " + tela());
  ok(DB._count() === 0, "apagar limpou o db (" + DB._count() + " docs)");

  // 9. sem db (link público): "modo mesa" é o padrão, clássico continua acessível
  intervals = [];
  const OFF = makeApp(makeDb(), false);
  await tick();
  const gd = id => OFF.dom.document.getElementById(id);
  const go = id => gd(id)._fire("click");
  const offTela = () => OFF.ui.telaVisivel();
  go("go-create");
  ok(offTela() === "s-create", "sem db: go-create abre s-create");
  ok(gd("create-modo").hidden === false, "sem db: aparece o toggle Mesa/Clássico");
  /* Os dois modos têm grades DIFERENTES: o Mesa escolhe um dos 20
     temas (o índice cabe nos 5 dígitos do código); o Clássico mantém
     os 15 baralhos independentes, porque o código de 7 caracteres tem
     espaço pra máscara inteira. */
  ok(gd("create-temas").hidden === false && gd("create-nomes").hidden === false,
     "modo Mesa: grade de temas + campos de nome");
  ok(gd("create-baralhos").hidden === true, "modo Mesa: a grade dos 15 baralhos fica escondida");
  ok(gd("mesa-temas").children.length === 20, "modo Mesa: 20 temas");
  go("modo-classico");
  ok(gd("create-baralhos").hidden === false && gd("create-nomes").hidden === true,
     "toggle p/ Clássico: volta pros 15 baralhos, sem os nomes");
  ok(gd("create-temas").hidden === true, "toggle p/ Clássico: a grade de temas some");
  ok(gd("decks").children.length === 15, "Clássico: 15 baralhos independentes");
  go("do-create");
  ok(offTela() === "s-room", "Clássico: do-create gera código de 7 e abre s-room");
  go("go-join");
  ok(offTela() === "s-entrar", "sem db: go-join abre o campo de código");

  // 10. MODO MESA pela UI (link público, sem db)
  intervals = [];
  const MZ = makeApp(makeDb(), false);
  await tick();
  const mg = id => MZ.dom.document.getElementById(id);
  const mc = id => mg(id)._fire("click");
  const mTela = () => MZ.ui.telaVisivel();
  mc("go-create");
  mc("modo-mesa");
  const nVal = () => parseInt(mg("n-val").textContent, 10);
  while (nVal() > 3) mc("n-minus");
  const campos = mg("mesa-nomes-list").children;
  ok(campos.length === 3, "mesa: campos de nome acompanham o stepper (3), tem " + campos.length);
  campos[0].value = "Dani"; campos[0]._fire("input");
  campos[1].value = "Bebel"; campos[1]._fire("input");
  campos[2].value = "Rafa"; campos[2]._fire("input");
  mc("do-create");
  ok(mTela() === "s-mesa", "mesa: do-create abre a tela 'qual é você', foi pra " + mTela());
  ok(/^[0-9]{5}$/.test(MZ.ui.MESA.codigo) && mg("mesa-bigcode").textContent === MZ.ui.MESA.codigo, "mesa: código de 5 números na tela");
  const btns = mg("mesa-slots").children;
  ok(btns.length === 3, "mesa: 3 botões de nome pra escolher");
  const rotulos = [];
  for (let i = 0; i < btns.length; i++) rotulos.push(btns[i].querySelector("b").textContent || "");
  ok(rotulos.slice().sort().join(",") === "Bebel,Dani,Rafa", "mesa: todos os nomes aparecem (embaralhados), vi: " + rotulos.join(","));
  ok(MZ.ui.MESA.nicks.length === 3 && MZ.ui.MESA.nicks.every(Boolean), "mesa: nicks = os 3 nomes numa ordem");
  btns[0]._fire("click");
  ok(mTela() === "s-carta" && MZ.ui.MESA && MZ.ui.MESA.slot === 1, "mesa: escolher slot leva pra carta");
  ok(["Dani", "Bebel", "Rafa"].indexOf(MZ.ui.MESA.nick) >= 0, "mesa: nick escolhido é um dos nomes digitados");
  const cartaDani = MZ.ui.MESA.minhaCarta();
  mc("carta-mostrar");
  flushCountdown();
  mc("carta-hide");
  ok(mTela() === "s-passar", "mesa: esconder leva pra tela 'vire o celular'");
  mc("passar-ok");
  ok(mTela() === "s-play", "mesa: continuar leva pro painel");
  ok(mg("play-oponentes").querySelectorAll(".row").length === 2, "mesa: painel com 2 adversários");
  ok(mg("play-placar-sec").hidden === true, "mesa: sem placar ao vivo");
  ok(mg("play-round").hidden === false, "mesa: controle de rodada visível");
  mg("senha-input").value = "chute errado";
  mc("senha-ok");
  ok(!MZ.ui.MESA.vm().jaAcertei, "mesa: senha errada não libera");
  mg("senha-input").value = cartaDani;
  mc("senha-ok");
  ok(MZ.ui.MESA.vm().jaAcertei, "mesa: senha certa (nome da carta) libera");
  mc("play-r-plus");
  ok(mTela() === "s-carta" && MZ.ui.MESA.rodada === 2, "mesa: próxima rodada volta pra carta nova");
  ok(MZ.ui.MESA.minhaCarta() !== cartaDani, "mesa: rodada 2 = carta diferente");

  console.log("\n" + (fails ? fails + " falha(s)" : "fumaça da UI passou"));
  process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
