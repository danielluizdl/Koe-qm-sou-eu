/* Monta public/index.html a partir das fontes. Concatenação, não
   bundler: sem transpilação, sem node_modules no resultado, sem
   sourcemap. O jogo continua sendo ES5 legível no navegador.

   Existe porque quem-sou-eu-temas.html está no formato de Artifact —
   começa em <title>, sem <!doctype>/<html>/<head>/<body>, porque a
   plataforma envolvia. Servindo por conta própria, o invólucro é nosso.

   node build.js */
const fs = require("fs");
const path = require("path");

const RAIZ = __dirname;
const SAIDA = path.join(RAIZ, "public");
const JOGO = process.env.JOGO_SRC || "quem-sou-eu-temas.html";

/* --stage-functions: copia as fontes compartilhadas pra dentro de
   functions/ antes do deploy da Cloud Function (o deploy só sobe esse
   diretório). Roda pelo predeploy em firebase.json. Não toca no site. */
if (process.argv.indexOf("--stage-functions") >= 0){
  const DEST = path.join(RAIZ, "functions");
  ["rank-server.js", "pontuacao.js"].forEach(function(f){
    fs.copyFileSync(path.join(RAIZ, f), path.join(DEST, f));
    console.log("functions/" + f + "  (cópia de ../" + f + ")");
  });
  process.exit(0);
}

/* Ordem importa: o jogo lê window.QSE_FIREBASE na hora em que roda,
   então o boot precisa ter definido antes. */
const SCRIPTS = [
  "pontuacao.js",
  "firestore-adapter.js",
  "contas.js",
  "firebase-config.js",
  "firebase-boot.js"
];

/* SEM_BOOT=1 gera uma pagina identica, menos o bootstrap do Firebase.
   Serve pro teste de navegador: sem ela, firebase-boot.js sobrescreve
   window.QSE_FIREBASE e o teste acaba falando com o Firebase de
   verdade, medindo a tela antes de a rede responder. */
const SEM_BOOT = !!process.env.SEM_BOOT;
const SAIDA_NOME = SEM_BOOT ? "index-teste.html" : "index.html";
const USADOS = SEM_BOOT ? SCRIPTS.filter(f => f !== "firebase-boot.js") : SCRIPTS;

function ler(f){ return fs.readFileSync(path.join(RAIZ, f), "utf8"); }

/* Um bloco de script termina no PRIMEIRO fechamento literal, mesmo
   dentro de string ou comentário — o parser de HTML não sabe o que é
   JavaScript. Um arquivo que contenha essa sequência cortaria o script
   no meio e o resto viraria texto na página, sem erro nenhum no
   console. Vale falhar aqui em vez de descobrir no ar. */
function conferirEmbutivel(f, texto){
  const i = texto.indexOf("</" + "script");
  if (i < 0) return;
  const linha = texto.slice(0, i).split("\n").length;
  throw new Error(
    f + ":" + linha + " contém um fechamento literal de script e cortaria a " +
    "página ao ser embutido. Quebre a string (\"</\" + \"script>\") ou " +
    "reescreva o comentário."
  );
}

const jogo = ler(JOGO);

/* O <title> do arquivo do jogo vira o <title> do documento. */
const mTitulo = jogo.match(/<title>([\s\S]*?)<\/title>/i);
const titulo = mTitulo ? mTitulo[1].trim() : "Quem Sou Eu";
const corpo = mTitulo ? jogo.replace(mTitulo[0], "") : jogo;

const embutidos = USADOS.map(function(f){
  const texto = ler(f);
  conferirEmbutivel(f, texto);
  return "<!-- " + f + " -->\n<script>\n" + texto + "\n</" + "script>";
}).join("\n");

const doc = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="description" content="Jogo de adivinhar quem você é. Para jogar com os amigos, na mesma mesa.">
<meta name="theme-color" content="#EAEEE3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121A14" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.webmanifest">
<title>${titulo}</title>
</head>
<body>
${embutidos}
${corpo}
</body>
</html>
`;

const manifest = {
  name: "Quem Sou Eu",
  short_name: "Quem Sou Eu",
  start_url: ".",
  display: "standalone",
  orientation: "portrait",
  background_color: "#EAEEE3",
  theme_color: "#EAEEE3",
  lang: "pt-BR",
  description: "Jogo de adivinhar quem você é. Para jogar com os amigos, na mesma mesa."
};

fs.mkdirSync(SAIDA, { recursive: true });
fs.writeFileSync(path.join(SAIDA, SAIDA_NOME), doc, "utf8");
fs.writeFileSync(path.join(SAIDA, "manifest.webmanifest"),
                 JSON.stringify(manifest, null, 2), "utf8");

const kb = n => (n / 1024).toFixed(1) + " KB";
console.log("public/" + SAIDA_NOME + "  " + kb(Buffer.byteLength(doc)));
USADOS.forEach(f => console.log("  + " + f.padEnd(24) + kb(Buffer.byteLength(ler(f)))));
console.log("  + " + JOGO.padEnd(24) + kb(Buffer.byteLength(jogo)));
console.log("public/manifest.webmanifest");
