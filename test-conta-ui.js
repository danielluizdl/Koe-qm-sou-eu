/* Telas de conta e amigos, por cliques reais no app.

   Carrega o app num contexto vm com um QSE_FIREBASE de mentira (o
   contrato do firebase-boot.js) e o CONTAS de verdade sobre o db
   simulado. Percorre o caminho inteiro: deslogado -> pede link ->
   entra -> cadastra nick -> adiciona amigo -> vê o ranking.

   node test-conta-ui.js */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "quem-sou-eu-temas.html"), "utf8");
const scriptSrc = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</" + "script>"));
const compiled = new vm.Script(
  scriptSrc.slice(0, scriptSrc.lastIndexOf("})();")) +
  "globalThis.__ui={telaVisivel:telaVisivel,get CONTA(){return CONTA;},pintarConta:pintarConta};})();",
  { filename: "app" });

/* ---------- DOM mínimo com eventos ---------- */
/* ids das telas, extraidos do proprio HTML: telaVisivel() e show()
   dependem de querySelectorAll(".screen") devolver SEMPRE os mesmos
   elementos, senao a classe "on" se perde entre uma chamada e outra. */
const screenIds = [];
{ let m; const re = /<section class="screen[^"]*" id="([a-z0-9-]+)"/g;
  while ((m = re.exec(html))) screenIds.push(m[1]); }

function makeDom(){
  const byId = new Map();
  function mkEl(tag){
    const el = {
      tagName: (tag || "div").toUpperCase(),
      children: [], style: {}, hidden: false, value: "", disabled: false,
      _t: "", _h: "", _a: {}, _on: {}, onclick: null, id: "",
      classList: { _s: new Set(),
        add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
        toggle(c, on){ (on === undefined ? !this._s.has(c) : on) ? this._s.add(c) : this._s.delete(c); },
        contains(c){ return this._s.has(c); } },
      get textContent(){ return this._t; }, set textContent(v){ this._t = String(v); },
      get innerHTML(){ return this._h; },
      set innerHTML(v){ this._h = String(v); this.children = []; },
      set className(v){ this.classList._s = new Set(String(v).split(" ").filter(Boolean)); },
      setAttribute(k, v){ this._a[k] = String(v); },
      getAttribute(k){ return Object.prototype.hasOwnProperty.call(this._a, k) ? this._a[k] : null; },
      addEventListener(t, fn){ (this._on[t] = this._on[t] || []).push(fn); },
      removeEventListener(){},
      appendChild(c){ this.children.push(c); return c; },
      querySelector(){ return mkEl(); },
      querySelectorAll(){ return [mkEl(), mkEl(), mkEl(), mkEl()]; },
      focus(){}, blur(){},
      _fire(t){
        if (t === "click" && typeof this.onclick === "function") this.onclick({ preventDefault(){} });
        (this._on[t] || []).forEach(fn => fn({ preventDefault(){}, target: this }));
      }
    };
    return el;
  }
  return {
    mkEl,
    document: {
      head: mkEl(), body: mkEl(), visibilityState: "visible", activeElement: null,
      createElement: t => mkEl(t),
      getElementById(id){
        if (!byId.has(id)){ const e = mkEl(); e.id = id; byId.set(id, e); }
        return byId.get(id);
      },
      querySelector: () => null,
      querySelectorAll(sel){
        if (sel === ".screen") return screenIds.map(id => this.getElementById(id));
        return Array.from({ length: 24 }, () => mkEl());
      },
      addEventListener(){}
    }
  };
}

/* ---------- db simulado: mesmo contrato da capability ---------- */
function makeDb(){
  const store = new Map(), leases = new Map();
  const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const err = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };
  function deepMerge(t, p){
    for (const k of Object.keys(p)){
      const pv = p[k];
      if (pv && typeof pv === "object" && !Array.isArray(pv) &&
          t[k] && typeof t[k] === "object" && !Array.isArray(t[k])) deepMerge(t[k], pv);
      else t[k] = clone(pv);
    }
  }
  const snap = p => { const d = store.get(p);
    return { id: p.split("/").pop(), exists: d !== undefined, data: () => clone(d) }; };
  const filhos = c => { const pre = c + "/", n = c.split("/").length + 1;
    return [...store.keys()].filter(k => k.startsWith(pre) && k.split("/").length === n).sort(); };
  function dref(p){
    return { id: p.split("/").pop(), path: p,
      get: () => Promise.resolve(snap(p)),
      set(d){ store.set(p, clone(d)); return Promise.resolve(); },
      update(d){ if (!store.has(p)) return Promise.reject(err("invalid_argument"));
        const c = store.get(p); deepMerge(c, d); store.set(p, c); return Promise.resolve(); },
      delete(){ store.delete(p); return Promise.resolve(); },
      acquire(o){ const now = Date.now(), cur = leases.get(p);
        if (cur && cur.expiresAt > now && cur.holder !== o.holder) return Promise.resolve({ acquired:false });
        leases.set(p, { holder:o.holder, expiresAt: now + (o.ttlMs||30000) });
        return Promise.resolve({ acquired:true, holder:o.holder }); },
      onSnapshot(){ return () => {}; },
      collection: s => cref(p + "/" + s) };
  }
  function cref(p){
    return { path: p, doc: id => dref(p + "/" + id),
      get: () => Promise.resolve({ docs: filhos(p).map(snap) }),
      onSnapshot(){ return () => {}; } };
  }
  return { doc: dref, collection: cref, _dump: () => Object.fromEntries(store) };
}

/* ---------- QSE_FIREBASE de mentira, no contrato do boot ---------- */
function makeFirebase(db){
  const ouvintes = [];
  const estado = { pronto:false, db, auth:{}, identidade:null, erro:null };
  const F = {
    _enviados: [], _confirmar: false,
    aoMudar(cb){ ouvintes.push(cb); if (estado.pronto) cb(estado); },
    estado: () => estado,
    enviarLink(email){
      email = String(email||"").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Promise.reject(new Error("e-mail inválido"));
      F._enviados.push(email); return Promise.resolve(email);
    },
    precisaConfirmarEmail: () => F._confirmar,
    concluirLoginCom(){ return Promise.resolve({}); },
    sair(){ F._entrar(null); return Promise.resolve(); },
    /* o gatilho do teste: simula o onAuthStateChanged do Firebase */
    _entrar(ident){
      estado.identidade = ident; estado.pronto = true;
      ouvintes.slice().forEach(cb => { try { cb(estado); } catch(e){} });
    }
  };
  return F;
}

function makeApp(db, F){
  const dom = makeDom();
  const mem = new Map();
  const sandbox = {
    document: dom.document,
    localStorage: { getItem: k => (mem.has(k) ? mem.get(k) : null),
      setItem: (k,v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) },
    navigator: { userAgent:"node", vibrate(){} },
    location: { hash:"", href:"https://exemplo/quem", origin:"https://exemplo", pathname:"/quem" },
    history: { replaceState(){} },
    console, Math, JSON, Date, Promise, RegExp, Error, TypeError,
    Boolean, Number, String, Array, Object, isNaN, isFinite, parseInt, parseFloat,
    setTimeout, clearTimeout, setInterval: () => ({}), clearInterval(){},
    scrollTo(){}, addEventListener(){},
    CONTAS: require("./contas.js"),
    PONTOS: require("./pontuacao.js"),
    QSE_FIREBASE: F
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  compiled.runInContext(sandbox);
  return { dom, mem, sandbox, ui: sandbox.__ui };
}

let fails = 0;
const ok = (c, m) => { if (!c){ fails++; console.log("  FALHA: " + m); } };
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

(async function(){
  console.log("CONTA E AMIGOS — telas por cliques reais\n");

  const DB = makeDb();
  const F = makeFirebase(DB);
  const A = makeApp(DB, F);
  const g = id => A.dom.document.getElementById(id);
  const click = id => g(id)._fire("click");
  const tela = () => A.ui.telaVisivel();

  /* ---- 1. deslogado ---- */
  F._entrar(null);
  await settle();
  ok(!!A.ui.CONTA.api, "CONTAS foi ligado no db (o bug do namespace)");
  ok(g("go-conta").hidden === false, "botão de conta aparece quando há Firebase");
  ok(g("go-conta").textContent === "Entrar na minha conta",
     "botão convida a entrar, veio: " + g("go-conta").textContent);

  click("go-conta");
  ok(tela() === "s-conta", "abre a tela de conta, foi pra " + tela());
  ok(g("conta-login").hidden === false, "mostra o formulário de e-mail");
  ok(g("conta-perfil").hidden === true && g("conta-novo").hidden === true,
     "não mostra perfil nem cadastro estando deslogado");
  ok(g("conta-enviar").hidden === false && g("conta-amigos").hidden === true,
     "só o botão de mandar link está disponível");

  /* ---- 2. e-mail inválido não manda ---- */
  g("conta-email").value = "naoehemail";
  click("conta-enviar");
  await settle();
  ok(F._enviados.length === 0, "e-mail inválido não dispara link");
  ok(g("conta-err").textContent.length > 0, "e diz o que está errado");

  /* ---- 3. e-mail válido ---- */
  g("conta-email").value = "Ana@Exemplo.COM";
  click("conta-enviar");
  await settle();
  ok(F._enviados.length === 1 && F._enviados[0] === "ana@exemplo.com",
     "link enviado com o e-mail normalizado, veio: " + F._enviados[0]);
  ok(g("conta-enviado").hidden === false, "mostra a tela de 'olha seu e-mail'");
  ok(g("conta-enviado-txt").textContent.indexOf("ana@exemplo.com") >= 0,
     "e repete o endereço pra pessoa conferir");

  /* ---- 4. voltou do link: logado, sem perfil ---- */
  F._entrar({ uid: "uid-ana", email: "ana@exemplo.com" });
  await settle();
  ok(g("conta-novo").hidden === false, "logado sem perfil cai no cadastro de apelido");
  ok(g("conta-criar").hidden === false, "com o botão de criar conta");
  ok(g("go-conta").textContent === "Terminar meu cadastro",
     "e a home passa a cobrar o cadastro, veio: " + g("go-conta").textContent);

  /* ---- 5. apelido inválido ---- */
  g("conta-nick").value = "ab";
  click("conta-criar");
  await settle();
  ok(g("conta-novo-err").textContent.indexOf("3 a 16") >= 0,
     "apelido curto é recusado com explicação, veio: " + g("conta-novo-err").textContent);
  ok(!A.ui.CONTA.perfil, "e nenhum perfil é criado");

  /* ---- 6. cadastro válido ---- */
  g("conta-nick").value = "Ana";
  g("conta-nome").value = "Ana Souza";
  click("conta-criar");
  await settle();
  ok(!!A.ui.CONTA.perfil, "perfil criado");
  ok(A.ui.CONTA.perfil.nick === "Ana", "com o apelido digitado");
  ok(g("conta-perfil").hidden === false, "mostra a tela de perfil");
  ok(g("conta-amigos").hidden === false, "libera o botão de amigos");
  ok(g("conta-perfil-vazio").hidden === false, "avisa que ainda não jogou");
  ok(g("go-conta").textContent.indexOf("Ana") === 0,
     "home passa a mostrar o apelido, veio: " + g("go-conta").textContent);

  const dump = DB._dump();
  ok(dump["perfis/uid-ana"] !== undefined, "gravou o perfil público");
  ok(dump["usuarios/uid-ana"] !== undefined, "gravou o cadastro privado");
  ok(dump["perfis/uid-ana"].email === undefined, "o público NÃO carrega e-mail");
  ok(dump["nicks/ana"] && dump["nicks/ana"].uid === "uid-ana", "reservou o apelido");

  /* ---- 7. apelido já usado por outra pessoa ---- */
  const CONTAS = require("./contas.js");
  const outro = CONTAS.CriarContas(DB);
  await outro.criar("uid-bia", { nick: "Bia", nome: "", email: "bia@x.co" });

  click("conta-amigos");
  ok(tela() === "s-amigos", "abre a tela de amigos, foi pra " + tela());
  await settle();
  ok(g("amigos-rank-vazio").hidden === false, "ranking começa vazio");

  /* ---- 8. adicionar amigo ---- */
  click("aba-lista");
  await settle();
  ok(g("amigos-painel-lista").hidden === false, "aba Lista aparece");

  g("amigos-busca").value = "naoexiste";
  click("amigos-add");
  await settle();
  ok(g("amigos-err").textContent.indexOf("naoexiste") >= 0,
     "apelido inexistente diz qual não achou, veio: " + g("amigos-err").textContent);

  g("amigos-busca").value = "bia";
  click("amigos-add");
  await settle();
  const pedidos = await outro.pedidosRecebidos("uid-bia");
  ok(pedidos.length === 1 && pedidos[0].uid === "uid-ana",
     "pedido chegou pra Bia, veio: " + JSON.stringify(pedidos));
  ok(g("amigos-busca").value === "", "campo é limpo depois de enviar");

  /* ---- 9. ranking depois que viram amigos e jogam ---- */
  await outro.aceitar("uid-bia", "uid-ana");
  const ordem = [{ id:"uid-ana", chave:1 }, { id:"uid-bia", chave:2 }, { id:"uid-caio", chave:3 }];
  await A.ui.CONTA.api.registrarMinhaPartida("uid-ana", { pid:"p1", sala:"FESTA", ordem });
  await outro.registrarMinhaPartida("uid-bia", { pid:"p1", sala:"FESTA", ordem });

  click("aba-rank");
  await settle();
  ok(g("amigos-rank-vazio").hidden === true, "ranking deixa de estar vazio");
  const linhas = g("amigos-rank").children;
  ok(linhas.length === 2, "ranking mostra as 2 pessoas que jogaram, veio: " + linhas.length);

  /* ---- 10. sair da conta ---- */
  click("conta-sair");
  await settle();
  ok(A.ui.CONTA.ident === null, "sair limpa a identidade");
  ok(A.ui.CONTA.perfil === null, "e o perfil");
  ok(g("go-conta").textContent === "Entrar na minha conta", "home volta a convidar a entrar");

  console.log(fails ? "\n" + fails + " falha(s)" : "\ntelas de conta passaram");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
