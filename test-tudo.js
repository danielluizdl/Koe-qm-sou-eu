/* Roda a bateria inteira contra quem-sou-eu-temas.html — a versão atual.
   O suite de salas roda nos DOIS backends.
   node test-tudo.js */
const { execFileSync } = require("child_process");

const suites = [
  ["baralho e código de 7 chars",  "test.js",                   {}],
  ["salas — backend capability",   "test-salas.js",             {}],
  ["salas — backend firestore",    "test-salas.js",             { DB: "firestore" }],
  ["pontuação",                    "test-pontuacao.js",         {}],
  ["adaptador firestore",          "test-firestore-adapter.js", {}],
  ["contas — backend capability",  "test-contas.js",            {}],
  ["contas — backend firestore",   "test-contas.js",            { DB: "firestore" }],
  ["adaptador vs SDK real",        "test-sdk-real.js",          {}],
  ["auditoria do baralho",         "audit.js",                  {}]
];

/* Cobertura que existe mas não vale mais.
   Estas duas descrevem o Modo Mesa da versão ANTIGA, em que o código de
   5 dígitos carregava uma máscara livre dos 16 baralhos. Na versão atual
   ele carrega o índice de um dos 21 temas — outro formato, outra tela.
   O código está certo; os testes é que envelheceram.

   Ficam listadas em vez de escondidas: suite verde que testa arquivo que
   a gente não publica mais mente mais do que suite vermelha. */
const pendentes = [
  ["modo mesa",         "test-mesa.js",
   "escrita para a máscara livre de 16 baralhos; hoje o código guarda um tema"],
  ["salas — interface", "test-salas-ui.js",
   "um cenário (grade dos 16 baralhos) virou a grade de 21 temas"]
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

console.log("");
for (const [nome, arquivo, motivo] of pendentes){
  console.log("  --     " + nome + "  (obsoleta: " + motivo + ")");
  console.log("         para rodar contra a versão que ela descreve:");
  console.log("         JOGO=/quem-sou-eu-online.html node " + arquivo);
}

console.log(falhou ? "\n" + falhou + " suite(s) falharam"
                   : "\ntudo que está em dia passou · " + pendentes.length + " suite(s) a reescrever");
process.exit(falhou ? 1 : 0);
