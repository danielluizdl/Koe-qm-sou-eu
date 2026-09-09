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
      _t: "", _h: "", _a: {}, _on: {}, onclick: null, id: "", type: "",
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
        if (!byId.has(id)){
          const e = mkEl();
          e.id = id;
          /* o stub nao le atributos do HTML; estes campos nascem
             type="password" la, e o teste do olho depende disso */
          if (/senha/.test(id) && !/campo|olho|erro/.test(id)) e.type = "password";
          byId.set(id, e);
        }
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

/* ---------- QSE_FIREBASE de mentira, no contrato do boot ----------
   Reproduz o que o Firebase Auth faz de verdade: recusa e-mail repetido,
   recusa senha curta, recusa credencial errada. Sem isso o teste provaria
   só o caminho feliz. */
function makeFirebase(db){
  const ouvintes = [];
  const estado = { pronto:false, db, auth:{}, identidade:null, erro:null };
  const contas = new Map();          // email -> {uid, senha}
  let seq = 0;
  const authErr = code => { const e = new Error(code); e.code = code; return e; };

  const F = {
    _verificacoes: [], _resets: [],
    aoMudar(cb){ ouvintes.push(cb); if (estado.pronto) cb(estado); },
    estado: () => estado,

    criarConta(email, senha){
      email = String(email||"").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email)) return Promise.reject(authErr("auth/invalid-email"));
      if (String(senha||"").length < 6) return Promise.reject(authErr("auth/weak-password"));
      if (contas.has(email)) return Promise.reject(authErr("auth/email-already-in-use"));
      const uid = "uid-" + (++seq);
      contas.set(email, { uid, senha: String(senha) });
      F._verificacoes.push(email);
      F._entrar({ uid, email });
      return Promise.resolve({ uid, email });
    },

    entrar(email, senha){
      email = String(email||"").trim().toLowerCase();
      const c = contas.get(email);
      if (!c || c.senha !== String(senha)) return Promise.reject(authErr("auth/invalid-credential"));
      F._entrar({ uid: c.uid, email });
      return Promise.resolve({ uid: c.uid, email });
    },

    esqueciSenha(email){ F._resets.push(String(email||"").toLowerCase()); return Promise.resolve(); },
    sair(){ F._entrar(null); return Promise.resolve(); },

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
  console.log("CONTA E AMIGOS — cadastro tradicional, por cliques reais\n");

  const DB = makeDb();
  const F = makeFirebase(DB);
  const A = makeApp(DB, F);
  const g = id => A.dom.document.getElementById(id);
  const click = id => g(id)._fire("click");
  const blur = id => g(id)._fire("blur");
  const tela = () => A.ui.telaVisivel();
  const preencher = (id, v) => { g(id).value = v; };

  F._entrar(null);
  await settle();

  /* ===== 1. login obrigatório ===== */
  ok(!!A.ui.CONTA.api, "CONTAS ligado no db");
  click("go-create");
  await settle();
  ok(tela() === "s-conta", "criar jogo sem conta cai na tela de conta, foi pra " + tela());
  click("go-join");
  await settle();
  ok(tela() === "s-conta", "entrar com código sem conta também, foi pra " + tela());
  ok(g("conta-login").hidden === false, "abre no modo Entrar");
  ok(g("login-ok").hidden === false && g("cad-ok").hidden === true, "só o botão Entrar");
  ok(g("conta-trocar").textContent === "Criar uma conta", "oferece criar conta");

  /* ===== 2. alternar entre entrar e cadastrar ===== */
  click("conta-trocar");
  ok(g("conta-cadastro").hidden === false && g("conta-login").hidden === true, "vai pro cadastro");
  ok(g("cad-ok").hidden === false && g("login-ok").hidden === true, "botão vira Criar conta");
  ok(g("conta-trocar").textContent === "Já tenho conta", "e oferece voltar pro login");

  /* ===== 3. todos os campos são obrigatórios ===== */
  click("cad-ok");
  await settle();
  ok(g("cad-nome-erro").textContent.length > 0, "nome vazio reclama");
  ok(g("cad-nick-erro").textContent.length > 0, "apelido vazio reclama");
  ok(g("cad-email-erro").textContent.length > 0, "e-mail vazio reclama");
  ok(g("cad-senha-erro").textContent.length > 0, "senha vazia reclama");
  ok(g("cad-senha2-erro").textContent.length > 0, "confirmação vazia reclama");
  ok(A.ui.CONTA.perfil === null, "e nada é criado");

  /* ===== 4. cada regra, uma a uma ===== */
  preencher("cad-nome", "Ana");
  blur("cad-nome");
  ok(g("cad-nome-erro").textContent.indexOf("sobrenome") >= 0,
     "um nome só exige sobrenome, veio: " + g("cad-nome-erro").textContent);
  preencher("cad-nome", "Ana Souza");
  blur("cad-nome");
  ok(g("cad-nome-erro").textContent === "", "nome e sobrenome passa");

  preencher("cad-nick", "a");
  blur("cad-nick");
  ok(g("cad-nick-erro").textContent.length > 0, "apelido de 1 letra é recusado");
  preencher("cad-nick", "an");
  blur("cad-nick");
  ok(g("cad-nick-erro").textContent === "", "apelido de 2 letras passa");

  preencher("cad-email", "semarroba.com");
  blur("cad-email");
  ok(g("cad-email-erro").textContent.indexOf("@") >= 0,
     "e-mail sem arroba explica o que falta, veio: " + g("cad-email-erro").textContent);
  preencher("cad-email", "ana@exemplo");
  blur("cad-email");
  ok(g("cad-email-erro").textContent.length > 0, "e-mail sem domínio completo é recusado");
  preencher("cad-email", "ana@exemplo.com");
  blur("cad-email");
  ok(g("cad-email-erro").textContent === "", "e-mail completo passa");

  preencher("cad-senha", "12345");
  blur("cad-senha");
  ok(g("cad-senha-erro").textContent.indexOf("6") >= 0, "senha de 5 é recusada");
  preencher("cad-senha", "abcdef");
  blur("cad-senha");
  ok(g("cad-senha-erro").textContent.length > 0, "senha com letras é recusada");
  preencher("cad-senha", "123456");
  blur("cad-senha");
  ok(g("cad-senha-erro").textContent === "", "6 números passa");

  preencher("cad-senha2", "654321");
  blur("cad-senha2");
  ok(g("cad-senha2-erro").textContent.indexOf("diferentes") >= 0,
     "confirmação diferente avisa, veio: " + g("cad-senha2-erro").textContent);
  preencher("cad-senha2", "123456");
  blur("cad-senha2");
  ok(g("cad-senha2-erro").textContent === "", "confirmação igual passa");

  /* ===== 5. o olho da senha ===== */
  ok(g("cad-senha").type === "password", "senha começa escondida");
  click("cad-olho");
  ok(g("cad-senha").type === "text", "olho revela a senha");
  ok(g("cad-olho").getAttribute("aria-pressed") === "true", "e o botão marca que está revelando");
  click("cad-olho");
  ok(g("cad-senha").type === "password", "olho esconde de novo");
  click("cad-olho2");
  ok(g("cad-senha2").type === "text", "o olho da confirmação é independente");
  ok(g("cad-senha").type === "password", "e não mexe no campo de cima");
  click("cad-olho2");

  /* ===== 6. criar a conta ===== */
  click("cad-ok");
  await settle();
  ok(!!A.ui.CONTA.perfil, "conta criada");
  ok(A.ui.CONTA.perfil.nick === "an", "com o apelido digitado");
  ok(A.ui.CONTA.perfil.nome === "Ana Souza", "e o nome completo");
  ok(F._verificacoes.length === 1, "e-mail de confirmação disparado");
  ok(g("conta-perfil").hidden === false, "mostra o perfil");

  const dump = DB._dump();
  ok(dump["perfis/uid-1"] && dump["perfis/uid-1"].email === undefined,
     "o perfil público não carrega e-mail");
  ok(dump["usuarios/uid-1"] && dump["usuarios/uid-1"].email === "ana@exemplo.com",
     "o e-mail fica no documento privado");
  ok(dump["nicks/an"] && dump["nicks/an"].uid === "uid-1", "apelido reservado");

  /* ===== 7. a intenção guardada é retomada ===== */
  ok(tela() === "s-create" || tela() === "s-nick" || tela() === "s-entrar",
     "depois de criar a conta, volta pro que a pessoa queria fazer, foi pra " + tela());

  /* ===== 8. apelido repetido ===== */
  click("conta-sair");
  await settle();
  ok(A.ui.CONTA.ident === null, "saiu da conta");
  click("go-conta");
  click("conta-trocar");
  preencher("cad-nome", "Bia Lima");
  preencher("cad-nick", "AN");                 // mesma chave do "an"
  preencher("cad-email", "bia@exemplo.com");
  preencher("cad-senha", "111111");
  preencher("cad-senha2", "111111");
  click("cad-ok");
  await settle();
  ok(g("cad-nick-erro").textContent.indexOf("já está sendo usado") >= 0,
     "apelido repetido avisa que já existe, veio: " + g("cad-nick-erro").textContent);

  preencher("cad-nick", "bia");
  click("cad-ok");
  await settle();
  ok(A.ui.CONTA.perfil && A.ui.CONTA.perfil.nick === "bia", "com outro apelido, cria");

  /* ===== 9. e-mail já cadastrado ===== */
  click("conta-sair");
  await settle();
  click("go-conta");
  click("conta-trocar");
  preencher("cad-nome", "Caio Dias");
  preencher("cad-nick", "caio");
  preencher("cad-email", "ana@exemplo.com");   // já usado
  preencher("cad-senha", "222222");
  preencher("cad-senha2", "222222");
  click("cad-ok");
  await settle();
  ok(g("cad-err").textContent.indexOf("já tem conta") >= 0,
     "e-mail repetido avisa, veio: " + g("cad-err").textContent);

  /* ===== 10. entrar com conta existente ===== */
  click("conta-trocar");
  preencher("login-email", "ana@exemplo.com");
  preencher("login-senha", "999999");
  click("login-ok");
  await settle();
  ok(g("login-err").textContent.indexOf("não conferem") >= 0,
     "senha errada avisa sem dizer qual campo falhou, veio: " + g("login-err").textContent);

  preencher("login-senha", "123456");
  click("login-ok");
  await settle();
  ok(A.ui.CONTA.perfil && A.ui.CONTA.perfil.nick === "an", "senha certa entra e traz o perfil");
  ok(g("conta-perfil-nome").textContent === "Ana Souza", "perfil mostra o nome completo");

  /* ===== 11. com conta, as portas abrem ===== */
  click("go-create");
  await settle();
  ok(tela() !== "s-conta", "com conta, criar jogo não cai mais na tela de conta");

  /* ===== 12. esqueci a senha ===== */
  click("go-conta");
  click("conta-sair");
  await settle();
  preencher("login-email", "ana@exemplo.com");
  click("login-esqueci");
  await settle();
  ok(F._resets.length === 1 && F._resets[0] === "ana@exemplo.com",
     "esqueci a senha dispara o reset");

  /* ===== 13. amigos e ranking ===== */
  preencher("login-email", "ana@exemplo.com");
  preencher("login-senha", "123456");
  click("login-ok");
  await settle();
  click("conta-amigos");
  await settle();
  ok(tela() === "s-amigos", "abre amigos, foi pra " + tela());
  click("aba-lista");
  await settle();
  preencher("amigos-busca", "bia");
  click("amigos-add");
  await settle();

  const CONTAS = require("./contas.js");
  const outro = CONTAS.CriarContas(DB);
  const pedidos = await outro.pedidosRecebidos("uid-2");
  ok(pedidos.length === 1 && pedidos[0].uid === "uid-1", "pedido chegou pra Bia");
  await outro.aceitar("uid-2", "uid-1");

  const ordem = [{ id:"uid-1", chave:1 }, { id:"uid-2", chave:2 }, { id:"x", chave:3 }];
  await A.ui.CONTA.api.registrarMinhaPartida("uid-1", { pid:"p1", ordem });
  await outro.registrarMinhaPartida("uid-2", { pid:"p1", ordem });
  click("aba-rank");
  await settle();
  ok(g("amigos-rank").children.length === 2, "ranking com as 2 pessoas que jogaram, veio: " +
     g("amigos-rank").children.length);

  console.log(fails ? "\n" + fails + " falha(s)" : "\ntelas de conta passaram");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });