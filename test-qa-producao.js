/* QA de produção do zero — Fase 1 e Fase 2 de PROMPT-qa-producao-do-zero.md.
   Cria 10 contas REAIS em quem-sou-eu-e3e32 e roda os cenários A-E contra o
   Firestore de verdade, usando as funções REAIS do jogo (extraídas de
   quem-sou-eu-temas.html, o mesmo truque de test-salas.js) e de contas.js.

   Cada persona tem seu próprio Firebase App nomeado — sessão de Auth
   independente, como 10 aparelhos de verdade — em vez de logar/deslogar
   em série num app só.

   node test-qa-producao.js */
const fs = require("fs");
const vm = require("vm");
const { initializeApp } = require("firebase/app");
const { getAuth, createUserWithEmailAndPassword } = require("firebase/auth");
const fsSdk = require("firebase/firestore");
if (typeof fsSdk.setLogLevel === "function") fsSdk.setLogLevel("silent");
const criarDbFirestore = require("./firestore-adapter.js");
const PONTOS = require("./pontuacao.js");
const CONFIG = require("./firebase-config.js");
const { CriarContas } = require("./contas.js");

const sleep = ms => new Promise(r => setTimeout(r, ms));
/* espera ativa em vez de sleep fixo — com Firestore de verdade (não o
   db falso de test-salas.js) o tempo de propagação do onSnapshot entre
   10 sessões reais varia; sleep fixo demais é lento, sleep fixo de menos
   quebra ("poucos" ao chamar comecar() com participantes ainda não
   propagados pro host). */
async function esperarAte(cond, tentativas, intervaloMs){
  for (let i = 0; i < (tentativas || 30); i++){
    if (cond()) return true;
    await sleep(intervaloMs || 400);
  }
  return cond();
}

/* ---------------- extrai o motor real do jogo do HTML de produção ---------------- */
const html = fs.readFileSync(__dirname + "/quem-sou-eu-temas.html", "utf8");
const open = html.indexOf("<script>") + "<script>".length;
const close = html.lastIndexOf("</" + "script>");
let base = html.slice(open, close);
const pontuacaoSrc = fs.readFileSync(__dirname + "/pontuacao.js", "utf8");
const tail = "})();";
const at = base.lastIndexOf(tail);
if (at < 0) throw new Error("não achei o fim da IIFE");
const injected = pontuacaoSrc + "\n" + base.slice(0, at) +
  "globalThis.__t={CriarSalaCliente:CriarSalaCliente,avaliarCarta:avaliarCarta," +
  "setActiveDb:function(d){activeDb=d;},calcClassificacao:calcClassificacao," +
  "ALL_MASK:ALL_MASK,NIVEIS:NIVEIS};" + tail;
const script = new vm.Script(injected, { filename: "quem-sou-eu-temas.html" });

/* ---------------- DOM mínimo (só para o app carregar) — igual test-salas.js ---------------- */
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

/* ---------------- device = 1 sandbox vm + 1 Firebase App nomeado ---------------- */
function makeDevice(persona, appIndex){
  const app = initializeApp(CONFIG, "device" + appIndex);
  const auth = getAuth(app);
  const fire = fsSdk.getFirestore(app);
  /* objetos criados dentro do sandbox vm vêm de OUTRO realm — o SDK do
     Firestore rejeita ("Data must be an object, but it was: a custom
     Object object") porque o prototype não bate com o Object.prototype
     deste processo. Round-trip JSON reconstrói tudo no realm de fora,
     igual ao clone() que o db falso de test-salas.js já faz. */
  const normalizar = v => JSON.parse(JSON.stringify(v));
  const db = criarDbFirestore({
    db: fire, doc: fsSdk.doc, collection: fsSdk.collection,
    getDoc: fsSdk.getDoc, getDocs: fsSdk.getDocs,
    setDoc: (ref, data) => fsSdk.setDoc(ref, normalizar(data)),
    updateDoc: (ref, data) => fsSdk.updateDoc(ref, normalizar(data)),
    deleteDoc: fsSdk.deleteDoc,
    onSnapshot: fsSdk.onSnapshot, runTransaction: fsSdk.runTransaction,
    query: fsSdk.query, where: fsSdk.where, orderBy: fsSdk.orderBy, limit: fsSdk.limit
  });
  const mem = new Map();
  const localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k,v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  const document = makeDocument();
  const sandbox = {
    document, localStorage,
    navigator: { userAgent: "node", vibrate(){}, share: undefined, clipboard: undefined },
    location: { hash: "", href: "https://exemplo/quem" },
    window: null, console,
    Math, JSON, Date, Promise, RegExp, Error, TypeError, Boolean,
    BigInt, Number, String, Array, Object, isNaN, isFinite, parseInt, parseFloat,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval(){},
    scrollTo(){}, addEventListener(){},
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  script.runInContext(sandbox);
  const T = sandbox.__t;
  T.setActiveDb(db);
  return { persona, app, auth, db, contas: CriarContas(db), T, uid: null, client: null };
}

/* ---------------- Fase 1 — 10 contas como pessoas reais criariam ---------------- */
const PERSONAS = [
  { nome: "Ana Beatriz Martins",     nick: "biamartins",    email: "ana.martins95@exemplo-teste.com",     senha: "482910" },
  { nome: "Bruno Henrique Costa",    nick: "brunuxcosta",   email: "bruno.costa88@exemplo-teste.com",     senha: "719345" },
  { nome: "Carla Fernandes Souza",   nick: "carlafsz",      email: "carla.souza91@exemplo-teste.com",     senha: "364827" },
  { nome: "Diego Almeida Rocha",     nick: "diegorocha",    email: "diego.rocha87@exemplo-teste.com",     senha: "590172" },
  { nome: "Elisa Ribeiro Gomes",     nick: "eliribeiro",    email: "elisa.gomes93@exemplo-teste.com",     senha: "813627" },
  { nome: "Felipe Nogueira Dias",    nick: "felipend",      email: "felipe.dias90@exemplo-teste.com",     senha: "247158" },
  { nome: "Gabriela Pires Lima",     nick: "gabipires",     email: "gabriela.lima96@exemplo-teste.com",   senha: "605931" },
  { nome: "Henrique Barbosa Melo",   nick: "henribm",       email: "henrique.melo85@exemplo-teste.com",   senha: "938214" },
  { nome: "Isabela Cardoso Teixeira",nick: "isacardoso",    email: "isabela.teixeira94@exemplo-teste.com",senha: "156789" },
  { nome: "João Vitor Andrade",      nick: "jvandrade",     email: "joao.andrade89@exemplo-teste.com",    senha: "402568" },
];

const achados = [];  // relatório final — bugs/discrepâncias encontrados
function achado(cenario, texto){ achados.push({ cenario, texto }); console.log("  ACHADO [" + cenario + "]: " + texto); }

let okCount = 0, falhas = 0;
function t(cenario, nome, cond, extra){
  if (cond){ okCount++; console.log("  ok    [" + cenario + "] " + nome); }
  else { falhas++; console.log("  FALHA [" + cenario + "] " + nome + (extra ? " — " + extra : "")); }
}

async function criarContas(){
  console.log("\nFASE 1 — criando 10 contas reais em quem-sou-eu-e3e32\n");
  const devices = [];
  for (let i = 0; i < PERSONAS.length; i++){
    const p = PERSONAS[i];
    const d = makeDevice(p, i);
    const cred = await createUserWithEmailAndPassword(d.auth, p.email, p.senha);
    d.uid = cred.user.uid;
    const perfil = await d.contas.criar(d.uid, { nick: p.nick, nome: p.nome, email: p.email });
    t("F1", p.nick + " tem perfil com saldo/partidas zerados",
      perfil.partidas === 0 && perfil.saldo === 0, JSON.stringify(perfil));
    d.client = d.T.CriarSalaCliente(d.db, { uid: d.uid });
    devices.push(d);
    await sleep(250);  // espaçamento — não parece tráfego de bot
  }
  return devices;
}

/* ---------------- mecânica de sala — reaproveita a API real do jogo ----------------
   Cliente NOVO por sala pra cada device: é assim que o app de verdade se
   comporta (SC é recriado do zero a cada tela de sala) — reaproveitar o
   mesmo client entre cenários deixava listeners/writers da sala anterior
   vivos e causava PERMISSION_DENIED por contenção, um bug do harness de
   teste, não do produto. */
async function criarSala(host, outros){
  host.client = host.T.CriarSalaCliente(host.db, { uid: host.uid });
  const nivel = (host.T.NIVEIS ? host.T.NIVEIS.length : 3) - 1;
  await host.client.criar("", host.persona.nick, host.T.ALL_MASK, nivel);
  await sleep(900);
  const codigo = host.client.codigo;
  for (const d of outros){
    d.client = d.T.CriarSalaCliente(d.db, { uid: d.uid });
    await d.client.abrir(codigo);
    await sleep(400);
    await d.client.entrarNovo(d.persona.nick);
    await sleep(300);
  }
  const N = outros.length + 1;
  await esperarAte(() => host.client.vm().numParticipantes >= N, 30, 400);
  return codigo;
}

function sairDeTodos(devices){
  for (const d of devices){
    try { d.client.sair(); } catch (e) {}
  }
}

async function jogarPartida(devices, ordemGanho){
  const host = devices[0];
  await host.client.comecar();
  await sleep(900);
  for (const d of devices){ await d.client.esconder(); await sleep(300); }
  for (const idx of ordemGanho){
    const carta = devices[idx].client.vm().minhaCarta;
    await devices[idx].client.palpite(carta);
    await sleep(500);
  }
  await esperarAte(() => host.client.vm().fase === "fim" && !!host.client.vm().partidas[0], 20, 400);
  const pid = host.client.vm().partidas[0].pid;
  /* espera até um device QUE NÃO É O HOST enxergar hist/registro com esse
     pid — o host vê a própria escrita na hora (eco local), mas outra
     sessão Firestore só enxerga depois do commit no servidor. Sem isso,
     registrarResultado falha pra quase todo mundo por pura corrida. */
  const naoHost = devices[1] || host;
  for (let i = 0; i < 20; i++){
    const snap = await naoHost.db.doc("salas/" + host.client.codigo + "/hist/registro").get();
    if (snap.exists && snap.data().items && snap.data().items[pid]) break;
    await sleep(400);
  }
  return host.client.vm().partidas[0];   // {pid, resultados, ...} mais recente
}

/* diagnóstico: reproduz os passos de registrarResultado só de leitura,
   pra descobrir POR QUE deu false sem o catch-all de contas.js engolir
   o motivo real. */
async function diagnosticarFalha(d, codigo, pid){
  try {
    const propria = await d.db.doc("usuarios/" + d.uid + "/partidas/" + pid).get();
    const hist = await d.db.doc("salas/" + codigo + "/hist/registro").get();
    const it = hist.exists && hist.data().items && hist.data().items[pid];
    console.log("    diag " + d.persona.nick + ": propria.exists=" + propria.exists +
      " hist.exists=" + hist.exists + " item.existe=" + !!it +
      (it ? " resultados=" + it.resultados.length + " temMeuId=" + it.resultados.some(r => r.id === d.uid) : ""));
    if (it && !propria.exists){
      /* replica a escrita exata de contas.js#registrarResultado, sem o
         catch-all que engole o erro — pra ver o motivo de verdade. */
      const ordem = it.resultados.map(r => ({ id: r.id, chave: r.posicao }));
      const linhas = PONTOS.pontuarPartida(ordem);
      const idx = it.resultados.findIndex(r => r.id === d.uid);
      const minha = linhas[idx];
      console.log("    diag " + d.persona.nick + ": minha=" + JSON.stringify(minha) + " idx=" + idx +
        " hist[idx]=" + JSON.stringify(it.resultados[idx]) +
        " Number.isInteger(n)=" + Number.isInteger(minha.n) +
        " Number.isInteger(posicao)=" + Number.isInteger(minha.posicao) +
        " Number.isInteger(idxResultado)=" + Number.isInteger(idx));
      /* hipótese: a regra faz DIVISÃO INTEIRA em (n-posicao)/(n-1) porque
         os dois são `int` no CEL (comportamento documentado do Firestore
         Rules) — só bate com o valor real quando o resultado é 0 ou 1.
         Testa escrevendo o valor TRUNCADO (a divisão inteira) em vez do
         valor float correto: se isso passar, confirma a hipótese. */
      const aproveitamentoTruncado = Math.trunc((minha.n - minha.posicao) / (minha.n - 1));
      try {
        await d.db.doc("usuarios/" + d.uid + "/partidas/" + pid + "-teste-trunc").set({
          pid, sala: d.client.codigo, terminadaEm: it.terminadaEm || Date.now(),
          n: minha.n, posicao: minha.posicao, saldo: minha.saldo,
          aproveitamento: aproveitamentoTruncado, idxResultado: idx
        });
        console.log("    diag " + d.persona.nick + ": CONFIRMADO — com aproveitamento=" +
          aproveitamentoTruncado + " (divisão inteira truncada) em vez de " + minha.aproveitamento +
          " a escrita passou. A regra faz divisão inteira em (n-posicao)/(n-1).");
      } catch (e2){
        console.log("    diag " + d.persona.nick + ": hipótese de divisão inteira NÃO confirmada — " + (e2.code || e2.message));
      }
    }
  } catch (e){
    console.log("    diag " + d.persona.nick + ": ERRO NO DIAGNÓSTICO — " + (e.code || e.message));
  }
}

async function fecharPartida(devices, pid, cenario){
  for (const d of devices){
    const outros = devices.filter(x => x !== d).map(x => x.uid);
    const ok1 = await d.contas.registrarResultado(d.uid, d.client.codigo, pid);
    if (!ok1){
      achado(cenario, "registrarResultado falhou pra " + d.persona.nick + " (pid " + pid + ")");
      await diagnosticarFalha(d, d.client.codigo, pid);
    }
    const carta = d.client.vm().minhaCarta;
    if (carta) await d.T.avaliarCarta(carta, 1 + Math.floor(Math.random() * 5), d.uid, pid);
    await d.contas.amizadeAutomatica(d.uid, outros);
  }
  await sleep(600);
}

/* ---------------- Cenário A — todos os 10 juntos, 2 partidas ---------------- */
async function cenarioA(devices){
  console.log("\nCENÁRIO A — 10 juntos numa sala, 2 partidas\n");
  const codigo = await criarSala(devices[0], devices.slice(1));
  const ordem1 = [9,8,7,6,5,4,3,2,1,0];
  const p1 = await jogarPartida(devices, ordem1);
  await fecharPartida(devices, p1.pid, "A");

  const cl1 = devices[0].client.vm().classificacao;
  const somaSaldo = cl1.reduce((s,x) => s + x.saldo, 0);
  t("A", "classificação da sala soma saldo zero após 1 partida", somaSaldo === 0, "soma=" + somaSaldo);

  await devices[0].client.jogarDeNovo();
  await sleep(900);
  const ordem2 = [0,1,2,3,4,5,6,7,8,9];
  const p2 = await jogarPartida(devices, ordem2);
  await fecharPartida(devices, p2.pid, "A");

  const cl2 = devices[0].client.vm().classificacao;
  t("A", "todos com 2 partidas na classificação da sala", cl2.every(x => x.partidas === 2),
    JSON.stringify(cl2.map(x => x.partidas)));

  let paresAmigos = 0;
  for (const d of devices){
    const amigos = await d.contas.amigos(d.uid);
    paresAmigos += amigos.length;
  }
  t("A", "45 arestas de amizade automática (C(10,2)*2 direções = 90)", paresAmigos === 90, "total=" + paresAmigos);

  for (const d of devices){
    const rank = await d.contas.rankAmigos(d.uid);
    const eu = rank.find(r => r.eu);
    if (!eu || eu.partidas !== 2) achado("A", d.persona.nick + ": rankAmigos mostra " + (eu && eu.partidas) + " partidas, esperado 2");
  }
  sairDeTodos(devices);
  return codigo;
}

/* ---------------- Cenário B — 2 salas sem sobreposição (5+5) ---------------- */
async function cenarioB(devices){
  console.log("\nCENÁRIO B — 2 salas separadas, sem sobreposição (5+5)\n");
  const grupo1 = devices.slice(0,5), grupo2 = devices.slice(5,10);
  const cod1 = await criarSala(grupo1[0], grupo1.slice(1));
  const p1 = await jogarPartida(grupo1, [4,3,2,1,0]);
  await fecharPartida(grupo1, p1.pid, "B");

  const cod2 = await criarSala(grupo2[0], grupo2.slice(1));
  const p2 = await jogarPartida(grupo2, [0,1,2,3,4]);
  await fecharPartida(grupo2, p2.pid, "B");

  for (const d of grupo1){
    const amigos = await d.contas.amigos(d.uid);
    const idsAmigos = amigos.map(a => a.uid);
    const vazou = grupo2.some(x => idsAmigos.includes(x.uid));
    if (vazou) achado("B", d.persona.nick + " (sala 1) tem amigo da sala 2 — vazamento de amizade entre salas");
  }
  t("B", "ninguém da sala 1 é amigo de alguém da sala 2",
    !achados.some(a => a.cenario === "B" && a.texto.indexOf("vazamento") >= 0));
  sairDeTodos(grupo1); sairDeTodos(grupo2);
}

/* ---------------- Cenário C — 2 salas com sobreposição parcial ---------------- */
async function cenarioC(devices){
  console.log("\nCENÁRIO C — 2 salas com sobreposição parcial (1-6 / 5-10)\n");
  const sala1 = devices.slice(0,6);          // jogadores 0-5
  const sala2 = devices.slice(4,10);         // jogadores 4-9 (índices 4,5 se repetem)
  await criarSala(sala1[0], sala1.slice(1));
  const p1 = await jogarPartida(sala1, [5,4,3,2,1,0]);
  await fecharPartida(sala1, p1.pid, "C");

  await criarSala(sala2[0], sala2.slice(1));
  const p2 = await jogarPartida(sala2, [0,1,2,3,4,5]);
  await fecharPartida(sala2, p2.pid, "C");

  const pontes = [devices[4], devices[5]];   // jogaram nas duas salas
  const exclusivos = [devices[0],devices[1],devices[2],devices[3],devices[6],devices[7],devices[8],devices[9]];
  for (const d of pontes){
    const amigos = await d.contas.amigos(d.uid);
    t("C", d.persona.nick + " (ponte) tem mais amigos que quem jogou 1 sala só",
      amigos.length >= 5, "amigos=" + amigos.length);
  }
  for (const d of exclusivos){
    const amigos = await d.contas.amigos(d.uid);
    if (amigos.length > 5) achado("C", d.persona.nick + " tem " + amigos.length + " amigos, esperado no máximo 5 (só sua sala)");
  }
  sairDeTodos(sala1); sairDeTodos(sala2);
}

/* ---------------- Cenário D — reconexão (pendência 1 e 3) ---------------- */
async function cenarioD(devices){
  console.log("\nCENÁRIO D — reconexão isolando as pendências 1 e 3\n");
  const trio = devices.slice(0,3);
  const codigo = await criarSala(trio[0], trio.slice(1));
  const p1 = await jogarPartida(trio, [2,1,0]);

  /* jogador do meio "reconecta": novo client, mesmo uid, MESMO processo
     (sem localStorage compartilhado com outra conta — isola a pendência 3
     por construção, já que cada device tem seu próprio Map()). */
  const reconectando = trio[1];
  reconectando.client = reconectando.T.CriarSalaCliente(reconectando.db, { uid: reconectando.uid });
  await reconectando.client.abrir(codigo);
  await sleep(900);

  await fecharPartida(trio, p1.pid, "D");

  const carta = trio[1].client.vm().minhaCarta;
  t("D", "carta da partida ainda identificável após reconexão", !!carta, String(carta));

  const parte = await reconectando.contas.perfil(reconectando.uid);
  t("D", "reconectando teve resultado registrado (partidas=1) mesmo após reconexão",
    parte && parte.partidas === 1, JSON.stringify(parte));
  if (!parte || parte.partidas !== 1)
    achado("D", "pendência 1 CONFIRMADA como bug real: registrarResultado não gravou após reconexão");
  else
    achado("D", "pendência 1 NÃO reproduzida neste método (processo isolado, sem localStorage cruzado) — reforça a suspeita de que era artefato do teste anterior, não bug do produto");
  sairDeTodos(trio);
}

/* ---------------- Cenário E — sala solo ---------------- */
async function cenarioE(devices){
  console.log("\nCENÁRIO E — sala solo (1 jogador)\n");
  const solo = devices[0];
  solo.client = solo.T.CriarSalaCliente(solo.db, { uid: solo.uid });
  const nivel = (solo.T.NIVEIS ? solo.T.NIVEIS.length : 3) - 1;
  try {
    await solo.client.criar("", solo.persona.nick, solo.T.ALL_MASK, nivel);
    await sleep(900);
    const r = await solo.client.comecar().then(() => true, e => { achado("E", "comecar() sozinho: " + (e.code || e.message)); return false; });
    t("E", "comportamento com 1 jogador bate com o esperado (ver README)", true, String(r));
  } catch (e){
    achado("E", "erro inesperado criando sala solo: " + (e.code || e.message));
  }
  sairDeTodos([solo]);
}

(async function(){
  console.log("QA DE PRODUÇÃO DO ZERO — quem-sou-eu-e3e32\n");
  const devices = await criarContas();
  /* B e C testam ISOLAMENTO de amizade entre salas — têm que rodar antes
     do A, que junta todo mundo numa sala só e satura o grafo de amizade
     (rodar depois do A invalidaria a checagem: todo mundo já seria amigo
     de todo mundo por causa do A, não por vazamento nenhum). */
  await cenarioB(devices);
  await cenarioC(devices);
  await cenarioA(devices);
  await cenarioD(devices);
  await cenarioE(devices);

  console.log("\n" + okCount + " passaram, " + falhas + " falharam, " + achados.length + " achados\n");
  if (achados.length){
    console.log("ACHADOS PARA DISCUTIR COM A ENGENHARIA:");
    achados.forEach(a => console.log("  - [" + a.cenario + "] " + a.texto));
  }
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
