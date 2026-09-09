/* Propriedades que o sistema de pontuação precisa garantir.
   node test-pontuacao.js */
const P = require("./pontuacao.js");

let ok = 0, falhas = [];
function t(nome, cond, extra){
  if (cond) ok++;
  else falhas.push(nome + (extra ? " — " + extra : ""));
}
const quase = (a, b) => Math.abs(a - b) < 1e-9;
const ordemSimples = n => Array.from({length:n}, (_, i) => ({ id:"j"+i, chave:i }));

/* 1. Soma zero: ninguém cria ponto do nada, em qualquer N. */
for (let n = 2; n <= 8; n++){
  const soma = P.pontuarPartida(ordemSimples(n)).reduce((s, r) => s + r.saldo, 0);
  t(`soma zero com ${n} jogadores`, quase(soma, 0), `deu ${soma}`);
}

/* 2. Ganhar de mais gente vale mais. */
const vitorias = [];
for (let n = 2; n <= 8; n++) vitorias.push(P.pontuarPartida(ordemSimples(n))[0].saldo);
t("vitória escala com o tamanho da mesa",
  vitorias.every((v, i) => i === 0 || v > vitorias[i-1]), vitorias.join(","));
t("vitória com 2 vale +1", vitorias[0] === 1, String(vitorias[0]));
t("vitória com 8 vale +7", vitorias[6] === 7, String(vitorias[6]));

/* 3. Simetria: o último perde exatamente o que o primeiro ganha. */
for (let n = 2; n <= 8; n++){
  const r = P.pontuarPartida(ordemSimples(n));
  t(`simetria com ${n}`, quase(r[0].saldo, -r[n-1].saldo));
}

/* 4. Perder feio numa mesa grande custa caro, mas ficar no meio é neutro. */
const oito = P.pontuarPartida(ordemSimples(8));
t("saldos de 8 são 7,5,3,1,-1,-3,-5,-7",
  oito.map(r => r.saldo).join(",") === "7,5,3,1,-1,-3,-5,-7",
  oito.map(r => r.saldo).join(","));
const sete = P.pontuarPartida(ordemSimples(7));
t("com 7, o 4º lugar zera", quase(sete[3].saldo, 0), String(sete[3].saldo));

/* 5. Aproveitamento não depende de N: ganhar é 100%, perder é 0%. */
for (let n = 2; n <= 8; n++){
  const r = P.pontuarPartida(ordemSimples(n));
  t(`aproveitamento do 1º com ${n} é 1`, quase(r[0].aproveitamento, 1));
  t(`aproveitamento do último com ${n} é 0`, quase(r[n-1].aproveitamento, 0));
  const media = r.reduce((s, x) => s + x.aproveitamento, 0) / n;
  t(`aproveitamento médio com ${n} é .5`, quase(media, 0.5), String(media));
}

/* 6. A conversa original: 3 jogadores, 1/3 de chance, quem ganha faz 100%. */
const tres = P.pontuarPartida(ordemSimples(3));
t("com 3, o vencedor faz 100%", quase(tres[0].aproveitamento, 1));
t("com 3, o último faz 0%", quase(tres[2].aproveitamento, 0));
t("com 3, o do meio faz 50%", quase(tres[1].aproveitamento, 0.5));

/* 7. Empates dividem a posição e preservam a soma zero.
      Caso real: numa mesa de 5, dois adivinham e três não. */
const comEmpate = P.pontuarPartida([
  { id:"a", chave:1 }, { id:"b", chave:2 },
  { id:"c", chave:"nao" }, { id:"d", chave:"nao" }, { id:"e", chave:"nao" }
]);
t("empate soma zero", quase(comEmpate.reduce((s,r)=>s+r.saldo,0), 0));
t("os três empatados têm o mesmo saldo",
  quase(comEmpate[2].saldo, comEmpate[3].saldo) && quase(comEmpate[3].saldo, comEmpate[4].saldo));
t("os empatados ficam na posição 4", quase(comEmpate[2].posicao, 4), String(comEmpate[2].posicao));
t("mesa toda empatada zera todo mundo",
  P.pontuarPartida([{id:"a",chave:"x"},{id:"b",chave:"x"},{id:"c",chave:"x"}])
   .every(r => quase(r.saldo, 0)));

/* 8. Compatibilidade com a fórmula antiga (N-P+1), só recentrada. */
for (let n = 2; n <= 8; n++){
  const r = P.pontuarPartida(ordemSimples(n));
  t(`saldo = 2*(antigo) - (N+1) com ${n}`,
    r.every((x, i) => quase(x.saldo, 2 * (n - (i+1) + 1) - (n + 1))));
}

/* 9. Agregação de perfil. Quem ganha sempre sobe; quem sempre perde desce. */
const historico = [
  P.pontuarPartida([{id:"ana",chave:1},{id:"bia",chave:2},{id:"caio",chave:3}]),
  P.pontuarPartida([{id:"ana",chave:1},{id:"bia",chave:2},{id:"caio",chave:3}]),
  P.pontuarPartida([{id:"bia",chave:1},{id:"ana",chave:2},{id:"caio",chave:3}])
];
const rank = P.agregar(historico);
t("ana lidera", rank[0].id === "ana", rank.map(r=>r.id+":"+r.saldo).join(" "));
t("caio é o lanterna", rank[2].id === "caio");
t("ana tem 2 vitórias", rank[0].vitorias === 2);
t("caio tem saldo -6", rank[2].saldo === -6, String(rank[2].saldo));
t("caio tem 0% de aproveitamento", quase(rank[2].aproveitamento, 0));
t("todos com 3 partidas", rank.every(r => r.partidas === 3));
t("soma dos saldos do grupo é zero", quase(rank.reduce((s,r)=>s+r.saldo,0), 0));

/* 10. Consistência desempata quem tem o mesmo saldo. */
const desempate = P.agregar([
  P.pontuarPartida([{id:"x",chave:1},{id:"y",chave:2},{id:"z",chave:3}]),
  P.pontuarPartida([{id:"z",chave:1},{id:"x",chave:2},{id:"y",chave:3}]),
  P.pontuarPartida([{id:"y",chave:1},{id:"z",chave:2},{id:"x",chave:3}])
]);
t("rodízio perfeito zera todo mundo", desempate.every(r => quase(r.saldo, 0)));
t("rodízio dá 50% pra todo mundo", desempate.every(r => quase(r.aproveitamento, 0.5)));

console.log(`\n${ok} passaram, ${falhas.length} falharam`);
if (falhas.length){ falhas.forEach(f => console.log("  ✗ " + f)); process.exit(1); }

/* Tabela pro README */
console.log("\nSaldo por colocação:\n");
let cab = "  N |";
for (let p = 1; p <= 8; p++) cab += String(p + "º").padStart(5);
console.log(cab + "\n  " + "-".repeat(cab.length - 2));
for (let n = 2; n <= 8; n++){
  let l = "  " + n + " |";
  for (let p = 1; p <= 8; p++) l += (p <= n ? (P.saldo(n,p) > 0 ? "+" : "") + P.saldo(n,p) : "·").padStart(5);
  console.log(l);
}
