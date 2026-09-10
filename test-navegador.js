/* A página num navegador DE VERDADE, com CSS aplicado.

   O suite de cliques usa um DOM simulado em JavaScript, que enxerga a
   propriedade `hidden` mas não enxerga folha de estilo. Foi por isso
   que ele passou verde enquanto, no celular, quatro botões apareciam
   na home e as telas de entrar e cadastrar se empilhavam: `.btn` e
   `.mid` declaram `display`, e regra do autor vence a do navegador.

   Aqui a pergunta é outra: o que a pessoa REALMENTE vê. Usa o Chrome
   já instalado (puppeteer-core, sem baixar navegador) e mede
   visibilidade de verdade — offsetParent e getComputedStyle.

   O Firebase é substituído por um dublê injetado antes de tudo, então
   o teste não toca a rede nem o projeto real.

   node test-navegador.js */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROMES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
];
const exe = CHROMES.find(p => fs.existsSync(p));

let ok = 0; const falhas = [];
function t(nome, cond, extra){
  if (cond){ ok++; }
  else falhas.push(nome + (extra ? " — " + extra : ""));
}

/* Substitui o Firebase por um dublê, ANTES de qualquer script da página.
   O db é um Firestore em memória no contrato da capability. */
const DUBLE = `
(function(){
  var store = {}, leases = {};
  function clone(x){ return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function merge(t, p){
    for (var k in p){ if (!p.hasOwnProperty(k)) continue;
      var v = p[k];
      if (v && typeof v === "object" && !Array.isArray(v) &&
          t[k] && typeof t[k] === "object" && !Array.isArray(t[k])) merge(t[k], v);
      else t[k] = clone(v);
    }
  }
  function snap(p){ var d = store[p];
    return { id: p.split("/").pop(), exists: d !== undefined, data: function(){ return clone(d); } }; }
  function filhos(c){
    var pre = c + "/", n = c.split("/").length + 1, out = [];
    for (var k in store) if (k.indexOf(pre) === 0 && k.split("/").length === n) out.push(k);
    return out.sort();
  }
  function dref(p){
    return {
      id: p.split("/").pop(), path: p,
      get: function(){ return Promise.resolve(snap(p)); },
      set: function(d){ store[p] = clone(d); return Promise.resolve(); },
      update: function(d){
        if (!(p in store)){ var e = new Error("nao existe"); e.code = "invalid_argument"; return Promise.reject(e); }
        merge(store[p], d); return Promise.resolve();
      },
      "delete": function(){ delete store[p]; return Promise.resolve(); },
      acquire: function(o){
        var now = Date.now(), cur = leases[p];
        if (cur && cur.expiresAt > now && cur.holder !== o.holder) return Promise.resolve({ acquired:false });
        leases[p] = { holder:o.holder, expiresAt: now + (o.ttlMs || 30000) };
        return Promise.resolve({ acquired:true, holder:o.holder });
      },
      onSnapshot: function(){ return function(){}; },
      collection: function(sub){ return cref(p + "/" + sub); }
    };
  }
  function cref(p){
    return { path: p, doc: function(id){ return dref(p + "/" + id); },
      get: function(){ return Promise.resolve({ docs: filhos(p).map(snap) }); },
      onSnapshot: function(){ return function(){}; } };
  }
  var db = { doc: dref, collection: cref };

  var ouvintes = [], estado = { pronto:false, db: db, auth:{}, identidade:null, erro:null };
  var contas = {}, seq = 0;
  function err(c){ var e = new Error(c); e.code = c; return e; }
  function emitir(){ for (var i=0;i<ouvintes.length;i++){ try{ ouvintes[i](estado); }catch(e){} } }

  window.__DB = store;
  window.QSE_FIREBASE = {
    aoMudar: function(cb){ ouvintes.push(cb); if (estado.pronto) cb(estado); },
    estado: function(){ return estado; },
    criarConta: function(email, senha){
      email = String(email||"").trim().toLowerCase();
      window.__chamadas = (window.__chamadas||[]); window.__chamadas.push("criarConta:"+email);
      if (contas[email]) return Promise.reject(err("auth/email-already-in-use"));
      if (String(senha||"").length < 6) return Promise.reject(err("auth/weak-password"));
      var uid = "uid-" + (++seq);
      contas[email] = { uid: uid, senha: String(senha) };
      estado.identidade = { uid: uid, email: email }; estado.pronto = true; emitir();
      return Promise.resolve({ uid: uid, email: email });
    },
    entrar: function(email, senha){
      email = String(email||"").trim().toLowerCase();
      var c = contas[email];
      if (!c || c.senha !== String(senha)) return Promise.reject(err("auth/invalid-credential"));
      estado.identidade = { uid: c.uid, email: email }; estado.pronto = true; emitir();
      return Promise.resolve({ uid: c.uid, email: email });
    },
    esqueciSenha: function(){ return Promise.resolve(); },
    sair: function(){ estado.identidade = null; emitir(); return Promise.resolve(); }
  };
  setTimeout(function(){ estado.pronto = true; emitir(); }, 0);
})();
`;

(async function(){
  if (!exe){ console.log("nenhum Chrome/Edge encontrado"); process.exit(1); }
  console.log("NAVEGADOR DE VERDADE — " + path.basename(exe) + "\n");

  const browser = await puppeteer.launch({
    executablePath: exe, headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage();
  const _erros=[];
  page.on("pageerror", e=>_erros.push("PAGEERROR: "+e.message));
  page.on("console", m=>{ if(m.type()==="error" && !/manifest|ERR_FAILED|CORS/.test(m.text())) _erros.push("CONSOLE: "+m.text()); });
  global.__erros=_erros;
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(DUBLE);

  /* index-teste.html é a mesma página SEM o firebase-boot.js. Sem isso o
     boot roda, sobrescreve window.QSE_FIREBASE com o de verdade e o teste
     acaba criando conta no projeto real. Gere com: SEM_BOOT=1 node build.js */
  const arquivo = "file:///" +
    path.join(__dirname, "public", "index-teste.html").split(path.sep).join("/");
  if (!fs.existsSync(path.join(__dirname, "public", "index-teste.html"))){
    console.log("falta public/index-teste.html — rode: SEM_BOOT=1 node build.js");
    process.exit(1);
  }
  await page.goto(arquivo, { waitUntil: "load" });
  await new Promise(r => setTimeout(r, 600));

  /* visível de verdade: ocupa espaço e não está display:none */
  const visivel = id => page.evaluate(i => {
    const e = document.getElementById(i);
    if (!e) return null;
    const s = getComputedStyle(e);
    return !!(e.offsetParent !== null && s.display !== "none" && s.visibility !== "hidden");
  }, id);
  const texto  = id => page.evaluate(i => (document.getElementById(i) || {}).textContent || "", id);
  const clicar = async id => { await page.evaluate(i => document.getElementById(i).click(), id);
                               await new Promise(r => setTimeout(r, 120)); };
  const digitar = (id, v) => page.evaluate((i, val) => {
    const e = document.getElementById(i); e.value = val;
    e.dispatchEvent(new Event("input", { bubbles:true }));
    e.dispatchEvent(new Event("blur", { bubbles:true }));
  }, id, v);
  const telaVisivel = () => page.evaluate(() => {
    const t = [...document.querySelectorAll(".screen")].find(s => s.classList.contains("on"));
    return t ? t.id : null;
  });

  if (global.__erros.length){ console.log("ERROS NA CARGA:"); global.__erros.forEach(e=>console.log("  "+e)); }
  /* ===== 1. home deslogada ===== */
  t("home é a tela inicial", (await telaVisivel()) === "s-home", String(await telaVisivel()));
  t("VISÍVEL: Entrar", (await visivel("go-entrar")) === true);
  t("VISÍVEL: Criar conta", (await visivel("go-criar-conta")) === true);
  t("ESCONDIDO de verdade: Criar jogo", (await visivel("go-create")) === false,
    "era o bug do CSS");
  t("ESCONDIDO de verdade: Entrar com código", (await visivel("go-join")) === false);
  t("ESCONDIDO de verdade: pra galera de fora", (await visivel("go-mesa")) === false);
  t("ESCONDIDO de verdade: atalho do perfil", (await visivel("go-conta")) === false);

  const lede = await page.evaluate(() => document.querySelector("#s-home .lede").textContent);
  t("frase nova na home", /zoa a tua cara/.test(lede), lede);

  /* ===== 2. telas separadas de verdade ===== */
  await clicar("go-criar-conta");
  t("Criar conta abre s-cadastro", (await telaVisivel()) === "s-cadastro", String(await telaVisivel()));
  t("no cadastro, o campo de e-mail do LOGIN não aparece",
    (await visivel("login-identificador")) === false);
  t("no cadastro, os 5 campos aparecem",
    (await visivel("cad-nome")) && (await visivel("cad-nick")) && (await visivel("cad-email")) &&
    (await visivel("cad-senha")) && (await visivel("cad-senha2")));

  await clicar("ir-login");
  t("'Já tenho conta' abre s-login", (await telaVisivel()) === "s-login", String(await telaVisivel()));
  t("no login, só e-mail e senha",
    (await visivel("login-identificador")) && (await visivel("login-senha")));
  t("no login, nenhum campo de cadastro aparece",
    (await visivel("cad-nome")) === false && (await visivel("cad-nick")) === false &&
    (await visivel("cad-senha2")) === false);

  /* ===== 3. o olho funciona no navegador ===== */
  await clicar("ir-cadastro");
  const tipo = id => page.evaluate(i => document.getElementById(i).type, id);
  t("senha começa mascarada", (await tipo("cad-senha")) === "password");
  await clicar("cad-olho");
  t("olho revela", (await tipo("cad-senha")) === "text");
  t("e não mexe na confirmação", (await tipo("cad-senha2")) === "password");
  await clicar("cad-olho");
  t("olho esconde de novo", (await tipo("cad-senha")) === "password");

  /* ===== 4. validação visível ===== */
  await clicar("cad-ok");
  t("campos vazios mostram erro na tela",
    (await texto("cad-nome-erro")).length > 0 && (await texto("cad-senha2-erro")).length > 0);
  t("erro do nome está VISÍVEL", (await visivel("cad-nome-erro")) === true);

  await digitar("cad-nome", "Teste Testando");
  await digitar("cad-nick", "teste");
  await digitar("cad-email", "teste@exemplo.com");
  await digitar("cad-senha", "134312");
  await digitar("cad-senha2", "134311");
  t("senha diferente avisa", /diferentes/.test(await texto("cad-senha2-erro")),
    await texto("cad-senha2-erro"));
  await digitar("cad-senha2", "134312");
  t("senha igual limpa o aviso", (await texto("cad-senha2-erro")) === "");

  /* ===== 5. criar a conta ===== */
  await clicar("cad-ok");
  await new Promise(r => setTimeout(r, 800));
  const diag2 = {
    err: await texto("cad-err"),
    nick: await texto("cad-nick-erro"),
    nome: await texto("cad-nome-erro"),
    email: await texto("cad-email-erro"),
    senha: await texto("cad-senha-erro"),
    senha2: await texto("cad-senha2-erro"),
    js: global.__erros.slice(),
    chamadas: await page.evaluate(() => window.__chamadas || []),
    contas: await page.evaluate(() => Object.keys(window.__DB || {}))
  };
  if (diag2.err || diag2.nick || diag2.js.length)
    console.log("DIAG apos criar:", JSON.stringify(diag2));
  t("saiu do cadastro depois de criar", (await telaVisivel()) !== "s-cadastro",
    String(await telaVisivel()));
  const dump = await page.evaluate(() => JSON.stringify(Object.keys(window.__DB)));
  t("gravou perfil, cadastro e apelido",
    /perfis\/uid-1/.test(dump) && /usuarios\/uid-1/.test(dump) && /nicks\/teste/.test(dump), dump);

  /* ===== 6. home logada ===== */
  await page.evaluate(() => document.querySelector('[data-back="s-home"], #conta-back') &&
                            document.querySelector('#s-conta [data-back]').click());
  await new Promise(r => setTimeout(r, 200));
  /* logado, a capa dá lugar ao painel */
  t("ESCONDIDA agora: a capa", (await visivel("home-capa")) === false);
  t("VISÍVEL agora: o painel", (await visivel("home-painel")) === true);
  t("ESCONDIDO agora: Entrar", (await visivel("go-entrar")) === false);
  t("ESCONDIDO agora: Criar conta", (await visivel("go-criar-conta")) === false);
  t("ESCONDIDOS: os botões antigos do rodapé",
    (await visivel("go-create")) === false && (await visivel("go-join")) === false);

  t("cumprimenta pelo apelido", /teste/.test(await texto("home-ola")), await texto("home-ola"));
  t("VISÍVEL: o avatar", (await visivel("home-avatar")) === true);
  t("avatar mostra a inicial", (await texto("home-avatar")) === "T", await texto("home-avatar"));

  /* os quatro ambientes */
  for (const id of ["amb-criar", "amb-entrar", "amb-salas", "amb-pontos"]){
    t("VISÍVEL: " + id, (await visivel(id)) === true);
  }
  t("subtítulo de salas traz número real",
    /nenhuma|sala/.test(await texto("amb-salas-sub")), await texto("amb-salas-sub"));
  t("subtítulo de pontuação traz número real",
    /sem partidas|saldo/.test(await texto("amb-pontos-sub")), await texto("amb-pontos-sub"));

  /* navegação entre os ambientes */
  await clicar("amb-salas");
  t("Minhas salas abre", (await telaVisivel()) === "s-salas", String(await telaVisivel()));
  t("avatar continua visível na tela de salas", (await visivel("salas-avatar")) === true);
  await page.evaluate(() => document.querySelector('#s-salas [data-back]').click());
  await new Promise(r => setTimeout(r, 150));

  await clicar("amb-pontos");
  t("Pontuação abre", (await telaVisivel()) === "s-pontuacao", String(await telaVisivel()));
  t("explica o saldo em uma linha",
    /ganhar de 7/.test(await texto("pontos-explica")) ||
    (await visivel("pontos-vazio")) === true);
  await page.evaluate(() => document.querySelector('#s-pontuacao [data-back]').click());
  await new Promise(r => setTimeout(r, 150));

  /* o ID, que é como se convida */
  await clicar("home-avatar");
  t("avatar abre o perfil", (await telaVisivel()) === "s-conta", String(await telaVisivel()));
  t("VISÍVEL: a caixa do ID", (await visivel("conta-idbox")) === true);
  t("o ID vem com # e 5 números",
    /^#[0-9]{5}$/.test(await texto("conta-id")), await texto("conta-id"));
  t("VISÍVEL: convidar alguém", (await visivel("conta-convidar")) === true);
  await page.evaluate(() => document.querySelector('#s-conta [data-back]').click());
  await new Promise(r => setTimeout(r, 150));

  /* ===== 7. nada vaza fora da tela ===== */
  const larguraOk = await page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth + 1);
  t("página não rola pro lado", larguraOk);

  /* ===== 8. um erro de JS no console reprova ===== */
  const erros = [];
  page.on("pageerror", e => erros.push(e.message));
  await clicar("amb-criar");
  await new Promise(r => setTimeout(r, 200));
  t("criar jogo abre sem erro de JS", erros.length === 0, erros.join(" | "));
  t("quem tem conta NÃO é perguntado o apelido de novo",
     (await telaVisivel()) !== "s-nick", String(await telaVisivel()));
  t("vai direto pra montar a sala",
     (await telaVisivel()) === "s-create", String(await telaVisivel()));

  await page.screenshot({ path: "home-deslogada.png" }).catch(() => {});
  await browser.close();

  console.log("navegador · " + ok + " passaram, " + falhas.length + " falharam");
  if (falhas.length){ falhas.forEach(f => console.log("  x " + f)); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
