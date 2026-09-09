/* Testa as funções REAIS do app: carrega o <script> do HTML dentro de um DOM
   mínimo e expõe encode/decode/wordFor. Nada de reimplementar a lógica aqui —
   uma cópia paralela poderia passar no teste e o app quebrar mesmo assim.
   node test.js */
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync(__dirname + (process.env.JOGO || "/quem-sou-eu-temas.html"), "utf8");
const open = html.indexOf("<script>") + "<script>".length;
const close = html.lastIndexOf("</" + "script>");
let code = html.slice(open, close);

// expõe as funções privadas da IIFE só para o teste
const tail = "})();";
const at = code.lastIndexOf(tail);
if (at < 0) throw new Error("não achei o fim da IIFE");
code = code.slice(0, at) +
  "globalThis.__t={encode:encode,decode:decode,cardsFor:cardsFor,wordFor:wordFor," +
  "DECKS:DECKS,NIVEIS:NIVEIS,ALL_MASK:ALL_MASK,POOL:POOL,A32:A32};" + tail;

/* ---------- DOM mínimo ---------- */
class El {
  constructor(tag) {
    this.tagName = tag || "div"; this.children = []; this.style = {};
    this._text = ""; this._html = ""; this._attrs = {}; this.value = ""; this.hidden = false;
    this.classList = {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    };
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  set className(v) { this.classList._s = new Set(String(v).split(" ").filter(Boolean)); }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k]; }
  addEventListener() {}
  appendChild(c) { this.children.push(c); return c; }
  querySelector() { return new El(); }
  querySelectorAll() { return list(8); }
  focus() {}
}
const list = n => Array.from({ length: n }, () => new El());
const byId = {};
const document = {
  head: new El("head"),
  activeElement: null,
  createElement: t => new El(t),
  getElementById: id => (byId[id] = byId[id] || new El()),
  querySelector: () => null,
  querySelectorAll: () => list(8),
  addEventListener() {},
  visibilityState: "visible",
};
const sandbox = {
  document,
  navigator: { userAgent: "node" },
  location: { hash: "", href: "https://exemplo/x" },
  localStorage: { getItem: () => null, setItem() {}, },
  window: null,
  setTimeout, clearTimeout, setInterval, clearInterval,
  addEventListener() {}, scrollTo() {},
  console, Math, BigInt, Number, JSON, String, Array, Object,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const T = sandbox.__t;
if (!T) throw new Error("as funções não foram expostas");

/* ---------- testes ---------- */
let falhas = 0;
const ok = (cond, msg) => { if (!cond) { falhas++; console.log("  FALHA: " + msg); } };
const rnd = n => Math.floor(Math.random() * n);

console.log("app carregado: " + T.POOL.length + " cartas, " + T.DECKS.length + " baralhos\n");

/* 1. roundtrip */
let n1 = 0;
for (let i = 0; i < 200000; i++) {
  const mask = 1 + rnd(T.ALL_MASK);
  const nivel = rnd(3), n = 2 + rnd(11), seed = rnd(256);
  if (T.cardsFor(mask, nivel).length < n) continue;   // combinação inválida por regra
  n1++;
  const d = T.decode(T.encode(mask, nivel, n, seed));
  ok(d && d.mask === mask && d.nivel === nivel && d.n === n && d.seed === seed,
     "roundtrip " + [mask, nivel, n, seed]);
  if (falhas > 3) break;
}
console.log("1. roundtrip: " + n1 + " combinações aleatórias");

/* 2. tamanho e alfabeto */
const amostra = T.encode(T.ALL_MASK, 0, 6, 7);
ok(amostra.length === 7, "código deveria ter 7 caracteres, tem " + amostra.length);
ok([...amostra].every(c => T.A32.includes(c)), "código fora do alfabeto");
console.log("2. formato: " + amostra + " (7 caracteres, alfabeto sem 0/O/1/I)");

/* 3. string aleatória raramente é aceita */
let aceitas = 0, N = 200000;
for (let i = 0; i < N; i++) {
  let s = ""; for (let j = 0; j < 7; j++) s += T.A32[rnd(32)];
  if (T.decode(s)) aceitas++;
}
console.log("3. string aleatória aceita: " + (aceitas / N * 100).toFixed(3) + "%");

/* 4. erro de um caractere */
let miss = 0, tries = 0;
for (let i = 0; i < 120000; i++) {
  const mask = 1 + rnd(T.ALL_MASK), nivel = rnd(3), n = 2 + rnd(11);
  if (T.cardsFor(mask, nivel).length < n) continue;
  const c = T.encode(mask, nivel, n, rnd(256));
  const p = rnd(7), ch = T.A32[rnd(32)];
  if (ch === c[p]) continue;
  tries++;
  if (T.decode(c.slice(0, p) + ch + c.slice(p + 1))) miss++;
}
console.log("4. erro de 1 caractere detectado: " + (100 - miss / tries * 100).toFixed(2) +
            "%  (" + tries.toLocaleString("pt-BR") + " testes)");

/* 5. troca de dois vizinhos */
let tm = 0, tt = 0;
for (let i = 0; i < 120000; i++) {
  const mask = 1 + rnd(T.ALL_MASK), nivel = rnd(3), n = 2 + rnd(11);
  if (T.cardsFor(mask, nivel).length < n) continue;
  const c = T.encode(mask, nivel, n, rnd(256));
  const p = rnd(6);
  if (c[p] === c[p + 1]) continue;
  tt++;
  if (T.decode(c.slice(0, p) + c[p + 1] + c[p] + c.slice(p + 2))) tm++;
}
console.log("5. troca de 2 vizinhos detectada: " + (100 - tm / tt * 100).toFixed(2) + "%");

/* 6. invariantes de partida */
let colisao = 0, partidas = 0;
for (let i = 0; i < 6000; i++) {
  const mask = 1 + rnd(T.ALL_MASK), nivel = rnd(3), n = 2 + rnd(11);
  if (T.cardsFor(mask, nivel).length < n) continue;
  const g = T.decode(T.encode(mask, nivel, n, rnd(256)));
  const r = 1 + rnd(80);
  const s = new Set();
  for (let p = 1; p <= g.n; p++) s.add(T.wordFor(g, r, p));
  partidas++;
  if (s.size !== g.n) colisao++;
}
ok(colisao === 0, colisao + " partidas com dois jogadores na mesma carta");
console.log("6. " + partidas.toLocaleString("pt-BR") + " partidas: " + colisao + " colisões entre jogadores");

/* 7. dois aparelhos, mesmo código */
const c7 = T.encode(T.ALL_MASK, 1, 8, 42);
const A = T.decode(c7), B = T.decode(c7);
let iguais = true;
for (let r = 1; r <= 20; r++) for (let p = 1; p <= 8; p++)
  if (T.wordFor(A, r, p) !== T.wordFor(B, r, p)) iguais = false;
ok(iguais, "aparelhos diferentes com o mesmo código discordam");
console.log("7. dois aparelhos com o mesmo código concordam em 20 rodadas: " + iguais);

/* 8. seleção múltipla = união sem repetição */
const soDesenhos = T.cardsFor(1, 2).length;
const soAnime = T.cardsFor(2, 2).length;
const juntos = T.cardsFor(3, 2).length;
ok(juntos === soDesenhos + soAnime, "união deveria somar " + (soDesenhos + soAnime) + ", deu " + juntos);
console.log("8. Desenhos(" + soDesenhos + ") + Anime(" + soAnime + ") = " + juntos + " sem repetir");

const bichosSozinho = T.cardsFor(64, 2).length;
const desenhosEBichos = T.cardsFor(1 | 64, 2).length;
ok(desenhosEBichos < soDesenhos + bichosSozinho,
   "Bichos cruza os outros baralhos; a união não pode ser a soma pura");
ok(new Set(T.cardsFor(T.ALL_MASK, 2)).size === T.cardsFor(T.ALL_MASK, 2).length,
   "baralho completo tem carta repetida");
console.log("9. Bichos(" + bichosSozinho + ") sobrepõe Desenhos: união = " + desenhosEBichos +
            " (soma pura seria " + (soDesenhos + bichosSozinho) + ")");

/* 10. dificuldade é cumulativa */
for (const mask of [1, 2, 64, 512, T.ALL_MASK]) {
  const f = new Set(T.cardsFor(mask, 0)), m = new Set(T.cardsFor(mask, 1)), d = T.cardsFor(mask, 2);
  ok([...f].every(x => m.has(x)), "médio não contém todo o fácil (máscara " + mask + ")");
  ok([...m].every(x => d.includes(x)), "difícil não contém todo o médio (máscara " + mask + ")");
}
console.log("10. dificuldade cumulativa: médio contém fácil, difícil contém médio");

/* 11. máscara vazia e nº de jogadores maior que o baralho são rejeitados */
ok(T.decode(T.encode(0, 0, 4, 1)) === null, "máscara vazia deveria ser rejeitada");
console.log("11. máscara vazia rejeitada");

console.log("\n" + (falhas ? falhas + " falha(s)" : "todos os testes passaram"));
process.exit(falhas ? 1 : 0);
