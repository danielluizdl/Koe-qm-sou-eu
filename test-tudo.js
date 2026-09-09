/* Roda a bateria inteira contra quem-sou-eu-temas.html — a versão atual.
   O suite de salas e o de contas rodam nos DOIS backends.

   As regras de segurança ficam de fora daqui porque precisam do emulador
   (Java + firebase-tools) e demoram: npm run test:regras.

   node test-tudo.js */
const { execFileSync } = require("child_process");

const suites = [
  ["baralho e código de 7 chars",  "test.js",                   {}],
  ["modo mesa",                    "test-mesa.js",              {}],
  ["salas — backend capability",   "test-salas.js",             {}],
  ["salas — backend firestore",    "test-salas.js",             { DB: "firestore" }],
  ["salas — interface",            "test-salas-ui.js",          {}],
  ["conta e amigos — interface",   "test-conta-ui.js",          {}],
  ["pontuação",                    "test-pontuacao.js",         {}],
  ["adaptador firestore",          "test-firestore-adapter.js", {}],
  ["contas — backend capability",  "test-contas.js",            {}],
  ["contas — backend firestore",   "test-contas.js",            { DB: "firestore" }],
  ["adaptador vs SDK real",        "test-sdk-real.js",          {}],
  ["auditoria do baralho",         "audit.js",                  {}]
];

let falhou = 0;
for (const [nome, arquivo, env] of suites){
  let saida = "", erro = null;
  try {
    saida = execFileSync(process.execPath, [arquivo], {
      cwd: __dirname, encoding: "utf8",
      env: Object.assign({}, process.env, env)
    });
  } catch (e) {
    erro = e; saida = (e.stdout || "") + (e.stderr || "");
    falhou++;
  }
  console.log((erro ? " FALHA " : "  ok   ") + nome);
  if (erro) console.log(saida.split("\n").map(l => "         " + l).join("\n"));
}

console.log(falhou ? "\n" + falhou + " suite(s) falharam" : "\ntudo passou");
console.log("regras de segurança: npm run test:regras (precisa do emulador)");
process.exit(falhou ? 1 : 0);
