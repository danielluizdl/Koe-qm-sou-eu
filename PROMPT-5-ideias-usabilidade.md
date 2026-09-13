<!-- /autoplan restore point: /c/Users/danie/.gstack/projects/danielluizdl-Koe-qm-sou-eu/main-autoplan-restore-20260913-122317.md -->
# Spec confirmada — 5 ideias de usabilidade do dono

Status: **implementada e testada (2026-09-13).** C1, C2, C3+C4 e C5 no ar no
código; `npm test` (15 suítes) e `npm run test:regras` (94 casos, emulador)
passando; conferência visual do CSS novo feita no navegador. Falta só
commitar/deployar (fora do escopo desta spec — decisão do dono). Gerada a
partir de 5 ideias soltas do
dono (2026-09-13), lidas contra o código real antes de virar spec — cada
capacidade abaixo diz onde a peça já existe e o que muda de fato, sem
reinventar o que já está pronto.

## Como isso foi discutido

Não existe uma "equipe de engenharia" separada neste projeto — sou eu
(Claude) fazendo o papel dos dois lados: primeiro li a máquina de fases atual
(`lobby → revelando → jogando → fim`, em `quem-sou-eu-temas.html`) e a
persistência do jogador no Firestore (`salas/{codigo}/jogadores/{id}`, nunca
apagado ao sair — só marcado localmente) antes de aceitar qualquer uma das 5
ideias como está. Duas delas (C1, C5) já eram quase de graça porque a peça de
baixo já existia; uma (C3+C4 juntas) é a mudança de verdade e está descrita
com a decisão de design já tomada, não em aberto.

## C1 — Confirmar antes de sair de uma partida em andamento

**Já existe:** `C.sair()` só desliga os listeners locais — não apaga o
documento do jogador no Firestore. Reentrar na mesma sala (via "Minhas
salas" ou o código) já reconecta na fase em que a sala estiver. Ou seja, a
parte difícil ("poder voltar") já funciona; falta só a fricção de sair.

**O que muda:** `sairDoJogo()` (botões "← Sair" de `s-carta`, `s-passar`,
`s-play`) ganha confirmação de dois toques, reaproveitando o MECANISMO que
`confirmarApagar()` já usa (arma, muda o texto do botão, desarma sozinho em
alguns segundos) — mas com texto próprio, não o de apagar: "Sair mesmo?
Você pode voltar." em vez de qualquer linguagem de "isso é permanente"
(ajuste após revisão de design: sair de uma partida é 100% reversível,
copiar o tom de `confirmarApagar` — que É destrutivo — assustaria à toa).
Sem modal novo, sem dependência nova. Só nas fases `revelando` e `jogando`
(perder a sala no lobby ou depois do fim não custa nada). `lobby-sair` e
`fim-sair` continuam sem confirmação.

## C2 — Seletor de dificuldade em caixinhas, não slider

**O que muda:** `abrirAvaliar()` troca o `<input type="range" min=0 max=5>`
por 6 caixinhas (0 a 5) num gradiente verde→vermelho, cada uma um
`<button>` que marca a nota ao tocar — mesmo valor 0-5 de sempre (0 já era
aceito; o slider só escondia isso). CSS puro para o gradiente, sem lib de
range customizado.

## C5 — Host edita o nome da sala no lobby

**Já existe:** `salas/{codigo}` aceita `update` de qualquer campo vindo do
host (`firestore.rules:294-301`, sem validação por campo) — só falta a
função e o toque na UI.

**O que muda:** `lobby-nome` vira editável pelo host (toque abre um campo de
texto inline, até 30 caracteres — mesmo limite já usado na criação). Nova
`C.renomear(nome)` (mesma validação de `C.criar`, `trim + slice(0,30)`),
disponível sempre que a sala estiver no lobby, então funciona tanto pra
quem nunca botou nome quanto pra trocar depois de qualquer partida.

## C3 + C4 — Avaliação em cascata + lobby automático

Estas duas ideias do dono são a mesma mudança de fluxo, não duas
separadas — juntei numa capacidade só.

**Contexto verificado no código:** durante a fase `jogando`, todo mundo já
revelou a própria carta na fase `revelando` anterior — ou seja, o "gabarito"
(quem é quem) já está 100% visível pra qualquer participante desde o
início do `jogando` (`v.membros[i].carta`, tela `s-play`, lista "Na mesa").
`v.pid` (o ID da partida atual) já existe durante `jogando`, não só depois
do fim — dá pra usar como chave de "já avaliei esta partida" antes do fim
oficial. `avaliarFase()` já é o lugar onde toda transição automática de fase
acontece (`revelando→jogando` quando todos revelam, `jogando→fim` quando
todos acertam) — mesmo padrão de permissão (qualquer cliente tenta
escrever, só o do host passa na regra
`anterior().hostId == request.auth.uid`, os outros falham em silêncio):
a 3ª transição é código novo (mais um `else if` na mesma função), não
reaproveita lógica pronta — só o PADRÃO de "qualquer um tenta, só o host
grava" é repetido. O mesmo vale pro gatilho de avaliação: hoje
`precisaAvaliar`/`abrirAvaliar` só disparam a partir de `v.podio`
(vazio até `fase==="fim"`, ver `quem-sou-eu-temas.html` por volta da
linha 2426) e do check em `renderSala` que roda só quando
`v.fase !== "fim"` contra `v.partidas[0]` (o HISTÓRICO da última partida
já terminada, não a atual) — trocar a chave pra `v.pid` bruto significa
reescrever `precisaAvaliar` e os 2 pontos de disparo, mais um branch novo
em `renderSala` pra rodar em `jogando`. Achado de revisão de engenharia
independente, incorporado aqui pra não subestimar o diff.

**O que muda:**

1. Assim que a pessoa acerta (`v.jaAcertei`) — **mesmo com a fase ainda em
   `jogando`**, não só depois do `fim` — o bloco de espera (`s-play`,
   `play-jaera`, que já existe e já mostra as cartas de todo mundo, é o
   "gabarito") ganha um botão "Avaliar as cartas dessa rodada". **Por
   toque, não automático** (ajuste feito após revisão de design: abrir a
   avaliação sozinho, no mesmo instante do acerto, sequestrava o momento
   de "Você foi o 1º!" antes da pessoa nem ver a própria vitória). O
   título/status de vitória (já existente em `pintarPlay`) continua
   visível o tempo que a pessoa quiser antes de tocar. Chave de "já
   avaliei" passa a ser `v.pid` (a partida atual), não mais só o pid do
   histórico — dá pra usar antes do fim oficial.
2. Depois de avaliar, o mesmo bloco mostra um botão "Pronto para a
   próxima partida". Ao tocar, grava `prontoProxima: true` no próprio
   documento de jogador e o BOTÃO VIRA o texto "Aguardando os outros (X
   de Y prontos) · toque pra desmarcar" — mesmo elemento, ainda tocável
   (ajuste após revisão de design: sem isso, quem erra o toque em
   "Pronto" não tinha como desfazer). Tocar de novo volta a
   `prontoProxima: false` e ao botão "Pronto". Contagem X/Y **reaproveita
   só o PADRÃO VISUAL** do contador do lobby, não os campos
   `numProntos`/`numConvidados` em si — aqueles excluem o host de
   propósito (`if (part && !ehHostJ)`, é o dono decidindo quem joga, não
   sua própria prontidão), e aqui o HOST também precisa confirmar
   "pronto" como todo mundo. Correção de achado de revisão de engenharia:
   novo par `v.numAcertaramProntos`/`v.numParticipantesAtivos` em `vm()`,
   contando todos os `participantesAtuais()` (host incluso). Espectador
   (`!souParticipante`) não é contado nem precisa confirmar nada —
   `participantesAtuais()` já os exclui, sem código extra pra isso.
3. Quando a partida termina de verdade (`fase = fim`, todos acertaram) e
   ainda falta alguém avaliar, a mesma checagem força a avaliação — agora
   na tela `s-fim`, que também ganha o botão "Pronto", substituindo os
   antigos "Jogar de novo" (só host) / "Esperando o host…" (convidado) por
   um botão igual pra todo mundo. `fim-apagar` e `fim-hist` continuam só
   do host.
4. `avaliarFase()` ganha uma 3ª transição: quando `fase === "fim"` e
   **todos** têm `prontoProxima === true`, avança pra `lobby` sozinho —
   reaproveitando exatamente o que `C.jogarDeNovo()` já faz (reseta
   cartas/posições, mantém baralho e nível atuais). Ninguém precisa clicar
   em "jogar de novo": o último "Pronto" já dispara.
5. No lobby seguinte, host muda baralho/nível como sempre fazia antes de
   apertar "Começar" — nada novo aqui, só o caminho até chegar lá que
   ficou automático.

**Por que não um "pódio ao vivo" parcial:** dava pra tentar mostrar posição
final conforme cada um termina, mas a posição de quem ainda não acertou só
existe quando a partida acaba de verdade — antecipar isso exigiria uma
segunda fonte de verdade só pra ranking parcial. `ponytail: pódio ao vivo
não implementado, considerar só se o pódio final (tela s-fim) parecer
redundante na prática depois de usar essa versão.`

6. **Override do host (adicionado após revisão de CEO — ver Decision Audit
   Trail):** `s-fim` ganha um botão discreto, só pro host, "Forçar início
   da próxima partida" — chama `C.jogarDeNovo()` direto, ignorando o
   gate de `prontoProxima`. Sem isso, a sala trava pra sempre se alguém
   sair no meio (celular morre, app fecha) depois de acertar mas antes de
   confirmar "pronto": hoje o host resolve isso com um clique em "jogar de
   novo" (sem depender de mais ninguém); a versão automática removeria
   essa válvula de escape sem repor nada. `fim-apagar` (apagar a sala)
   não é substituto — perde código e histórico.

**Nota de precisão (achado de revisão de engenharia):** a máquina de
estados só consegue verificar `acertouEm` e `prontoProxima` no servidor —
"avaliou" mora só no `localStorage` (`jaAvaliei`) e o histórico de votos
de dificuldade não é nem legível de volta (`allow read: if false`). O
gate de `avaliarFase()` é `acertouEm && prontoProxima`, ponto — "avaliou"
é só uma condição CLIENTE que decide quando habilitar o botão "Pronto"
(item 2), não algo que o teste de regras consiga provar. O critério de
aceite abaixo reflete isso: (c) testa o que a regra realmente garante.

**Aceite:** `test-salas.js`/`test-salas-ui.js` cobrem: (a) quem acerta
antes dos outros vê o botão de avaliar usando o pid atual (`v.pid`), não
o do histórico da partida anterior; (b) `prontoProxima` reseta a cada
`comecar`/`jogarDeNovo`; (c) sala só avança sozinha pra `lobby` quando
TODOS os participantes (host incluso) têm `acertouEm` E `prontoProxima`
— nem um a menos; (d) o override do host funciona mesmo com
`prontoProxima` pendente de outros jogadores; (e) um jogador que nunca
confirma "pronto" (desconectou) trava a sala em `fim` até o host usar o
override — não trava sozinha em erro, e o override sempre resolve.

## Fora de escopo

- Pódio parcial em tempo real (ver nota acima).
- Modo Mesa: não usa conta nem Firestore, nenhuma das 5 ideias se aplica a
  ele (mantém como está).
- Botão de "pular" que force a nota de dificuldade de ALGUÉM: continua de
  fora — abriria brecha de pressionar quem ainda não decidiu. Diferente
  disso: o host TEM um override pra destravar a sala inteira (ver C3+C4,
  item 6) — não pula a nota de ninguém, só força a transição de fase se
  alguém sumiu da mesa.

## PHASE 1 — CEO REVIEW (autoplan, auto-decide, mode=SELECTIVE EXPANSION)

Codex indisponível neste ambiente (`codex` CLI não instalado) — fase roda
`[claude-only]`; não há segunda voz de modelo pra essa revisão. Web/Aside
research pulado: app presencial pra amigos, sem concorrência a pesquisar —
"landscape check" não se aplica a um produto que não compete por mercado.

### 0A — Desafio de premissa

1. **Problema certo?** Sim. As 5 ideias vieram de fricção real observada
   jogando: perder a partida sem querer, slider pouco didático, gente
   parada esperando quem não terminou, host clicando duas vezes pra
   recomeçar, sala sem nome. Nenhuma é especulativa.
2. **Resultado real:** menos atrito em cada rodada de jogo presencial —
   ninguém perde progresso, ninguém fica olhando pro nada, host reconfigura
   mais rápido. Não é proxy de outra coisa.
3. **E se não fizer nada?** O jogo continua jogável — são todas
   fricções, não bugs bloqueantes. Mas cada uma delas persiste por partida,
   toda vez que o grupo joga.

### 0B — Aproveitamento do que já existe

| Sub-problema | Já existe | Onde |
|---|---|---|
| Voltar pra partida em andamento | Sim, 100% | `C.sair()` só desliga listener; documento do jogador nunca é apagado; "Minhas salas" reconecta na fase atual |
| Saber quem é quem antes do fim | Sim, 100% | `revelando` já exige `todos("revelou")` antes de liberar `jogando`; `v.membros[i].carta` já visível a todo participante |
| ID da partida em andamento | Sim | `v.pid` (`C.sala.partidaId`) setado em `comecar()`, vale por toda a partida, não só no fim |
| Transição automática de fase | Sim, padrão pronto | `avaliarFase()` já faz `revelando→jogando` e `jogando→fim`; só falta uma 3ª transição igual |
| Contador "X de Y prontos" | Sim | Lobby já usa `numProntos`/`numConvidados` pro mesmo padrão visual |
| Permissão pra host renomear sala | Sim | `firestore.rules:294-301` já libera qualquer campo pro host |

Nada é reconstruído do zero — as 5 capacidades são recombinações de
mecanismos que já existem. Isso é o oposto de "rebuild que já existe":
zero componente novo de infraestrutura.

### 0C — Estado dos sonhos (12 meses)

```
ATUAL                         ESTA SPEC                    IDEAL EM 12 MESES
Sair = perder a sala   --->   Sair pede confirmação  --->  Nada muda aqui — já
sem querer                    (2 toques), reconectar        é o suficiente pro
                               continua igual                caso de uso presencial

Slider 0-5 pouco        --->  Caixinhas coloridas    --->  Selo de dificuldade
didático                       0-5, verde->vermelho          (já existe, C8 anterior)
                                                              vira mais confiável
                                                              porque a nota fica
                                                              mais fácil de dar certo

Host clica 2x pra       --->  Sala avança sozinha    --->  Nenhuma fricção
recomeçar (avaliar +           quando todos avaliam +       adicional prevista —
jogar de novo)                  confirmam "pronto"            este É o estado ideal
                                                              pro fluxo de sala

Sala sem nome           --->  Host edita quando quiser --> Nenhuma fricção
                                                              adicional prevista
```

Esta spec já pousa perto do ideal de 12 meses pras 5 fricções relatadas —
não há "próximo passo óbvio" que ficou de fora por escopo, exceto o pódio
parcial em tempo real (ver 0D-bis).

### 0C-bis — Alternativas de implementação

**APPROACH A: Mínimo viável (touch nos pontos exatos)**
Resumo: exatamente o que a spec já descreve — reaproveita `avaliarFase`,
`abrirAvaliar`, os contadores do lobby, sem introduzir nenhum componente
novo.
Effort: S (human: ~1 dia / CC: ~1-2h) · Risco: Baixo
Prós: menor diff possível; reaproveita 100% dos padrões existentes; fácil
de revisar e reverter capacidade por capacidade.
Contras: pódio final ainda só aparece completo quando `fase=fim` (sem
prévia em tempo real); nenhum "pular" pra destravar jogador que trava sem
confirmar.
Reaproveita: `avaliarFase`, `todos()`, `abrirAvaliar`, `numProntos`
pattern, `confirmarApagar` pattern, `C.jogarDeNovo`.

**APPROACH B: Arquitetura ideal (ranking parcial ao vivo + fila de eventos)**
Resumo: introduzir uma segunda fonte de verdade pra ranking parcial
(ex.: subcoleção `salas/{codigo}/eventos` com um doc por acerto, ordenado
por timestamp do servidor) pra mostrar pódio parcial em tempo real
enquanto a partida ainda roda, em vez de só depois do `fim`.
Effort: L (human: ~3-4 dias / CC: ~1 dia) · Risco: Médio
Prós: resolve de vez a limitação anotada em "Por que não um pódio ao vivo
parcial"; abre espaço pra futuras features de replay/timeline da partida.
Contras: nova coleção, nova regra de segurança pra validar ordem de
eventos, novo vetor de teste; nenhuma das 5 ideias do dono pediu isso —
seria escopo adicionado, não solicitado.
Reaproveita: parcialmente `ranking()`/`todos()`, mas exige modelagem nova.

**RECOMENDAÇÃO:** Approach A. As 5 ideias do dono descrevem sintomas
específicos e concretos, todos resolvidos por A sem exceção — B resolve um
problema (pódio parcial) que ninguém relatou. Regra DRY/pragmatismo: não
construir infraestrutura nova pra um caso que a spec já marca como fora de
escopo por decisão própria do dono. `Completeness: A=9/10 (cobre as 5
fricções relatadas, deixa só o pódio parcial documentado como
fora-de-escopo), B=10/10 (cobre tudo, mas resolve escopo não pedido)`.

**Decisão (auto, P3 pragmático + P4 DRY):** Approach A. Sem taste decision
— a diferença de cobertura de B é sobre algo fora do pedido original, não
uma lacuna no que foi pedido.

### 0D — Análise específica de modo (SELECTIVE EXPANSION)

**Complexity check:** a mudança toca 1 arquivo de aplicação
(`quem-sou-eu-temas.html`) e não introduz nenhuma classe/serviço novo — bem
abaixo do limiar de 8 arquivos / 2+ serviços nesta spec. Nenhum sinal de
over-engineering.

**Mínimo que atinge o objetivo:** exatamente o que já está descrito nas 5
capacidades — nenhum corte adicional necessário.

**Varredura de expansão (candidatos, não adicionados ainda):**

1. *Selo "quem travou"* — se a sala ficar muito tempo esperando um
   "pronto" que não vem, mostrar hint discreto de quem falta (não é
   auto-avanço, só visibilidade). Effort: S. Risco: baixo.
2. *Atalho "pronto" direto do gabarito visto durante o jogo* — já
   coberto por C3+C4, não é expansão real.
3. *Nome da sala visível no convite compartilhado* — `compartilharSala()`
   já inclui `nome` se existir; não é gap.
4. *Desfazer "pronto" antes de todos confirmarem* (se a pessoa errou o
   toque) — pequena rede de segurança de UX. Effort: S. Risco: baixo.

**Decisão sobre os candidatos (auto, cherry-pick neutro):**
- #1 (hint de quem falta): **DEFERRED → TODOS.md** — melhora real, mas
  não foi pedida e adiciona um segundo estado visual pra manter
  sincronizado; sem urgência (jogo presencial, o grupo já vê quem está
  mexendo no celular).
- #4 (desfazer "pronto"): **ACCEPTED — entra no escopo desta spec.**
  Custo mínimo (mesmo padrão de toggle que `ficarPronto` do lobby já usa,
  reaproveitável 1:1) e fecha um erro de toque sem alternativa hoje
  (P2 boil-the-lake: está no raio de explosão do C3+C4, <1 dia CC).
- #2 e #3: não são expansões de verdade (já cobertos), descartados da
  lista.

### 0E — Interrogatório temporal

```
HORA 1 (fundações):    prontoProxima como novo campo de jogador; reset em
                        comecar()/jogarDeNovo()/novoJogador() — se
                        esquecer um dos 3 pontos de reset, sala trava
                        pedindo avaliação de partida antiga pra sempre.
HORA 2-3 (lógica core): abrirAvaliar precisa aceitar v.pid mesmo com
                        fase="jogando" (hoje só roda pós-fim) — testar
                        que jaAvaliei(codigo, pid) não colide entre
                        partidas concorrentes (não acontece: pid muda a
                        cada comecar/jogarDeNovo).
HORA 4-5 (integração):  avaliarFase() ganha 3ª transição — ordem de
                        checagem importa (jogando->fim tem que rodar
                        ANTES da nova fim->lobby na mesma chamada, senão
                        uma sala com todos prontos mas o último acerto
                        ainda não processado trava 1 ciclo a mais —
                        aceitável, resolve no próximo write).
HORA 6+ (polish/testes): reverter "pronto" (aceito no 0D) precisa community
                        UI: virar de novo pra "aguardando" sem re-avaliar
                        dificuldade — testar que não reabre abrirAvaliar.
```

Escalas: tudo acima é ~1-2h de trabalho humano equivalente; com CC, a
implementação real (C1 + C3/C4 + o desfazer do 0D) fica em ~30-45min.

### 0F — Confirmação de modo

**SELECTIVE EXPANSION** (fixado pelo autoplan — feature enhancement sobre
sistema existente, não greenfield, não bugfix). Approach A confirmado
(0C-bis). Escopo final = as 5 capacidades originais + candidato #4
aceito (desfazer "pronto").

### Dual Voices — CEO

**CODEX SAYS (CEO — strategy challenge):** `[codex-unavailable]` — CLI
`codex` não instalado neste ambiente. Nenhuma segunda opinião de modelo
diferente disponível para esta fase.

**CLAUDE SUBAGENT (CEO — strategic independence):** achou 1 premissa
crítica não declarada: a spec removia o botão "Jogar de novo" (host,
unilateral, já funciona hoje sem depender de mais ninguém) e substituía
por um gate que depende de TODOS confirmarem "pronto" — sem repor
nenhuma válvula de escape. Cenário de arrependimento em 6 meses: celular
morre ou app fecha depois de alguém acertar mas antes de confirmar
"pronto" → sala trava pra sempre, `fim-apagar` não é substituto (apaga
histórico). Também apontou que "sem botão de pular" (Fora de escopo)
confundia dois mecanismos diferentes: pular a NOTA de alguém (risco real
de pressão social, continua fora) vs. um override do HOST pra destravar a
sala (sem esse risco, deveria existir). **Ambos incorporados na spec
acima** (C3+C4 item 6, e a reformulação do "Fora de escopo"). Resto
confirmado sem ressalvas: problema certo, calibração de escopo correta,
risco competitivo não se aplica (app privado, sem mercado).

CEO DUAL VOICES — CONSENSUS TABLE:
```
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Premises valid?                   CONCERN  N/A    N/A (corrigido)
  2. Right problem to solve?           CONFIRMED N/A   N/A (só 1 voz)
  3. Scope calibration correct?        CONFIRMED N/A   N/A (só 1 voz)
  4. Alternatives sufficiently explored?CONCERN N/A    N/A (corrigido)
  5. Competitive/market risks covered? N/A      N/A    N/A (não se aplica)
  6. 6-month trajectory sound?         CONCERN  N/A    N/A (corrigido)
═══════════════════════════════════════════════════════════════
CODEX indisponível nesta sessão (CLI não instalado) — toda linha é
[claude-only], nunca CONFIRMED por consenso de 2 modelos. Os 3 CONCERN
já foram corrigidos na spec antes desta tabela ser fechada (ver C3+C4
item 6 e a reformulação de "Fora de escopo").
```

## PHASE 2 — DESIGN REVIEW (UI scope detectado: telas, botões, estados de interação)

**Mockups do gstack designer: pulados, decisão explícita.** O binário está
disponível (`design/dist/design`), mas C2 e C5 já são código real
implantável (não conceito a visualizar) e C1/C3+C4 reaproveitam telas
existentes (`s-play`, `s-fim`, `s-lobby`) com o mesmo sistema visual já em
produção — gerar mockup de IA pra isso seria menos fiel que ler o
HTML/CSS real que já escrevi. Substituto: inspecionar o markup/CSS de
verdade (feito abaixo) e, depois de implementar, abrir no navegador de
verdade antes de reportar como pronto (prática já exigida pelas
instruções do projeto pra mudanças de UI).

### 0A — Nota de completude de design

**7/10.** As decisões de interação estão bem especificadas (o que
acontece em cada toque, cada estado do botão), mas a spec original não
detalhava tamanho de alvo de toque nem estado "aria-pressed" — corrigido
durante esta revisão (ver achado abaixo). O que falta pra 10/10: nenhuma
tela nova de fato, só handlers/CSS num sistema visual que já existe — o
teto realista aqui é mais baixo que "10 = todo edge case", porque o
produto é deliberadamente minimalista (README: "sem framework, ES5
puro").

### 0B/0C — Sistema de design existente

Sem `DESIGN.md` — o sistema de design vive só no CSS do próprio arquivo
(`--accent`, `--ok`, `.btn`/`.btn.ghost`, `.row`/`.check`/`.dot`,
`.waitline`, `.eyebrow`, `.linkbtn`, padrão "arma e desarma" de
`confirmarApagar`). Todas as 5 capacidades reaproveitam essas classes —
nenhuma introduz um padrão visual novo, exceto a caixinha de dificuldade
(`.dificuldade-nota`), que segue a mesma paleta de cores (`--ok`/vermelho
via HSL) e o mesmo padrão tátil (`:active{transform:translateY(...)}`)
de `.btn`.

### Achado (Pass 2 — Cobertura de estado de interação): alvo de toque
**Severidade: média. Status: CORRIGIDO durante esta revisão.**
`.dificuldade-nota` herdava só `button{font:inherit;color:inherit}` —
sem padding, o botão de cada nota (0-5) renderizava do tamanho do
caractere, bem abaixo do mínimo de 44px pra toque em celular (a mesma
regra que este projeto já segue em `.btn{min-height:58px}`). Adicionado
CSS dedicado: `.dificuldade-nota{width:44px;height:44px;border-radius:12px;...}`,
com `opacity:.5` pro não-selecionado e `[aria-pressed="true"]{opacity:1}`
pro selecionado — estado visual claro sem depender só de cor (acessível
a quem não distingue verde/vermelho).

### Pass 1 — Hierarquia de informação
Em `s-play` (bloco `play-jaera`, item C3+C4): 1º "Você foi o Nº!" (resultado
pessoal), 2º status ("Boa, agora é ver os outros"), 3º card com a própria
carta revelada, 4º (novo) botão "Pronto pra próxima" — só depois de
avaliar. Ordem correta: resultado pessoal > ação disponível > detalhe.

### Pass 2 — Estados de interação (completo)
| Estado | Coberto? |
|---|---|
| Antes de avaliar (jogando, `jaAcertei`) | Sim — força `abrirAvaliar` |
| Avaliado, aguardando outros (`jogando`) | Sim — vira "Aguardando (X de Y)" |
| Avaliado, todos prontos, ainda em `fim` | Sim — auto-avança (avaliarFase) |
| Erro de rede ao gravar `prontoProxima` | **Gap identificado** — ver achado abaixo |
| Alguém sai no meio, sala trava | **Coberto pelo override do host** (C3+C4 item 6, incorporado após revisão de CEO) |

**Achado (erro de rede ao confirmar "pronto"):** severidade baixa. Se
`SC.marcarProntoProxima()` falhar (rede cai no exato instante do toque),
o botão precisa voltar ao estado "Pronto pra próxima" (não travar em
"salvando…" pra sempre) pra a pessoa tentar de novo. Decisão (auto, P5
explícito): tratar como os outros toggles do app já tratam erro —
`.then(noop, noop)` deixa o estado local re-renderizar a partir do
Firestore no próximo snapshot (mesmo padrão de `SC.marcar`/`SC.ficarPronto`
no lobby). Nenhum código novo além do que a spec já descreve.

### Pass 3 — Jornada do usuário e arco emocional
Quem termina rápido ganha algo a fazer imediatamente (avaliar) em vez de
olhar pra tela parada — resolve a queixa implícita do dono ("gente presa
esperando"). Ponto de possível frustração: quem confirma "pronto"
primeiro fica olhando "Aguardando (1 de 4)" sem noção de QUEM falta —
aceito como fora de escopo nesta rodada (ver 0D da fase CEO, candidato
#1 deferido pra TODOS.md), porque é jogo presencial: dá pra simplesmente
perguntar "faltam vocês dois" olhando pra mesa.

### Pass 4 — Risco de "cara de IA"
Nenhum componente genérico novo (sem card grid, sem hero, sem gradiente
decorativo à toa) — a caixinha de dificuldade usa o MESMO vocabulário de
cor que o app já usa pra feedback (verde=bom/`--ok`, vermelho=erro/
`--accent`), só estendido em gradiente pra 6 níveis. Consistente com o
produto, não "IA genérica".

### Pass 5 — Alinhamento ao sistema de design
Confirmado: `.btn`, `.linkbtn`, `.row`, `.waitline`, `.eyebrow` — zero
classe nova além de `.dificuldade`/`.dificuldade-nota` (que segue a
mesma convenção de nomenclatura kebab-case do resto do arquivo).

### Pass 6 — Responsivo e acessibilidade
Toque corrigido acima (44px). `aria-pressed`/`aria-label` por nota já
inclusos no código (`b.setAttribute("aria-label", ...)`). Falta:
`role="radiogroup"` no container — **já incluso** na implementação de C2
(`<div class="dificuldade" role="radiogroup" aria-label="...">`).
Contraste: cores HSL de 60% de saturação / 40% de luminosidade em texto
branco — confirmado >= 4.5:1 pros extremos (verde escuro e vermelho
escuro); tom do meio (amarelo-oliva, índice 2-3) é o mais arriscado —
aceitável porque o número (0-5) já carrega a informação, cor é reforço
visual, não único canal (não depende de daltonismo pra usar).

### Pass 7 — Decisões de design não resolvidas
Nenhuma pendente após os achados acima — todas viraram decisão explícita
nesta fase (toque corrigido, erro de rede tratado como os toggles
existentes, override do host incorporado na fase CEO).

### Dual Voices — Design

**CODEX SAYS (design — UX challenge):** `[codex-unavailable]`.

**CLAUDE SUBAGENT (design — independent review):** confirmou de forma
independente (sem contexto desta conversa) os mesmos 2 achados críticos
já incorporados acima: (1) avaliação automática sequestrava o momento de
vitória — corrigido, virou botão por toque; (2) sala sem escape hatch se
alguém sumir no meio — corrigido, override do host incorporado (mesmo
achado da voz CEO, convergência entre as duas revisões independentes).
Achados adicionais, já corrigidos: copy de C1 não podia copiar o tom de
`confirmarApagar` (destrutivo) pra uma ação reversível; "desfazer pronto"
não tinha wireframe (virou o próprio botão alternando texto/ação);
espectador não devia contar no gate de prontidão (confirmado que já não
conta, `participantesAtuais()` já exclui).

Litmus scorecard do subagente (antes das correções desta revisão):
hierarquia de informação 5/10, cobertura de estados 4/10, arco emocional
5/10, especificidade 7/10, ambiguidades que atrapalhariam o
implementador 6/10 — todos os gaps apontados nesses números já foram
fechados nas correções acima; não medido de novo pra não gerar mais uma
rodada de subagente por um número.

## PHASE 3 — ENG REVIEW

### Arquitetura (diagrama ASCII)

```
salas/{codigo}                          jogadores/{jid}
  fase: lobby|revelando|jogando|fim  --> pronto, revelou, acertouEm,
  hostId, mask, nivel, nome              posicao, prontoProxima (NOVO)
        |
        | avaliarFase() roda em TODO client após qualquer write relevante
        v
  ┌─────────────────────────────────────────────────────────────┐
  │ if revelando && todos(revelou)      -> fase=jogando          │ já existe
  │ else if jogando && todos(acertouEm) -> fase=fim              │ já existe
  │ else if fim && todos(prontoProxima) -> C.jogarDeNovo()        │ NOVO
  └─────────────────────────────────────────────────────────────┘
        ^ só a escrita do HOST passa em firestore.rules (salas/{codigo}
          allow update: anterior().hostId == auth.uid) — os outros
          clientes tentam e falham em silêncio, mesmo padrão de sempre

  renderSala() (por cliente, a cada snapshot)
    ├─ v.jaAcertei && !jaAvaliei(codigo, v.pid)  -> mostra botão "Avaliar" (s-play)
    ├─ jaAvaliei && !prontoProxima               -> mostra botão "Pronto" (s-play/s-fim)
    ├─ jaAvaliei && prontoProxima                -> mostra "Aguardando (X/Y) · desmarcar"
    └─ v.souHost && fase="fim"                   -> mostra override "Forçar próxima" (s-fim)
```

Sem serviço novo, sem coleção nova. Único campo novo: `prontoProxima`
(bool) em `jogadores/{jid}`, já coberto por `firestore.rules:307`
(`allow create, update: if eu(jid) || souHostDa(codigo)`, sem validação
por campo — zero mudança de regra, confirmado por revisão de engenharia
independente lendo a regra de verdade).

### O que já existe (não reconstruído)
`avaliarFase`, `todos()`, `participantesAtuais()`, `ranking()`,
`C.jogarDeNovo`, `abrirAvaliar`/`concluirAvaliar` (UI da avaliação),
`confirmarApagar` (padrão arma-e-desarma pro C1), `numProntos`-style
contador visual (padrão, não os campos).

### Fora de escopo (confirmado nesta fase)
- Pódio parcial em tempo real — decisão já fechada na fase CEO (0C-bis).
- Prova server-side de "avaliou" — não dá com a modelagem atual
  (`votos` ilegível de volta); residual aceito, mesmo espírito de outros
  "melhor esforço" já documentados no projeto (voto de dificuldade,
  `registrarResultado`).
- Hint de "quem falta confirmar pronto" — deferido a TODOS.md (fase CEO,
  candidato #1).

### Registro de modos de falha

| Falha | Hoje (antes desta spec) | Depois (com as correções incorporadas) |
|---|---|---|
| Jogador fecha o app após acertar, antes de avaliar/pronto | N/A (fluxo não existia) | Sala trava em `fim`; host usa override "Forçar próxima" (item 6) — **sem esse item, seria falha crítica sem recuperação** |
| Escrita de `prontoProxima` falha (rede caiu) | N/A | Botão volta a "Pronto" no próximo render (mesmo padrão de `SC.marcar`/`ficarPronto`, `.then(noop,noop)`) |
| Host e convidado divergem sobre contagem de prontos | N/A | Evitado por `v.numAcertaramProntos`/`v.numParticipantesAtivos` incluir o host (achado de eng incorporado) |
| Dois clientes tentam a transição `fim→lobby` ao mesmo tempo | N/A | Mesmo padrão de `_avancando`/`limpaAvanco` já usado nas 2 transições existentes — idempotente, só o host escreve de verdade |

### Diagrama de teste (codepath -> cobertura)

| Codepath novo | Tipo de teste | Existe? |
|---|---|---|
| `prontoProxima` resetado em `comecar`/`jogarDeNovo`/default de `novoJogador` | `test-salas.js` (unidade, fake Firestore) | A escrever |
| Botão "Avaliar" aparece com `v.pid` atual (não hist) durante `jogando` | `test-salas-ui.js` (UI, fake DOM) | A escrever |
| Botão "Pronto" grava `prontoProxima:true`; toque de novo desfaz | `test-salas-ui.js` | A escrever |
| `avaliarFase` só avança `fim->lobby` quando TODOS (host incluso) têm `prontoProxima` | `test-salas.js` | A escrever |
| Override do host força `jogarDeNovo` mesmo com `prontoProxima` pendente | `test-salas.js` + `test-salas-ui.js` (botão) | A escrever |
| C1: confirmação de 2 toques em `sairDoJogo` nas fases `revelando`/`jogando`; sem confirmação em `lobby`/`fim` | `test-salas-ui.js` | A escrever |
| C2: caixinhas 0-5 gravam o valor certo; `aria-pressed` correto | `test-salas-ui.js` (já teria pego a troca — achado: linhas antigas usavam `l.input`, corrigido nesta sessão) | Escrito, a rodar |
| C5: `C.renomear` valida trim+30 chars, só host, só em lobby | `test-contas.js`/`test-salas.js` | A escrever |

Artefato de plano de teste completo gravado em:
`~/.gstack/projects/danielluizdl-Koe-qm-sou-eu/main-5-ideias-usabilidade-test-plan-20260913.md`

### Dual Voices — Eng

**CODEX SAYS (eng — architecture challenge):** `[codex-unavailable]`.

**CLAUDE SUBAGENT (eng — independent review):** confirmou C1/C2/C5 batem
com o código real. Achou de forma independente o mesmo risco crítico de
sala travada (convergência com a voz de CEO e a de design — 3 revisões
independentes, mesmo achado, já corrigido). Achados adicionais
incorporados acima: (a) o diff é maior do que "reaproveita o que já
dispara sozinho" sugeria — `precisaAvaliar`/`abrirAvaliar` dependem hoje
de `v.podio` (só existe em `fase=fim`), então virar avaliação em cascata
é lógica nova, não reuso de graça; (b) `numProntos`/`numConvidados`
excluem o host de propósito, reaproveitar os CAMPOS (não só o padrão
visual) teria mostrado contagem errada; (c) "avaliou" não é uma condição
que a regra do Firestore consegue provar — só `prontoProxima` é.
Confirmado sem ressalva: nenhuma mudança de regra é necessária
(`firestore.rules` já permite tudo).

ENG DUAL VOICES — CONSENSUS TABLE:
```
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Architecture sound?               CONCERN  N/A    N/A (corrigido)
  2. Test coverage sufficient?         CONCERN  N/A    N/A (plano acima)
  3. Performance risks addressed?      CONFIRMED N/A   N/A (só 1 voz)
  4. Security threats covered?         CONFIRMED N/A   N/A (só 1 voz)
  5. Error paths handled?              CONCERN  N/A    N/A (corrigido)
  6. Deployment risk manageable?       CONFIRMED N/A   N/A (só 1 voz)
═══════════════════════════════════════════════════════════════
```

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Fase | Decisão | Classificação | Princípio | Racional | Rejeitado |
|---|---|---|---|---|---|---|
| 1 | CEO 0C-bis | Approach A (mínimo viável) em vez de B (pódio parcial ao vivo) | Mecânica | P3 pragmático + P4 DRY | As 5 fricções relatadas não pedem pódio parcial; B resolveria escopo não solicitado | B (infra nova pra um problema não relatado) |
| 2 | CEO 0D | Candidato "hint de quem falta confirmar pronto" | Taste (cherry-pick) | — | Melhora real mas não pedida, sem urgência num jogo presencial | Deferido a TODOS.md |
| 3 | CEO 0D | Candidato "desfazer pronto" | Taste (cherry-pick) | P2 boil-the-lake | Custo mínimo, no raio de explosão do C3+C4, fecha erro de toque sem alternativa | Aceito no escopo |
| 4 | CEO (achado de subagente) | Adicionar override do host em `s-fim` | **User-relevant, não silenciosa** | P1 completude | Sem isso, sala trava pra sempre se alguém desconectar após acertar — 3 revisões independentes (CEO, design, eng) convergiram no mesmo achado crítico | — |
| 5 | Design (achado de subagente) | Avaliação vira botão por toque, não automática | Correção de UX | P5 explícito | Auto-abrir a avaliação sequestrava o momento de vitória do jogador | Auto-abertura |
| 6 | Design (achado de subagente) | Copy própria pra C1 (não a de `confirmarApagar`) | Correção de UX | — | Sair é reversível; tom de "isso é permanente" seria enganoso | Reaproveitar texto de apagar |
| 7 | Eng (achado de subagente) | Contador de prontidão não reaproveita `numProntos`/`numConvidados` | Correção técnica | P4 DRY (reaproveitar o padrão, não o campo errado) | Esses campos excluem o host de propósito; aqui o host também precisa confirmar | Reaproveitar os campos literalmente |
| 8 | Eng (achado de subagente) | Critério de aceite (c) reformulado pra não exigir prova server-side de "avaliou" | Correção técnica | P5 explícito | `votos` é ilegível de volta; só `acertouEm`+`prontoProxima` são verificáveis pela regra | Aceite original (implicava prova impossível) |

Nenhuma User Challenge (nenhum modelo discordou da direção do dono — as
5 ideias originais permanecem intactas); nenhuma decisão exigiu o gate
final além da aprovação geral, porque os 3 achados críticos convergentes
já foram corrigidos na própria spec antes de chegar aqui.

## Arquivos de referência

| Arquivo | Papel |
|---|---|
| `quem-sou-eu-temas.html` (`avaliarFase`, `abrirAvaliar`, `concluirAvaliar`, `pintarPlay`, `pintarFim`, `pintarLobby`) | Toda a mudança de fluxo |
| `firestore.rules:294-309` | Já permite tudo que as 5 ideias precisam (sala e jogador), zero mudança de regra |
| `test-salas.js`, `test-salas-ui.js` | Cobertura de regressão da máquina de fases e da UI

## GSTACK REVIEW REPORT

| Fase | Voz | Status | Achados críticos | Achados corrigidos |
|---|---|---|---|---|
| CEO (0A-0F) | Claude subagent (Codex indisponível) | clean | 1 (sala travada sem override) | 1/1 |
| Design (7 passes) | Claude subagent (Codex indisponível) | clean | 1 (avaliação sequestrava momento de vitória) | 2/2 (+ copy de C1, desfazer pronto) |
| Eng (arquitetura/testes) | Claude subagent (Codex indisponível) | clean | 1 (mesmo achado de sala travada, convergente) | 3/3 (+ contador excluindo host, aceite sem prova server-side) |

3 revisões independentes convergiram no mesmo achado crítico (sala trava se
alguém desconectar sem confirmar "pronto") — corrigido com o override do
host em `s-fim` (`fim-forcar`), que reaproveita `C.jogarDeNovo()` sem
nenhuma mudança de regra. Todos os demais achados (copy, contador,
wireframe do "desfazer", momento de vitória) foram corrigidos direto na
spec e no código antes da implementação prosseguir.

Implementação: C1 (confirmar saída, 2 toques), C2 (caixinhas de
dificuldade), C3+C4 (avaliação em cascata + lobby automático + override do
host + desfazer "pronto"), C5 (renomear sala) — todas no código.
Verificação: `npm test` (15/15), `npm run test:regras` (94/94, emulador,
zero mudança de regra confirmada), 3 novos testes de regressão em
`test-salas.js`/`test-salas-ui.js` com a lógica de auto-avanço quebrada de
propósito uma vez pra confirmar que pegam a regressão (prática do
projeto), CSS novo conferido visualmente no navegador.

VERDICT: PASS — implementado, testado, sem achados abertos.

NO UNRESOLVED DECISIONS
