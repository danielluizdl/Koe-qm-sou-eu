# Prompt — "Quem Sou Eu?": salas online, nicks, revelação única e ranking

## Missão

Evoluir `quem-sou-eu.html` de um jogo **offline determinístico** para um jogo com **sala compartilhada em tempo real**, implementando as 8 funcionalidades descritas abaixo, **sem backend próprio** e **sem build step** — usando a capability `db` do runtime de Artifacts.

Trabalhe direto no arquivo existente. Ele é um Artifact publicado: começa em `<title>` e `<style>`, sem `<!doctype>`/`<html>`/`<head>`/`<body>` — **mantenha assim**.

---

## 1. Como o jogo funciona hoje (leia antes de escrever qualquer linha)

Arquivo único, ~57 KB, ES5 puro (`var`, `function`, sem arrow / template literal / `const`) — isso é deliberado, é um jogo de festa que roda em celular velho. **Mantenha o estilo.**

Peças relevantes:

| Onde | O quê |
|---|---|
| `var GROUPS` (~linha 356) | Fonte única do baralho. Cada grupo tem `id` e três strings `f`/`m`/`d` (fácil/médio/difícil) com nomes separados por pipe. Dificuldade é **cumulativa**. |
| `var ANIMAIS` (~linha 442) | Lista transversal: cartas que também contam como "Bichos". |
| `var DECKS` (~linha 475) | 16 baralhos em **ordem fixa** — o índice de cada um é o bit dele na máscara. |
| `var NIVEIS` | Fácil / Médio / Difícil. |
| `cardsFor(mask, nivel)` | Resolve a lista de cartas de uma configuração, com cache e deduplicação. |
| `encode()` / `decode()` / `checksum()` | Código de **7 caracteres**, base32 (`A32 = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"`), 35 bits: máscara(16) + nível(2) + pessoas-1(4) + semente(8) + check(5). |
| `mulberry32()` + `wordFor(g, round, slot)` | Embaralhamento determinístico: mesmo código + mesma rodada ⇒ mesma carta no mesmo slot, em todos os celulares. |
| Telas | `s-home`, `s-create`, `s-room`, `s-join`, `s-slot`, `s-card` — trocadas por `show(id)`. |
| Fluxo da carta | `renderBack()` → `startCountdown()` (3 × 800 ms, cancelável) → `revealWord()` → botões "Virar 180°" e "Esconder" → volta pra `renderBack()`, **quantas vezes quiser**. |
| Persistência | `localStorage`, chave `"quemsoueu:v3"`, via `save()` / `load()`. |
| Extras | `toast()`, `buzz()` (vibração), `keepAwake()` (wake lock), `fitWord()` (auto-ajuste do tamanho da fonte). |

**O ponto central:** hoje nada trafega entre celulares. O código de 7 caracteres *é* a configuração; cada aparelho deriva as cartas sozinho a partir dele.

---

## 2. A virada de arquitetura

As funcionalidades pedidas exigem estado compartilhado (nick de cada um, quem já revelou, qual carta é de quem, ranking). E o item 2 pede um **código digitado livremente** — que por definição não codifica configuração nenhuma: ele é a **chave de uma sala**.

### Use a capability `db`

- Declarar na publicação: `capabilities: {db: {}}` — o padrão é todo viewer ler e escrever os docs compartilhados, que é exatamente o que queremos.
- No código: `claude.use("db")` devolve o namespace **ou `null`** quando a view não pode rodar (não servido, não concedido, ou falhou — indistinguíveis por design). Resolve **depois** do primeiro run do script, fora de ordem com `DOMContentLoaded`, e devolve `null` após ~10 s se ninguém responder.
- `db.doc(path)` / `db.collection(path)` com `get` / `set` / `update` / `delete`, `where` / `orderBy` / `limit` e **`onSnapshot`** (tempo real). Last-writer-wins, sem transação.

**ANTES de escrever qualquer chamada, leia os tipos autoritativos.** Eles valem mais que qualquer API que você lembre — em especial o formato de path de subcoleção e a forma do snapshot:

```
C:\Users\danie\AppData\Local\Temp\claude\bundled-skills\2.1.251\c980e9f8b9b1547479b718167505309a\artifact-capabilities\0.2.32\claude.d.ts
C:\Users\danie\AppData\Local\Temp\claude\bundled-skills\2.1.251\c980e9f8b9b1547479b718167505309a\artifact-capabilities\0.2.32\db.d.ts
```

### Regra inegociável: o modo offline continua funcionando

`claude.use("db")` pode devolver `null`, e o jogo é usado em festa com internet ruim. Então existem dois modos:

- **Online (sala):** quando `db` resolve. Código de 5 caracteres, tudo que está especificado abaixo.
- **Offline (fallback):** quando `db` é `null`. É **exatamente o jogo de hoje**, intacto — código de 7 caracteres, `decode()`, escolher número, revelar/esconder à vontade. Zero regressão.

A página deve **renderizar e ser jogável sem `db`** e "acender" os recursos de sala quando a promise resolver. Nunca leia `window.claude.db`; só `claude.use("db")` vale como teste. Como o código é ES5, use `.then()`, não `async/await`.

---

## 3. As 8 funcionalidades

### 3.1 — Nick por participante

- Quem abre o link escolhe um **nick** antes de criar ou entrar numa sala. Tela nova (`s-nick`) ou passo no início do fluxo.
- Guardar em `localStorage` e pré-preencher nas próximas vezes — ninguém quer digitar de novo.
- Validação: 1 a 14 caracteres, sem espaço nas pontas, não vazio. **Único dentro da sala** — se colidir, avise e peça outro; não renomeie em silêncio.
- O nick é a identidade visível do jogador em todas as listas do jogo.

### 3.2 — Código da sala: digitado ou aleatório, 5 caracteres

- Na criação, além dos baralhos e do nível que já existem, o host escolhe entre **digitar** um código de até 5 caracteres ou **pedir um aleatório**.
- Charset: reaproveite `A32` (`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`). Ele já exclui `0`, `1`, `I`, `L` e `O` justamente porque alguém vai ditar isso em voz alta numa mesa barulhenta.
- Normalização do que for digitado: `trim`, maiúsculas. Caractere fora do charset é **recusado com mensagem clara** (ex.: "Use só letras e números, sem O, I, L, 0 e 1") — não tente adivinhar substituição.
- **Salas nunca expiram.** Um código criado hoje continua valendo daqui a semanas: a mesma turma volta ao mesmo código quantas vezes quiser. Detalhes no item 3.7.
- Como nada expira, código digitado que já existe **nunca** é sobrescrito. O padrão é **entrar naquela sala**, não dar erro — se o jogador já é membro dela, volta como ele mesmo; se não é, entra como jogador novo. Só ofereça "escolher outro código" quando a pessoa claramente queria *criar* uma sala e o nome já estava tomado.
- Ajuste a tela `s-join`: hoje o input tem `maxlength="7"` e valida via `decode()`. No modo online são 5 caracteres validados pela **existência da sala no `db`**. Mantenha o caminho de 7 caracteres como fallback offline.

### 3.3 — Revelação única (o item mais importante)

Hoje é `revealWord()` → "Esconder" → `renderBack()` → "Mostrar" de novo, em loop infinito. **Isso acaba.**

Novo fluxo, por jogador:

1. Estado inicial: carta virada, botão **"Mostrar para a mesa"**.
2. Contagem de 3 — mantenha `startCountdown()` e mantenha o "Cancelar". Cancelar **não** consome a revelação.
3. Carta aberta. Botões: **"Virar 180°"** e **"Já mostrei — esconder"**. Deixe visualmente claro que esconder é **definitivo** (aviso curto perto do botão).
4. Ao esconder: grava `revelou: true` no doc do jogador. **A carta dele passa a ser visível para todos os outros jogadores da sala, atrelada ao nick dele.** Ele não vê mais a própria carta e o botão "Mostrar" não volta.
5. No lugar do botão, aparece o campo de senha do item 3.5.

Exemplo com 4 pessoas: eu mostro, escondo, e "Dani → Bob Esponja" aparece no celular dos outros 3. Na minha tela eu continuo vendo só as cartas *deles*.

**Limitação conhecida — não tente resolver com criptografia de fachada:** `db` é um store compartilhado e os dados são legíveis por qualquer viewer que abrir o devtools, inclusive a própria carta. É um jogo de festa, vale o acordo de cavalheiros. Não invente ofuscação que dá falsa sensação de segurança; se quiser, uma frase discreta na UI resolve.

### 3.4 — Bloco de notas

- Aparece quando **todos** os jogadores da sala já revelaram e esconderam (a `fase` da sala vira `jogando`).
- Duas partes:
  - **Lista dos adversários**: nick → carta, em tempo real via `onSnapshot`. Serve pra conferir quem é quem quando alguém esquece. A própria carta **nunca** aparece aqui.
  - **Anotações livres**: `<textarea>` pessoal, salvo em `localStorage` com chave por sala + jogador — é conveniência privada de cada aparelho, não vai pro `db`. Auto-save com debounce, sem botão "salvar".

### 3.5 — Segunda visualização exige senha = o nome da própria carta

- Depois de esconder, para rever a carta o jogador digita uma **senha**, que é exatamente **o nome do personagem dele**.
- Comparação **normalizada**, não literal: minúsculas, sem acentos (NFD + remoção de diacríticos), sem pontuação, espaços colapsados.
- Aceite também a forma **sem o parêntese**: `Remy (Ratatouille)` deve aceitar `remy` e `remy ratatouille`. Vale igual para `Jessie (Toy Story)`, `Coelho Branco (Alice)`, `Toto (O Mágico de Oz)` e afins.
- Erro: mensagem curta + `buzz()`, tentativas ilimitadas, sem punição.
- Acerto: revela a carta permanentemente para esse jogador (dali pra frente ele vê quando quiser) **e** dispara o item 3.6.

### 3.6 — Colocação

- Acertar a senha **é** acertar a brincadeira. Não são duas mecânicas separadas: é a mesma ação.
- No acerto, grava `acertouEm` (timestamp) no doc do jogador. A **colocação é a ordem de `acertouEm`**: 1º, 2º, 3º…
- Placar visível para todos em tempo real: quem já acertou, em que posição, e quem ainda está jogando.
- Quando o último acertar, a `fase` vira `fim` e aparece uma tela de resultado com o pódio e a carta de cada um.

### 3.7 — Sala permanente: a mesma turma, vários dias

A sala **não expira nunca**. O código é o endereço fixo daquele grupo — cria uma vez, joga por meses.

- **Voltar pra sala:** o aparelho guarda em `localStorage` as salas de que o jogador já participou (código + `jogadorId` + nick). Na home, uma lista **"Suas salas"** leva de volta com um toque, sem redigitar código. Digitar o código também funciona.
- **Reconhecer quem volta:** ao entrar numa sala existente com um `jogadorId` que ela já conhece, o jogador retoma a identidade dele — mesmo nick, mesmo histórico. Se o `localStorage` foi limpo (celular novo, aba anônima), mostre a lista de membros da sala e deixe a pessoa dizer "sou eu, Dani" em vez de virar um membro duplicado. Nick continua único na sala.
- **Quem não veio hoje:** com sala permanente, o roster acumula gente que não está na mesa nessa noite. **Nunca deixe um ausente travar a partida.** Cada partida tem os seus **participantes**, escolhidos no lobby: por padrão vêm marcados os membros presentes, e o host pode desmarcar quem faltou. As condições "todos revelaram" e "todos acertaram" olham **só os participantes daquela partida**, nunca o roster inteiro.
- **Entrar no meio:** quem chega depois da partida começar entra como membro da sala e fica de fora **daquela** partida — participa da próxima. Não redistribua cartas no meio.
- **Nova partida:** a partir da tela de `fim`, o host clica em "Jogar de novo" — nova `seed`, novas cartas, `revelou` e `acertouEm` limpos, `fase` volta pra `lobby` (pra reconfirmar quem está jogando). Baralhos e nível podem ser trocados a cada partida.
- **Apagar sala:** como nada expira, o host precisa poder **apagar a sala** (com confirmação, avisando que o histórico vai junto). É a única forma de limpar.

### 3.8 — Histórico de ranking do grupo

Cada partida terminada vira registro permanente na sala. É o que dá graça em jogar sempre com a mesma turma.

- **Ao chegar em `fase: "fim"`**, grava uma partida com: data, configuração (baralhos + nível), e para cada participante `jogadorId`, `nick`, `carta` e `posicao`. Escrita **uma vez só**, pelo host, e idempotente — se dois aparelhos tentarem gravar a mesma partida, não pode duplicar (use um id determinístico da partida, tipo `seed` + `criadaEm`, como chave do doc).
- **Tela "Histórico"**, com duas abas:
  - **Classificação geral** — tabela acumulada por jogador: partidas, vitórias, pódios, colocação média e pontos. **Pontuação:** numa partida com `N` participantes, o 1º lugar faz `N` pontos, o 2º faz `N-1`, e assim por diante até 1 ponto para o último. Isso evita que partida grande e partida pequena valham igual demais. Ordenação: pontos, empate desempata por vitórias, depois por colocação média.
  - **Partidas** — lista das últimas partidas, da mais recente pra mais antiga: data, quem ganhou, quantos jogaram, e ao tocar expande mostrando a carta de cada um. É a memória boa da brincadeira ("lembra quando você era o Zé Colmeia e não descobriu?").
- **Calcule a classificação geral lendo as partidas**, não guarde total agregado em campo separado — total denormalizado desanda em store last-writer-wins. Se a lista ficar grande, pagine as partidas (`orderBy` + `limit`) e acumule as últimas 100.
- Jogador que entrou depois aparece com as partidas que jogou; quem faltou numa noite simplesmente não pontua nela.

---

## 4. Modelo de dados sugerido

Confirme o formato de path de subcoleção no `db.d.ts` antes de fixar isto.

```
salas/<CODIGO>
  { codigo, criadaEm, ultimoUsoEm, hostId,
    mask, nivel, seed, partidaId, participantes[], fase }
    fase: "lobby" | "revelando" | "jogando" | "fim"
    participantes: [jogadorId] — quem está jogando ESTA partida

salas/<CODIGO>/jogadores/<jogadorId>          // roster permanente da sala
  { jogadorId, nick, entrouEm, vistoEm,
    slot, carta, revelou, revelouEm, acertouEm }   // campos da partida atual

salas/<CODIGO>/partidas/<partidaId>           // histórico, só cresce
  { partidaId, terminadaEm, mask, nivel,
    resultados: [ { jogadorId, nick, carta, posicao } ] }
```

- `jogadorId`: UUID gerado no aparelho e guardado em `localStorage` **por sala**. É o que faz o jogador continuar sendo ele mesmo depois de um reload, de uma queda de conexão **e de uma semana sem abrir o jogo**.
- `partidaId`: determinístico a partir da `seed` + início da partida, pra escrita idempotente do histórico.
- **Distribuição das cartas:** quando o host clica em "Começar", `participantes` é congelado, o `slot` é atribuído por ordem de `entrouEm` **dentro dos participantes**, e a carta vem de `wordFor(game, 1, slot)` usando a `seed` da partida — reaproveitando o motor determinístico que já existe. Cartas distintas entre jogadores.
- **Separe com clareza** os campos de roster (`nick`, `entrouEm`) dos campos de partida (`slot`, `carta`, `revelou`, `acertouEm`): os primeiros duram pra sempre, os segundos são zerados a cada partida nova.
- No modo online o contador de pessoas da tela `s-create` **não** define o número de jogadores — quem define é quem está marcado no lobby. Mantenha o stepper para o modo offline. Limite prático: 2 a 16 participantes por partida.

---

## 5. Invariantes — não quebre

1. **Arquivo único.** Sem `<!doctype>` / `<html>` / `<body>`, sem build, sem dependência externa, sem CDN.
2. **ES5**: `var`, `function`, `.then()`. Sem `const` / `let` / arrow / template literal / `async`.
3. **Ordem de `DECKS` congelada** — mexer nela invalida todo código de 7 caracteres já gerado.
4. **Não edite o conteúdo do baralho** (`GROUPS`, `ANIMAIS`) nesta tarefa. Separador pipe, dificuldade cumulativa, régua "brasileiro de ~30 anos".
5. **Tema**: paleta completa em `:root`, redefinida em `@media (prefers-color-scheme: dark)` com guarda `:root:not([data-theme="light"])` e em `:root[data-theme="dark"]`. Toda cor nova entra como token nos três lugares.
6. **Mobile-first**: alvos de toque ≥ 44 px, `safe-area-inset` já tratado no `.app`, nada de scroll horizontal.
7. Copy em **pt-BR**, no tom que já está no arquivo — direto, coloquial, sem jargão.
8. Preserve `toast()`, `buzz()`, `keepAwake()`, `fitWord()` e a animação de troca de tela.
9. `audit.js` e `test.js` precisam continuar passando.

---

## 6. Ordem de execução

Faça em fases e **pare no fim de cada uma para eu testar** antes de seguir:

1. **Fase 0 — camada de sala.** `claude.use("db")` com fallback `null`, helpers de sala e jogador, identidade persistente, `onSnapshot`. Sem UI nova ainda: prove que dois aparelhos enxergam o mesmo doc.
2. **Fase 1 — nick + código de 5** (itens 3.1 e 3.2). Criar sala, entrar por código, lobby em tempo real mostrando os nicks.
3. **Fase 2 — revelação única** (item 3.3). Congelar `participantes`, distribuir cartas, reveal irreversível, carta do outro aparecendo atrelada ao nick.
4. **Fase 3 — senha, colocação e placar** (itens 3.5 e 3.6).
5. **Fase 4 — bloco de notas e tela de fim** (item 3.4).
6. **Fase 5 — sala permanente** (item 3.7). "Suas salas" na home, retomar identidade, marcar participantes no lobby, "jogar de novo", apagar sala.
7. **Fase 6 — histórico de ranking** (item 3.8). Gravação idempotente da partida, classificação geral e lista de partidas.

---

## 7. Critérios de aceite

- [ ] Com `db` indisponível, o jogo de hoje funciona **igualzinho**: código de 7 caracteres, escolher número, revelar/esconder à vontade.
- [ ] Dois navegadores diferentes entram na mesma sala de 5 caracteres e veem os nicks um do outro em tempo real.
- [ ] Código digitado que já existe em sala ativa não sobrescreve nada.
- [ ] Nick duplicado é recusado com mensagem clara.
- [ ] Depois de esconder, **não existe** caminho na UI que mostre a própria carta sem a senha.
- [ ] A carta de quem escondeu aparece na tela dos outros, com o nick certo, sem reload.
- [ ] A senha aceita `remy`, `Remy (Ratatouille)`, `REMY RATATOUILLE` e `remy  ratatouille`.
- [ ] Três jogadores acertam em sequência e recebem 1º, 2º e 3º na ordem correta.
- [ ] Reload no meio da partida devolve o jogador ao mesmo estado: mesmo `jogadorId`, mesma carta, mesma fase.
- [ ] O bloco de notas só aparece com todo mundo revelado, as anotações sobrevivem a um reload, e a própria carta não vaza nele.
- [ ] Fechar o navegador, reabrir dias depois e voltar pela lista "Suas salas" devolve o jogador ao mesmo nick e ao mesmo histórico.
- [ ] Membro desmarcado no lobby não trava a condição de "todos revelaram" nem "todos acertaram".
- [ ] Jogar 3 partidas seguidas na mesma sala gera 3 registros no histórico — nenhum duplicado, mesmo se dois aparelhos estiverem na tela de fim ao mesmo tempo.
- [ ] A classificação geral bate na mão: numa partida de 4, o 1º ganha 4 pontos e o último ganha 1.
- [ ] Quem entrou só na 2ª partida aparece na classificação com 1 partida, não com 2.
- [ ] Apagar a sala remove sala, jogadores e histórico, e ela some da lista "Suas salas".
- [ ] `node audit.js` e `node test.js` passam.
- [ ] Testado em viewport de 360 px de largura, nos temas claro e escuro.

---

## 8. Publicação

Ao publicar o Artifact, passe `capabilities: {db: {}}`. Se estiver **atualizando o artifact existente**, use a URL dele para redeployar no mesmo link — não crie um artifact novo, senão o link que as pessoas já têm morre.

---

## 9. Se algo estiver ambíguo

Pergunte antes de inventar. Especificamente: se o `db.d.ts` contradisser o modelo de dados da seção 4, siga o `.d.ts` e me avise o que mudou.

---

## 10. Notas da implementação (o que ficou diferente da spec, e por quê)

### 10.0 — A trava do `db`: dois modos

A capability `db` **não pode ser usada em artifact público** (é sempre interno à organização — todo viewer precisa de conta no mesmo workspace). Como o jogo é pra festa com convidados aleatórios, o app tem **dois caminhos**, escolhidos sozinho:

- **Modo mesa** (padrão sem `db`, link público) — tudo determinístico do código + `localStorage`. **Seleção livre dos 16 baralhos** (grade igual à do clássico). O **código de 5 números** carrega só nível(2) · pessoas-2(4) · semente(4) · checksum(6) — a **máscara de baralhos** e os **nomes** vão no **link/QR** (`#j<5num>-<mask base36>~nomes`). Quem abre o link pega os baralhos exatos; quem digita só os 5 números pega **todos** os baralhos (avisado na tela: `soCodigo`). Entrega **nick, revelação única, painel dos adversários, senha, bloco de notas** e **rodadas**. **Não tem** placar ao vivo nem histórico do grupo. Telas `s-mesa` e `s-passar`, controller `CriarMesa`, `encodeMesa5`/`decodeMesa5`. Ao criar, a ordem dos nomes é **embaralhada** (Fisher-Yates) e vai fixa no link.
- **Sala online** (quando `db` resolve, dentro do workspace) — tudo da spec, incluindo placar ao vivo, histórico e sala permanente. Código de 5 caracteres.
- **Clássico** (7 caracteres) — o jogo de hoje, intacto, revela à vontade. Um toggle no "Criar jogo" alterna Mesa ↔ Clássico (a grade de baralhos é a mesma).

### 10.0.1 — Buffer "vire o celular" (tela `s-passar`)

Depois de esconder a carta (mesa e sala), em vez de ir direto pro painel dos adversários, vem uma tela intermediária ("✓ Carta escondida — vire o celular para você") que a pessoa toca pra prosseguir. Evita que o gabarito dos outros apareça na tela ainda virada pra mesa. Flag local `pausaPassar`; `renderSala`/`renderMesa` não arrancam a pessoa dessa tela quando chega snapshot de outro jogador.

Testes: `test.js`/`audit.js` seguem passando; `test-salas.js` roda o fluxo `db` inteiro (2–16 jogadores, `db` simulado); `test-mesa.js` roda o modo mesa (2–16, código, link, rodadas, reload); `test-salas-ui.js` dirige host e mesa por cliques reais.

1. **Histórico agregado num doc só por sala**, não uma coleção `partidas/<id>`. O `db.d.ts` (seção CAPACITY) desaconselha explicitamente "um doc por item" para stream que só cresce, e o teto é 5.000 docs para o Artifact **inteiro** (todas as salas juntas). Ficou `salas/<CODIGO>/hist/registro` com `{ items: { <partidaId>: {…} } }`. O `partidaId` (`seed + "-" + partidaCriadaEm`) continua sendo a chave determinística — agora chave do mapa. O doc é criado (`{items:{}}`) junto com a sala, então a gravação é sempre `update` com merge recursivo: **idempotente e livre de corrida**, sem set/update racing. Classificação continua calculada lendo as partidas, sem total denormalizado. 256 KiB seguram ~1.000+ partidas.

2. **`A32` inclui `L`.** A spec (3.2) diz que o alfabeto exclui `0 1 I L O`; o `A32` real exclui só `0 1 I O`. Usei o `A32` de verdade e a mensagem de erro ficou "nada de O, I, 0 ou 1".

3. **Campo de senha aparece assim que a pessoa esconde (3.3.5).** Quem escondeu vai direto pra tela de palpite e já pode arriscar, mesmo antes dos outros mostrarem. A lista de adversários (bloco de notas, 3.4) só aparece quando **todos** os participantes revelaram (`fase: "jogando"`).

4. **Colocação = ordem de acerto observada, com `acertouEm` só como desempate.** Guardo `acertouEm` (como a spec pede) mas a posição vem da contagem de quem já acertou no momento do envio — imune a relógio torto entre celulares (comum), exceto no caso raro de dois envios exatamente simultâneos.

5. **Sem transferência de host.** Se quem criou a sala nunca mais voltar, ninguém mais começa partida nem apaga a sala. Não estava na spec.

6. **Rage-quit no meio da partida.** Se um participante fecha o app no meio sem terminar, a rodada trava até ele voltar (pela lista "Suas salas") e terminar. A lista de participantes congela no "Começar". O split roster/participantes (3.7) cobre "não veio hoje"; sair no meio é outro caso. Saída: `apagar` + recomeçar.

7. **Só `capabilities: {db: {}}`** — sem `user`, sem regras custom. Identidade é `jogadorId` (UUID no `localStorage` por sala), não o id do viewer. Leitura/escrita compartilhada padrão bate com o acordo de cavalheiros do 3.3.

8. Arquivo passou de 57 KB para ~115 KB (limite de Artifact é 16 MB).

**Publicar:** redeploy no mesmo URL do Artifact com `capabilities: {db: {}}`.
