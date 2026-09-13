# Bug confirmado e CORRIGIDO — ranking geral falhava pra quem não terminava em 1º ou último

Status: **corrigido, testado e implantado em produção (2026-09-12).**
Encontrado durante o QA de produção do zero
(`PROMPT-qa-producao-do-zero.md`), com 10 contas reais jogando partidas de
verdade em `quem-sou-eu-e3e32`, isolado no emulador (sem tocar produção)
e, depois de aprovado pelo dono, corrigido, coberto por teste de
regressão e verificado de novo em produção real com 3 contas.

## O sintoma

Numa partida de 3 ou mais jogadores, `contas.js#registrarResultado` — que
grava `usuarios/{uid}/partidas/{pid}` e soma no agregado de
`perfis/{uid}` (a tela "Pontuação") — só é aceito pelo Firestore pra quem
terminou em **1º lugar ou em último**. Todo mundo no meio da tabela é
negado. Como a chamada é "melhor esforço" (`contas.js:572-596`, comentário
"resolve false sem propagar erro"), isso acontece **em silêncio**: o
jogador não vê erro nenhum, só nunca ganha o ponto.

O ranking **por sala** (aba "Classificação" do histórico) não é afetado —
é calculado 100% no cliente a partir de `salas/{codigo}/hist/registro`,
sem passar pela regra que tem o bug.

## Causa raiz — confirmada, `firestore.rules:171-172`

```
match /partidas/{pid} {
  allow create: if eu(uid)
                && campos().pid == pid
                ...
                && campos().aproveitamento >= (campos().n - campos().posicao) / (campos().n - 1) - 0.0001
                && campos().aproveitamento <= (campos().n - campos().posicao) / (campos().n - 1) + 0.0001
                && resultadoBateComHist(...);
```

`campos().n` e `campos().posicao` são exigidos `int` pelas cláusulas
anteriores da mesma regra. No CEL (a linguagem das Firestore Rules),
**dividir `int` por `int` trunca** — não promove pra float. Então
`(n - posicao) / (n - 1)` dá **0** sempre que o resultado matemático real
está entre 0 e 1 (exclusive), ou seja: sempre que a posição não é a 1ª
nem a última.

- Limite inferior (`>=`) nunca pega o bug: `0 - 0.0001` é sempre menor que
  qualquer aproveitamento real positivo.
- Limite superior (`<=`) é onde quebra: `aproveitamento <= 0 + 0.0001`
  falha pra qualquer aproveitamento real acima de ~0.0001 — ou seja, pra
  toda posição do meio.

## Evidência

**Em produção** (10 contas reais, `n=5/6/10`, valores computados pela
mesma `pontuacao.js` que o produto usa): toda posição do meio negada com
`permission-denied`; só posição 1 e posição N passaram. Repetido em 3
salas diferentes, 2 partidas cada — mesmo padrão sempre.

**Isolado no emulador** (`repro-bug-aproveitamento.js`, não toca
produção — `npx firebase emulators:exec --only firestore --project
demo-quem-sou-eu "node repro-bug-aproveitamento.js"`):

```
bia, posicao=1 de 3 (extremo, valores corretos): SUCESSO
zeca, posicao=3 de 3 (extremo, valores corretos): SUCESSO
ana, posicao=2 de 3 (MEIO, valores matematicamente corretos): NEGADO
```

**Bisecção cláusula por cláusula** da mesma regra (script descartado
depois de confirmar, não deixado no repo) mostrou a condição virando
falsa exatamente na cláusula do limite superior do `aproveitamento` — as
outras 10 cláusulas (incluindo `resultadoBateComHist`) passam.

## Por que `test-regras.js` não pegou isso

A suíte existente (`test-regras.js:125-146`) só testa partidas com
**n=2**. Com 2 jogadores, toda posição já é extrema (1º ou 2º) — a
posição do meio, onde o bug vive, nunca é exercitada.

## Reclassificação da "pendência 1" da sessão anterior

A pendência registrada como "avaliação de dificuldade não registrada ao
reconectar numa sala" (ver memória do projeto,
`quem-sou-eu-ranking-geral-opcao-b`) é quase certamente **este mesmo
bug**, não um problema de reconexão ou de `localStorage`: o jogador que
reconectou tinha terminado no meio da tabela naquela partida. Isolar por
processo Node separado (sem `localStorage` cruzado) não fez o sintoma
sumir — porque a causa nunca foi o método de teste.

## Correção aplicada

Forçada divisão em ponto flutuante nas duas ocorrências
(`firestore.rules:171-172`), trocando `campos().n - 1` por
`campos().n - 1.0` — o literal `1.0` força o CEL a tratar a divisão como
float:

```
&& campos().aproveitamento >= (campos().n - campos().posicao) / (campos().n - 1.0) - 0.0001
&& campos().aproveitamento <= (campos().n - campos().posicao) / (campos().n - 1.0) + 0.0001
```

**Verificação, nessa ordem** (seguindo a prática do projeto de sempre
quebrar o fix e ver o teste falhar antes de confiar nele):
1. Regra revertida temporariamente → `npm run test:regras` → o novo
   teste de regressão falhou sozinho (93 passaram, 1 falhou — só o novo).
2. Regra corrigida de novo → `npm run test:regras` → 94 passaram, 0
   falharam.
3. `npm test` completo → as 15 suítes de sempre continuam passando.
4. Deploy: `npx firebase deploy --only firestore:rules --project quem-sou-eu-e3e32`.
5. Verificação final em **produção real** (3 contas novas, 1 partida de
   verdade, jogador do meio): `registrarResultado` retornou sucesso e o
   perfil mostrou `partidas:1` — as 3 contas de verificação foram
   apagadas depois.

## Impacto se não for corrigido

Qualquer sala com 3+ jogadores — o caso comum do jogo — deixa a maioria
dos jogadores sem o próprio resultado contabilizado no ranking geral
(`perfis/{uid}`, tela "Pontuação"). Só quem ganha ou quem fica em último
vê o próprio placar evoluir. Isso é silencioso: não aparece erro nenhum
pro jogador nem no console em produção (só nos logs internos do SDK).

## Teste de regressão adicionado

`test-regras.js` ganhou um 3º jogador (`zeca`) e um segundo item de hist
(`p-meio`, n=3) só pra isso: `"dono cria partida com posição do MEIO da
tabela (n=3, nem 1º nem último)"` — `n:3, posicao:2, saldo:0,
aproveitamento:0.5`, `assertSucceeds`. Roda toda vez que `npm run
test:regras` rodar — essa classe de bug não passa mais despercebida.

## Arquivos de referência

| Arquivo | Papel |
|---|---|
| `firestore.rules:171-172` | A causa raiz |
| `contas.js:572-596` (`registrarResultado`) | Onde a escrita nega e o erro é engolido |
| `test-regras.js:125-146` | Suíte existente, só cobre n=2 — o buraco de cobertura |
| `repro-bug-aproveitamento.js` | Repro mínimo no emulador, pronto pra validar a correção |
| `PROMPT-qa-producao-do-zero.md` | Spec do QA que achou isso |

## Related

- `[[quem-sou-eu-ranking-geral-opcao-b]]` — origem da "pendência 1" que este documento reclassifica
