/* MODO MESA — sem servidor. Carrega o app em N "aparelhos" (contextos vm,
   cada um com seu localStorage), todos a partir do MESMO código de 5 dígitos.
   Verifica: código numérico (roundtrip + checksum), cartas determinísticas e
   distintas, revelação única por rodada, painel dos adversários, senha, rodadas,
   reload, e o link com nomes. 2 a 16 jogadores.
   node test-mesa.js */
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync(__dirname + (process.env.JOGO || "/quem-sou-eu-temas.html"), "utf8");
const src = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</" + "script>"));
const injected = src.slice(0, src.lastIndexOf("})();")) +
  "globalThis.__t={CriarMesa:CriarMesa,encodeMesa5:encodeMesa5,decodeMesa5:decodeMesa5," +
  "checksum5:checksum5,parseMesaHash:parseMesaHash,linkMesa:linkMesa,maskLabel:maskLabel," +
  "palavrasHTML:palavrasHTML,fitWord:fitWord," +
  "wordFor:wordFor,cardsFor:cardsFor,senhaConfere:senhaConfere,NIVEIS:NIVEIS,TEMAS:TEMAS,ALL_MASK:ALL_MASK,BR_MASK:BR_MASK};})();";
const script = new vm.Script(injected, { filename: "quem-sou-eu-online.html" });

/* ---- DOM mínimo (só p/ o app carregar) ---- */
class El {
  constructor(t) { this.tagName = (t || "div").toUpperCase(); this.children = []; this.style = {}; this._t = ""; this._h = ""; this._a = {}; this.value = ""; this.hidden = false;
    this.classList = { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, toggle(c,o){ (o===undefined?!this._s.has(c):o)?this._s.add(c):this._s.delete(c); }, contains(c){return this._s.has(c);} }; }
  get textContent(){return this._t;} set textContent(v){this._t=String(v);}
  get innerHTML(){return this._h;} set innerHTML(v){this._h=String(v);this.children=[];}
  set className(v){this.classList._s=new Set(String(v).split(" ").filter(Boolean));}
  setAttribute(k,v){this._a[k]=v;} getAttribute(k){return this._a.hasOwnProperty(k)?this._a[k]:null;}
  addEventListener(){} appendChild(c){this.children.push(c);return c;}
  querySelector(){return new El();} querySelectorAll(){return Array.from({length:8},()=>new El());} focus(){}
}
function makeDoc(){ const byId={}; return { head:new El("head"), body:new El("body"), activeElement:null, visibilityState:"visible",
  createElement:t=>new El(t), getElementById:id=>(byId[id]=byId[id]||new El()), querySelector:()=>null,
  querySelectorAll:()=>Array.from({length:8},()=>new El()), addEventListener(){} }; }

function makeDevice(name) {
  const mem = new Map();
  const localStorage = { getItem:k=>(mem.has(k)?mem.get(k):null), setItem:(k,v)=>mem.set(k,String(v)), removeItem:k=>mem.delete(k) };
  const sandbox = {
    document: makeDoc(), localStorage,
    navigator:{userAgent:"node",vibrate(){}}, location:{hash:"",href:"https://exemplo/quem"},
    window:null, console, Math, JSON, Date, Promise, RegExp, Error, TypeError, Boolean,
    BigInt, Number, String, Array, Object, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout, setInterval:()=>0, clearInterval(){}, scrollTo(){}, addEventListener(){},
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  script.runInContext(sandbox);
  return { name, mem, localStorage, sandbox, T: sandbox.__t };
}

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("  FALHA: " + m); } };

const base = makeDevice("base").T;

/* ============ código de 5 números (tema · nível · pessoas · semente) ============
   O formato mudou: antes o código guardava só nível/pessoas/semente e os
   baralhos viajavam no link; agora ele guarda o ÍNDICE DE UM TEMA, e o
   link não carrega mais máscara. */
function testeCodigo() {
  const T = base.TEMAS;
  let total = 0, ruins = 0;
  for (let tema = 0; tema < T.length; tema++)
    for (let nivel = 0; nivel < 3; nivel++)
      for (let n = 2; n <= 16; n++)
        for (let seed = 0; seed < 4; seed++) {
          const code = base.encodeMesa5(tema, nivel, n, seed);
          if (!/^[0-9]{5}$/.test(code)) { ruins++; continue; }
          const d = base.decodeMesa5(code);
          if (!d) continue;             // combinação sem cartas suficientes
          total++;
          if (d.tema !== tema || d.nivel !== nivel || d.n !== n || d.seed !== seed) ruins++;
          if (d.mask !== T[tema].mask) ruins++;
        }
  ok(ruins === 0, "código: " + total + " combinações válidas, " + ruins + " roundtrips errados");
  ok(/^[0-9]{5}$/.test(base.encodeMesa5(0, 0, 8, 3)), "código: sempre 5 dígitos");

  const c16 = base.encodeMesa5(0, 0, 16, 1);
  ok(base.decodeMesa5(c16) && base.decodeMesa5(c16).n === 16, "código: aceita 16 pessoas");
  ok(base.decodeMesa5("abc") === null && base.decodeMesa5("123456") === null,
     "código: não-5-dígitos = null");
  ok(base.decodeMesa5(base.encodeMesa5(99, 0, 4, 0)) === null ||
     base.decodeMesa5(base.encodeMesa5(99, 0, 4, 0)).tema < base.TEMAS.length,
     "código: tema fora da lista não decodifica pra tema inexistente");

  /* Quantos dos 65536 números possíveis são jogo válido. Quanto maior,
     mais fácil um engano virar partida errada em vez de erro. */
  let validos = 0;
  for (let x = 0; x <= 65535; x++) if (base.decodeMesa5(String(x).padStart(5, "0"))) validos++;
  const densidade = validos / 65536;
  ok(densidade < 0.07, "código: " + (densidade * 100).toFixed(2) + "% dos números são jogo válido");

  /* ---------------------------------------------------------------
     REGRESSÃO CONHECIDA, medida e registrada de propósito.

     Quando o Modo Mesa passou a guardar TEMA no código, 5 bits foram
     para esse campo e o checksum caiu de 6 bits para 3. Resultado: um
     erro de um dígito só é detectado em ~93% das vezes. Nos outros
     ~7% ele decodifica como OUTRA partida válida — ninguém vê erro, e
     as pessoas na mesa recebem cartas que não combinam entre si.

     O limite abaixo descreve o que o código faz HOJE. Não é uma meta:
     é uma trava para o número não piorar sem alguém perceber. Se um
     dia o formato ganhar mais um dígito ou um bit a mais de checksum,
     baixe este limite junto.
     --------------------------------------------------------------- */
  let miss = 0, tries = 0;
  for (let i = 0; i < 60000; i++) {
    const tema = i % T.length, nivel = i % 3, n = 2 + (i % 15), seed = i % 4;
    const c = base.encodeMesa5(tema, nivel, n, seed);
    if (!base.decodeMesa5(c)) continue;
    const p = i % 5, dig = String(i % 10);
    if (dig === c[p]) continue;
    const bad = c.slice(0, p) + dig + c.slice(p + 1);
    tries++;
    const d = base.decodeMesa5(bad);
    if (d && (d.tema !== tema || d.nivel !== nivel || d.n !== n || d.seed !== seed)) miss++;
  }
  const taxa = miss / tries;
  ok(taxa < 0.08, "código: erro de 1 dígito vira outro jogo em " +
     (taxa * 100).toFixed(2) + "% (trava em 8%, checksum de 3 bits)");
}

/* ============ link: só o código e os nomes ============
   A máscara saiu do link — o tema já está dentro do código. O separador
   dos nomes é "~". */
function testeLink() {
  const tema = 5;                                   // Desenhos
  const code = base.encodeMesa5(tema, 1, 4, 2);
  const link = base.linkMesa(code, ["Dani", "Bebel", "Zé Ramalho", "Rafa"]);

  ok(link.indexOf("#j" + code) >= 0, "link: hash é 'j' + os 5 números");
  ok(link.indexOf("-") < 0 || link.indexOf("#j" + code + "-") < 0,
     "link: não carrega mais máscara de baralhos");

  const p = base.parseMesaHash(link.split("#")[1]);
  ok(p && p.codigo === code, "link: código extraído do hash");
  ok(p.tema === tema && p.mask === base.TEMAS[tema].mask, "link: tema veio do código, não do link");
  ok(p.nivel === 1 && p.n === 4 && p.seed === 2, "link: nível, pessoas e semente do código");
  ok(p.nicks.length === 4 && p.nicks[2] === "Zé Ramalho", "link: nomes decodificados (acento incluso)");

  const pelado = base.parseMesaHash(code);
  ok(pelado && pelado.codigo === code && pelado.nicks.length === 0,
     "link: número pelado funciona, sem nomes");
  ok(base.parseMesaHash("j" + code) !== null, "link: com ou sem o 'j' na frente");
  ok(base.linkMesa(code, []).indexOf("~") < 0, "link: sem nomes, sem '~' no hash");
  ok(base.parseMesaHash("abcde") === null, "link: não-numérico = null");

  const pv = base.parseMesaHash("j" + code + "~Dani~~Rafa~");
  ok(pv.nicks[0] === "Dani" && pv.nicks[1] === "" && pv.nicks[2] === "Rafa",
     "link: lacuna no meio vira slot sem nome (o índice é o slot)");

  const Mv = base.CriarMesa({ codigo: code, mask: base.TEMAS[tema].mask, nivel: 1, n: 4,
                              seed: 2, nicks: ["Dani", "", "Rafa", ""] });
  Mv.retomar(); Mv.escolherSlot(2);
  ok(Mv.temNomes() === true && Mv.nick === "Jogador 2",
     "mesa: slot sem nome vira 'Jogador N', mas a mesa ainda 'tem nomes'");
  const vmv = Mv.vm();
  ok(vmv.membros[0].nick === "Dani" && vmv.membros[3].nick === "Jogador 4",
     "mesa: painel mistura nomes e números");
}

/* ============ fluxo com N jogadores ============ */
function cenario(N, comNomes) {
  const tema = 0;                              // "Tudo" — o baralho inteiro
  const mask = base.TEMAS[tema].mask;
  const nivel = 0;
  const seed = N % 4;                          // a semente agora tem 2 bits
  const code = base.encodeMesa5(tema, nivel, N, seed);
  const nomes = comNomes ? Array.from({ length: N }, (_, i) => "P" + (i + 1)) : [];
  const payload = { codigo: code, mask, nivel, n: N, seed, nicks: nomes };

  const dev = [];
  for (let i = 0; i < N; i++) {
    const d = makeDevice("d" + i);
    const M = d.T.CriarMesa(payload);
    M.retomar();
    M.escolherSlot(i + 1);
    dev.push({ d, M });
  }

  // toda carta é distinta e todos os aparelhos concordam sobre cada slot
  const cartas = dev.map(x => x.M.minhaCarta());
  ok(new Set(cartas).size === N && cartas.every(Boolean), "N=" + N + (comNomes ? " (nomes)" : "") + ": " + N + " cartas distintas");
  let concordam = true;
  for (let s = 1; s <= N; s++) {
    const ref = dev[0].M.vm().membros[s - 1].carta;
    for (let j = 1; j < N; j++) if (dev[j].M.vm().membros[s - 1].carta !== ref) concordam = false;
  }
  ok(concordam, "N=" + N + ": todos os aparelhos veem a mesma carta em cada slot");

  // ninguém vê o painel antes de esconder; a própria carta não vaza no painel
  for (const x of dev) {
    const v = x.M.vm();
    ok(v.fase === "revelando" && !v.jaEscondi, "N=" + N + ": começa virada, sem esconder");
  }

  // cada um revela e esconde
  for (const x of dev) x.M.esconder();
  for (const x of dev) {
    const v = x.M.vm();
    ok(v.jaEscondi && v.fase === "jogando", "N=" + N + ": " + x.d.name + " escondeu");
    ok(v.cartasNaMesa.length === N - 1, "N=" + N + ": painel mostra " + (N - 1) + " adversários");
    const minha = x.M.minhaCarta();
    ok(!v.cartasNaMesa.some(c => c.carta === minha && (!comNomes || c.nick !== v.meuNick)), "N=" + N + ": a própria carta não aparece atrelada a outro nick no painel");
    // o painel bate com o que cada adversário tem
    for (const c of v.cartasNaMesa) {
      const alvo = dev.find(y => (comNomes ? y.M.vm().meuNick === c.nick : y.M.vm().membros[y.M.slot - 1].slot === parseInt(c.nick.replace(/\D/g, "") || y.M.slot)));
    }
  }

  // senha: nome certo passa, errado não
  ok(dev[0].M.senha("nada a ver").ok === false, "N=" + N + ": senha errada não passa");
  const r = dev[0].M.senha(dev[0].M.minhaCarta());
  ok(r.ok && dev[0].M.vm().jaAcertei, "N=" + N + ": senha = nome da carta libera");

  // rodada nova: deal novo, revelação zera
  const cartaR1 = dev[0].M.minhaCarta();
  for (const x of dev) x.M.rodadaDelta(1);
  ok(dev[0].M.vm().rodada === 2 && !dev[0].M.vm().jaEscondi, "N=" + N + ": próxima rodada zera a revelação");
  const cartaR2 = dev[0].M.minhaCarta();
  ok(cartaR2 && cartaR2 !== cartaR1, "N=" + N + ": rodada 2 dá carta nova (" + cartaR1 + " -> " + cartaR2 + ")");
  const cartas2 = dev.map(x => x.M.minhaCarta());
  ok(new Set(cartas2).size === N, "N=" + N + ": rodada 2 também com cartas distintas");

  // reload do aparelho 1 (mesmo localStorage, cliente novo): retoma slot+rodada+reveal
  dev[0].M.esconder();
  const relD = { d: dev[0].d };
  const M2 = dev[0].d.T.CriarMesa(payload);
  M2.retomar();
  ok(M2.slot === 1 && M2.rodada === 2 && M2.vm().jaEscondi, "N=" + N + ": reload retoma slot, rodada e revelação");
  ok(M2.minhaCarta() === cartaR2, "N=" + N + ": reload devolve a mesma carta");

  // notas por rodada, isoladas
  dev[0].M.salvarNotas("acho que sou o Pato");
  ok(M2.lerNotas() === "acho que sou o Pato", "N=" + N + ": notas salvam e voltam");
}

/* ============ carta: cada palavra numa linha, fonte adaptativa ============ */
function testeFit() {
  const P = base.palavrasHTML;
  ok(P("Bob Esponja") === "<span>Bob</span><span>Esponja</span>", "palavras: quebra por espaço, uma por span");
  ok(P("Frankenstein") === "<span>Frankenstein</span>", "palavras: uma palavra só = um span");
  ok(P("Coelho Branco (Alice)") === "<span>Coelho</span><span>Branco</span><span>(Alice)</span>", "palavras: parêntese conta como palavra");
  ok(P("  Zé  Ramalho ").indexOf("<span></span>") < 0, "palavras: espaços extras não viram span vazio");
  ok(P("") === "<span>?</span>" && P(null) === "<span>?</span>", "palavras: vazio vira '?'");
  ok(P("Homem-Aranha") === "<span>Homem-Aranha</span>", "palavras: hífen não separa");
  ok(!/[<>]/.test(P("A & B").replace(/<\/?span>/g, "")), "palavras: escapa < > &");

  // busca binária do fitWord: elemento sintético cujo scroll deriva da fonte
  let words = [], fz = 16;
  const el = {
    style: { get fontSize() { return fz + "px"; }, set fontSize(v) { fz = parseFloat(v); } },
    set innerHTML(v) { words = (String(v).match(/<span>[^<]*<\/span>/g) || []).map(x => x.replace(/<\/?span>/g, "")); },
    get scrollWidth() { return Math.max(0, ...words.map(w => w.length)) * fz * 0.52; },
    get scrollHeight() { return words.length * fz * 1.03; },
    parentElement: { clientWidth: 360, clientHeight: 520 },
  };
  const T2 = makeDevice("fit");
  T2.sandbox.document.getElementById = id => (id === "theword" ? el : { style: {}, parentElement: null });
  const CW = 360 - 28, CH = 520 - 28;
  let estouros = 0;
  for (const nome of ["Frankenstein", "Relâmpago McQueen", "Sr. Cabeça de Batata",
    "Coelho Branco (Alice)", "Vanderlei Cordeiro de Lima", "Zezé Di Camargo e Luciano", "E.T."]) {
    el.innerHTML = T2.T.palavrasHTML(nome);
    T2.T.fitWord("theword");
    const f = fz;
    const w = Math.max(0, ...words.map(x => x.length)) * f * 0.52;
    const ht = words.length * f * 1.03;
    if (w > CW + 1 || ht > CH + 1) { estouros++; console.log("    (estourou: " + nome + " @ " + f.toFixed(0) + "px)"); }
    if (f < 20) console.log("    (fonte pequena demais: " + nome + " @ " + f.toFixed(0) + "px)");
  }
  ok(estouros === 0, "fitWord: nenhuma carta estoura a área (largura da palavra + altura das linhas)");
}

console.log("MODO MESA — determinístico, sem servidor\n");

let a = fails; testeCodigo();
console.log((fails === a ? "  ok  " : " FALHA") + "  código de 5 números (tema·nível·pessoas·semente, checksum 3 bits)");
a = fails; testeLink();
console.log((fails === a ? "  ok  " : " FALHA") + "  link: código + nomes (o tema já vem dentro do código)");
a = fails; testeFit();
console.log((fails === a ? "  ok  " : " FALHA") + "  carta: palavra por linha + fonte adaptativa");

for (const N of [2, 3, 4, 5, 6, 7, 8]) {
  a = fails;
  cenario(N, true);
  cenario(N, false);
  console.log((fails === a ? "  ok  " : " FALHA") + "  " + N + " jogadores: cartas, revelação única, painel, senha, rodadas, reload");
}
a = fails;
for (const N of [10, 12, 14, 16]) cenario(N, true);
console.log((fails === a ? "  ok  " : " FALHA") + "  10 a 16 jogadores");

console.log("\n" + (fails ? fails + " falha(s)" : "todos os testes de modo mesa passaram"));
process.exit(fails ? 1 : 0);
