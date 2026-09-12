# Spec — 3 correções pós-teste com 8 jogadores (anotações, cronômetro, remover jogador)

Status: **implementação concluída** na branch `claude/notepad-not-appearing-6janu2`.
Suíte `node test-tudo.js` verde (menos as 2 que dependem do módulo `firebase/firestore`
não instalado neste ambiente — falham antes e depois, sem relação com estas mudanças).
Cobertura nova: `test-salas.js` cenário "host remove jogador bugado"; `test-salas-ui.js`
anotações `rows=3` + classe `notas`; `test-css.js` painel `.sheet`.
Arquivo único: `quem-sou-eu-temas.html` (app inteiro). Regras: `firestore.rules`.

Origem: sessão de testes reais com 8 pessoas. Três dores relatadas pelo dono:

1. **"O chat não desce"** — com o gabarito dos 8 oponentes aberto, a tela não
   rola até as anotações; e as anotações, quando se escreve muito, "apagam"
   (na verdade some da caixa pequena de `rows=6`, que não cresce).
2. **Cronômetro não aparece.**
3. **Quando alguém buga, a partida não termina** — falta o host poder remover
   essa pessoa a qualquer momento.

## Contexto verificado no código (não suposição)

| Local | Estado atual confirmado |
|---|---|
| `#play-notas` (l. 734-738) | `textarea rows=6`, `flex:1`, `resize:vertical`. Não cresce com o conteúdo; some texto pra fora da caixa. |
| `carregarNotas` (l. 3825-3831) | Recarrega o valor do storage ao ENTRAR na tela. Pode sobrescrever se `entrando` virar true de novo (ex.: volta do histórico). |
| listener `input` (l. 3951-3960) | Salva no localStorage com debounce de 400 ms. |
| `#play-clock` (l. 708) + `atualizarPlayClock` (l. 1730-1738) | Relógio depende de `v.iniciadaEm`. `iniciadaEm` **só é gravado** na transição `revelando → jogando` (l. 2159), que exige `todos("revelou")`. Enquanto 1 pessoa não revela (ou bugou), `iniciadaEm` é null → relógio fica `hidden`. |
| `C.marcar` (l. 2052-2061) | Liga/desliga participante, **mas congela fora do lobby** (`fase() !== "lobby"` → no-op). Não serve pra remover no meio da partida. |
| `avaliarFase` / `todos()` (l. 2154-2166, 2248-2256) | Avanço de fase itera `participantesAtuais()`. **Se o pid sai de `participantes`, o jogo deixa de esperar por ele** e consegue terminar. |
| `firestore.rules` salas (l. 243-258) | `salas` update: só host. `salas/{c}/jogadores/{jid}` delete: `eu(jid) || souHostDa(codigo)` → **host já pode apagar o doc de qualquer jogador.** Nenhuma mudança de regra é necessária. |

## Capacidades

### A1 — Cronômetro visível durante a partida inteira
Desacoplar o relógio de `iniciadaEm`. Expor `partidaCriadaEm` no view-model
(`v.criadaEm`) e, em `atualizarPlayClock`, usar `base = v.iniciadaEm || v.criadaEm`.
Assim o relógio aparece já na revelação e continua se a fase travar em
`revelando` (alguém bugado). Para quem já acertou, congela em `meuAcertouEm - base`.
**Aceite:** com a partida em `revelando`, `#play-clock` fica visível e contando.

### A2 — Anotações que crescem, não perdem texto, e tela que rola
- **Auto-crescer:** tirar `flex:1` e `rows=6` fixos; `rows=3` inicial + JS
  `autoGrow()` que ajusta `height` ao `scrollHeight` a cada `input` e ao carregar.
  Teto de `~48vh`; passando disso, rola dentro da caixa (`overflow:auto`).
- **Botão "Expandir":** ao lado de "Suas anotações", alterna classe `.big`
  que sobe o teto pra `~78vh` — pra sessões de muita escrita.
- **Não apagar:** salvar no `input` sem depender só do debounce (grava já, o
  debounce vira reforço); e `carregarNotas` **nunca** sobrescreve se o textarea
  está com foco ou tem conteúdo diferente não-vazio digitado.
- **Rolagem:** remover `flex:1` do textarea faz a altura da tela virar
  content-driven; o `body`/`.app` (min-height:100dvh, sem overflow travado)
  rola naturalmente até placar/anotações. Nada de altura fixa.
**Aceite:** com 8 oponentes abertos, dá pra rolar até as anotações; escrever
várias linhas faz a caixa crescer; trocar de tela e voltar não perde o texto.

### A3 — Host remove jogador a qualquer momento (2 opções)
Dois backends novos no controlador da sala:
- `C.removerDaPartida(id)` — host tira `id` de `participantes` (update sala).
  A pessoa vira espectadora; o jogo para de esperá-la e consegue fechar.
  Vale em `revelando`/`jogando`/`fim`; bloqueia remover o próprio host.
- `C.expulsar(id)` — além de sair de `participantes`, apaga
  `salas/{c}/jogadores/{id}` (regra já permite ao host). A pessoa é mandada
  pra Home no aparelho dela (detecção: `SC` ativo mas `meuId` sumiu da lista).
UI: nas linhas de `#play-oponentes`, quando `v.souHost`, um botão "Remover"
abre **inline** duas opções — "Só desta partida" e "Expulsar da sala" — mais
"Cancelar". Sem modal novo; usa `toast()` pra confirmar.
**Aceite:** host remove um bugado no meio da partida e ela termina; expulsar
manda a pessoa pra Home.

## Fora de escopo
Não mexer no fluxo de login, na pontuação/rank, nem nas Cloud Functions.
Não alterar `firestore.rules` (host já tem as permissões necessárias).
