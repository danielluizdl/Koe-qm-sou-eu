/* Regras de CSS que a suíte de interface NÃO consegue ver.

   Um stub de DOM em JavaScript checa a propriedade `hidden` e conclui
   que o elemento sumiu. No navegador não é assim: `hidden` só esconde
   porque a folha do NAVEGADOR diz `[hidden]{display:none}` — e qualquer
   regra da folha do AUTOR que declare `display` vence essa, porque
   autor ganha de navegador, sem olhar especificidade.

   Foi exatamente o que aconteceu: `.btn{display:flex}` fazia todo botão
   com `hidden` continuar visível. Os quatro botões apareciam na home e
   as telas de entrar e cadastrar se empilhavam. A suíte de cliques
   passava, porque para ela o `hidden` estava certinho.

   Este arquivo lê o CSS como texto e verifica o que o DOM simulado é
   cego para enxergar.

   node test-css.js */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(
  path.join(__dirname, process.env.JOGO_SRC || "quem-sou-eu-temas.html"), "utf8");
const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));

let ok = 0; const falhas = [];
function t(nome, cond, extra){
  if (cond) ok++; else falhas.push(nome + (extra ? " — " + extra : ""));
}

/* ---- 1. existe a regra que devolve sentido ao hidden ---- */
const temRegraHidden = /\[hidden\]\s*\{[^}]*display\s*:\s*none[^}]*!important/i.test(css);
t("existe [hidden]{display:none !important}", temRegraHidden,
  "sem ela, hidden não esconde nada que tenha display no CSS");

/* ---- 2. quais classes declaram display ---- */
const classesComDisplay = new Set();
const reRegra = /([^{}]+)\{([^}]*)\}/g;
let m;
while ((m = reRegra.exec(css))){
  const seletor = m[1], corpo = m[2];
  if (!/(^|[;\s])display\s*:/.test(corpo)) continue;
  const reClasse = /\.([A-Za-z][\w-]*)/g;
  let c;
  while ((c = reClasse.exec(seletor))) classesComDisplay.add(c[1]);
}
t("o CSS realmente tem classes com display", classesComDisplay.size > 0,
  [...classesComDisplay].join(","));

/* ---- 3. todo elemento com hidden no HTML ---- */
const corpo = html.slice(html.indexOf("</style>"));
const comHidden = [];
const reTag = /<(\w+)([^>]*\bhidden\b[^>]*)>/g;
while ((m = reTag.exec(corpo))){
  const attrs = m[2];
  const id = (attrs.match(/id="([^"]+)"/) || [])[1] || "(sem id)";
  const cls = (attrs.match(/class="([^"]+)"/) || [])[1] || "";
  comHidden.push({ tag: m[1], id, classes: cls.split(/\s+/).filter(Boolean) });
}
t("há elementos usando hidden no HTML", comHidden.length > 0, String(comHidden.length));

/* ---- 4. quantos deles seriam invisíveis SEM a regra ---- */
const emRisco = comHidden.filter(e => e.classes.some(c => classesComDisplay.has(c)));
console.log("\nelementos com hidden: " + comHidden.length +
            " · dependeriam da regra: " + emRisco.length);
if (emRisco.length){
  const porClasse = {};
  emRisco.forEach(e => {
    e.classes.filter(c => classesComDisplay.has(c)).forEach(c => {
      (porClasse[c] = porClasse[c] || []).push(e.id);
    });
  });
  Object.keys(porClasse).sort().forEach(c => {
    console.log("  ." + c + "  →  " + porClasse[c].slice(0, 6).join(", ") +
                (porClasse[c].length > 6 ? " …(+" + (porClasse[c].length - 6) + ")" : ""));
  });
}

/* A regra tem que existir justamente porque há elementos em risco.
   Se um dia não houver nenhum, a regra continua barata e correta. */
t("a regra cobre os elementos em risco", !emRisco.length || temRegraHidden,
  emRisco.length + " elementos ficariam visíveis sem ela");

/* ---- 5. ninguém pode declarar display num seletor [hidden] depois ---- */
const depoisDaRegra = css.slice(css.search(/\[hidden\]/));
t("nada redefine display de [hidden] depois",
  (depoisDaRegra.match(/\[hidden\][^{]*\{[^}]*display/g) || []).length === 1);

/* ---- 6. as telas continuam controladas por classe, não por hidden ---- */
t("telas usam .screen/.on, não hidden",
  /\.screen\s*\{[^}]*display\s*:\s*none/.test(css) &&
  /\.screen\.on\s*\{[^}]*display\s*:\s*flex/.test(css));

console.log("\ncss · " + ok + " passaram, " + falhas.length + " falharam");
if (falhas.length){ falhas.forEach(f => console.log("  x " + f)); process.exit(1); }
