# Spec confirmada — ranking por sala vs. ranking geral

Status: **implementação em andamento.** Gerada via skill `/spec` (gstack, adaptado
ao formato dos outros `PROMPT-*.md` deste repo — sem a esteira de GitHub issue,
que este projeto não usa), a partir do pedido "quero um ranking separado pra
cada sala e outro geral da pontuação sua".

## Contexto verificado no código (não suposição)

| Peça pedida | Já existe? | Onde |
|---|---|---|
| Ranking geral da sua pontuação | **Sim, já pronto** | `s-pontuacao` (tela "Pontuação", acessível pela Home), aba "Ranking" (default) chama `CONTA.api.rankAmigos(uid)` — lê `perfis/{uid}` de você + amigos, ordena por `PONTOS.ordenarRank` (saldo → aproveitamento → vitórias). Também mostra seu saldo/aproveitamento/partidas/vitórias no topo (`pintarPontuacao`). |
| Ranking por sala | **Existe, mas com fórmula errada** | Aba "Classificação" do histórico da sala (`s-hist`, `calcClassificacao` em `quem-sou-eu-temas.html:2470`). Calcula `pontos = N - posicao + 1` por partida — a fórmula **antiga**, que o README (seção "Pontuação") diz explicitamente que foi substituída pelo `saldo` de `pontuacao.js` porque não somava zero (quem junta sempre a mesma turma pequena infla o próprio "pontos"). O ranking geral usa `saldo`/`aproveitamento`; o da sala usa outra coisa — os dois não são comparáveis. |

## O que muda

**Só uma capacidade** — o resto já está pronto:

### C1 — `calcClassificacao` reaproveita `pontuacao.js`, não reinventa a fórmula
`salas/{codigo}/hist/registro` já grava `resultados: [{id, nick, carta, posicao}]`
por partida — o mesmo formato que `rank-server.js` já transforma em pontos pra
gravar `perfis/{uid}`. Trocar `calcClassificacao` pra, por partida, montar
`ordem = [{id, chave: posicao}]` e chamar `PONTOS.pontuarPartida(ordem)`, depois
`PONTOS.agregar(todasAsPartidas)` pra consolidar — mesmas duas funções que
`rank-server.js` já usa pro rank geral. Zero fórmula nova, zero dado novo.

Saída passa de `{pontos, media}` pra `{saldo, aproveitamento}` — mesmo shape do
rank geral. `pintarHist` (aba Classificação) muda o texto de cada linha de
"N pts · média X" pra "+N de saldo · X% de aproveitamento", igual ao vocabulário
já usado na tela de Pontuação.

**Efeito colateral aceito:** `pontuacao.js` não era carregado dentro do sandbox
de `test-salas-ui.js` (só embutido no HTML de produção via `build.js`). Preciso
carregar o arquivo real no sandbox do teste também, senão o teste finge que
`PONTOS` existe sem provar nada.

**Aceite:** `test-salas-ui.js` — depois de 2 partidas na mesma sala com placares
diferentes, a aba Classificação mostra saldo que soma zero por partida (não
"pontos" crescente) e bate com o que `pontuacao.js` calcularia pra aquela mesma
`ordem`.

## Fora de escopo (porque já existe)

- Tela/rank geral entre amigos — não mexe, já está correto e é o padrão da
  tela de Pontuação.
- Qualquer navegação nova pra achar essas telas — "Pontuação" já é item da Home
  e "Classificação" já é aba do histórico da sala.
