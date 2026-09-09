/* Auditoria do baralho. Lê o HTML publicado — fonte única, sem cópia paralela.
   node audit.js   (sai com código 1 se algo estiver quebrado) */
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/quem-sou-eu-online.html", "utf8");

/* fatiamento por marcador: sem regex, sem barra invertida para o shell comer */
function grab(name) {
  const start = src.indexOf("var " + name + " = ");
  if (start < 0) throw new Error("não achei " + name);
  const from = start + ("var " + name + " = ").length;
  const end = src.indexOf(";\n", from);
  return eval(src.slice(from, end));
}
const GROUPS = grab("GROUPS");
const ANIMAIS = grab("ANIMAIS");

const POOL = [], seen = new Map(), dups = [], junk = [];
const RASCUNHO = /[?]|\bnao\b|\bdup\b|TODO/;
for (const g of GROUPS)
  for (const [t, lvl] of [["f", 1], ["m", 2], ["d", 3]])
    for (const name of g[t].split("|")) {
      if (!name.trim()) junk.push(g.id + " [" + t + "] entrada vazia");
      else if (RASCUNHO.test(name)) junk.push(g.id + " [" + t + "] " + JSON.stringify(name));
      if (seen.has(name)) dups.push(name + "  (" + seen.get(name) + " -> " + g.id + ")");
      else seen.set(name, g.id);
      POOL.push({ n: name, lvl, grp: g.id });
    }
const AN = new Set(ANIMAIS.split("|"));
POOL.forEach(e => (e.animal = AN.has(e.n) ? 1 : 0));
const orfaos = ANIMAIS.split("|").filter(a => !seen.has(a));

const G = (...ids) => e => ids.includes(e.grp);
// mesma ordem do array DECKS no HTML — o índice é o bit no código
const DECKS = [
  ["Desenhos", 0, G("animacao")],
  ["Anime", 0, G("anime")],
  ["Super-herois", 0, G("herois")],
  ["Cinema", 0, G("cinema")],
  ["Series", 0, G("series")],
  ["Games", 0, G("games")],
  ["Bichos", 0, e => !!e.animal],
  ["Mitos e lendas", 0, G("mito")],
  ["Brasil ficcao", 1, G("brasilficcao")],
  ["Musica BR", 1, G("musicabr")],
  ["Musica mundo", 0, G("musicaglob")],
  ["Esporte BR", 1, G("esportebr")],
  ["Esporte mundo", 0, G("esporteglob")],
  ["Famosos BR", 1, G("famososbr")],
  ["Famosos mundo", 0, G("famososglob")],
  ["Historia", 0, G("historia")],
];

let falhas = 0;
const erro = m => { falhas++; console.log("  FALHA: " + m); };
const MAX_JOGADORES = 12;

console.log("TOTAL " + POOL.length +
  "   facil " + POOL.filter(e => e.lvl === 1).length +
  " | medio " + POOL.filter(e => e.lvl <= 2).length +
  " | dificil " + POOL.length +
  "   (" + DECKS.length + " baralhos)");

console.log("\nintegridade");
junk.forEach(j => erro("rascunho: " + j));
dups.forEach(d => erro("duplicado: " + d));
orfaos.forEach(o => erro("bicho orfao (nao existe no pool): " + o));
if (!falhas) console.log("  ok - sem rascunho, sem duplicata, sem bicho orfao");

const linha = (nome, s) => {
  const a = s.filter(e => e.lvl === 1).length;
  const b = s.filter(e => e.lvl <= 2).length;
  console.log(nome.padEnd(18) + String(a).padStart(5) + String(b).padStart(7) + String(s.length).padStart(9));
  return a;
};

console.log("\nbaralho".padEnd(19) + "facil  medio  dificil");
for (const [nome, , f] of DECKS) {
  const a = linha(nome, POOL.filter(f));
  if (a < MAX_JOGADORES) erro(nome + " no facil so tem " + a + " cartas (minimo " + MAX_JOGADORES + ")");
}

const uni = fns => POOL.filter(e => fns.some(f => f(e)));
const ATALHOS = [
  ["Tudo", DECKS.map(d => d[2])],
  ["So Brasil", DECKS.filter(d => d[1]).map(d => d[2])],
  ["So o mundo", DECKS.filter(d => !d[1]).map(d => d[2])],
  ["So ficcao", DECKS.slice(0, 9).map(d => d[2])],
  ["Gente real", DECKS.slice(9).map(d => d[2])],
];
console.log("\natalho".padEnd(19) + "facil  medio  dificil");
for (const [nome, fns] of ATALHOS) {
  const a = linha(nome, uni(fns));
  if (a < MAX_JOGADORES) erro("atalho " + nome + " no facil so tem " + a);
}

console.log("\n" + (falhas ? falhas + " falha(s)" : "tudo certo"));
process.exit(falhas ? 1 : 0);
