# Spec confirmada — 8 ajustes (login, ID, sala, gameplay, avaliação de carta)

Status: **implementação concluída — as 8 capacidades (C1-C8) estão commitadas e
no `origin/main`.** Gerada via skill `/spec` (gstack), Fases 1-4.

Commits: C1 `ee7ca05`/login server + wiring, C2/C3 `ee7ca05`/`68b103e`,
C4 `5594042`, C5/C5.1 `eae5eec`, C6 `bbf386b`, C7 `763220b`, C8 `70ccc9e`.
Toda capacidade fechou com `npm test` (16 suites) e `npm run test:regras`
(81 casos) verdes antes do commit — nenhuma foi dada como pronta sem
rodar o teste real listado no "Aceite".

Antes de implementar: `npm test` deve estar verde (15 suites) e `npm run test:regras`
também (66 testes) — é a baseline do commit `2b6d4e2`. Se alguém mexeu no meio
tempo, rodar de novo antes de continuar daqui.

## Contexto verificado no código (não suposição)

| # | Local | Estado atual confirmado |
|---|---|---|
| 1 | `firebase-boot.js` `entrar()` | Login só aceita e-mail |
| 2 | `contas.js:90-99` | ID = 6 chars do alfabeto A32 (letras+números), aleatório |
| 3 | `contas.js` `A.buscar` | Já aceita nick OU ID, com/sem `#` — **já pronto**, só muda o formato do ID |
| 4 | `quem-sou-eu-temas.html:952` | Grupo `id:"anime"` existe separado de `id:"animacao"` |
| 5 | `quem-sou-eu-temas.html:1637` | `codigoAleatorio()` gera 5 chars do alfabeto A32 (letras+números) |
| 5.1 | `quem-sou-eu-temas.html:509-514` | Campo `#create-code-input` deixa o host digitar/sortear antes de criar |
| 6 | `entrarComCodigo` → `SC.abrir` → `irParaNick("identificar",...)` | **Bug confirmado**: entrar numa sala nova mostra apelido livre mesmo logado. Criar sala já usa `CONTA.perfil.nick` automaticamente — entrar, não |
| 7.1-7.4 | `#play-mesa-sec`, `#play-notas-sec` | Existem; sem toggle de esconder, sem relógio, sem highlight de acerto. Campo `acertouEm` (timestamp) já existe por jogador — construir em cima |
| 8 | — | Não existe nada — coleção nova |

## As 8 capacidades — todas as decisões fechadas

### C1 — Login por nick ou e-mail
`firebase-boot.js` `entrar(identificador, senha)`: se contém `@`, e-mail direto;
senão, resolve nick → e-mail via `contas.js A.porNick` antes de
`signInWithEmailAndPassword`. Rótulo da UI: "Nick ou e-mail".
**Aceite:** `test-conta-ui.js` — logar com nick funciona; logar com e-mail
continua funcionando; nick inexistente dá "e-mail ou senha não conferem" (não
vaza se o nick existe).

### C2 — ID numérico sequencial de 5 dígitos
Trocar `sortearId()` por contador atômico (`contadores/id` com
`FieldValue.increment(1)` em transaction), `String(n).padStart(5,"0")`.
**Confirmado:** renumerar as 2 contas de teste existentes (`teste`, `dlzin`) —
sem usuário de produção, custo zero.
**Efeito colateral aceito conscientemente:** ID sequencial exposto publicamente
revela quantos cadastros existem (`#00042` = já teve ≥42 contas). Troca aceita
por simplicidade num jogo de festa entre amigos.
**Aceite:** `test-contas.js` — dois cadastros seguidos geram `#00001`/`#00002`;
concorrência nunca gera o mesmo número.

### C3 — Amigo por nick ou ID sem "#"
Já funciona (`A.buscar`) — só muda placeholder pra "nick ou número do ID" e
testa contra o novo formato numérico.
**Decisão (sem precisar perguntar, risco desprezível):** nick já pode ser só
números hoje; resolvo tentando nick primeiro, ID como fallback, sem mudar regra
de cadastro.
**Aceite:** `test-contas.js` — buscar "00001" acha por ID; nick numérico
existente acha pelo nick primeiro.

### C4 — Remover "Anime", mesclar os famosos em "Desenhos" (`animacao`)
**Confirmado:** migrar o nível **fácil** de `anime` (Goku, Naruto, Pikachu,
Sailor Moon, Doraemon etc.) pro nível fácil de `animacao`; descartar
médio/difícil de anime inteiros (Saitama, Edward Elric, etc.).
**Aceite:** `audit.js` continua passando (sem duplicata, sem grupo vazio);
`test.js` não quebra a contagem de cartas por nível.

### C5 — Código de sala: 4 dígitos, sem letras
`codigoAleatorio()` vira `Math.floor(Math.random()*10000)` com zero-pad de 4;
`normCodigo()` filtra só `[0-9]`, corta em 4 chars.
**Risco aceito, não é mais pergunta:** 10.000 combinações (era 33 milhões) —
ok pra jogo presencial entre amigos.
**Cuidado técnico:** os três formatos de código ficam inconfundíveis por
tamanho (4 sala / 5 mesa / 7 clássico) — confirmar em teste que 4 dígitos nunca
é lido como início de código Mesa.
**Aceite:** `test-salas.js` (2 backends) — código gerado sempre `/^[0-9]{4}$/`;
`test-mesa.js` continua passando.

### C5.1 — Tirar a caixa de sortear código
Remove `#create-codigo` da tela de criar; código sai de `codigoAleatorio()`
direto em `criarSalaOnline()`, exibido em destaque na primeira tela do lobby.
**Aceite:** `test-navegador.js` — tela de criar sala sem o campo de código;
lobby mostra o código como primeira coisa visível (`getComputedStyle` real).

### C6 — Nick imutável ao entrar na sala (bug corrigido)
`entrarComCodigo`, ao receber `res.precisaNick` de conta logada, chama
`criarComNick(CONTA.perfil.nick)` (mesma função que criar sala já usa) em vez
de `irParaNick("identificar", membros)`.
**Aceite:** `test-conta-ui.js` — entrar numa sala nova, logado, nunca mostra
`#s-nick`; jogador aparece na sala com o apelido da conta.

### C7 — Tela de jogo: esconder mesa, anotações maiores, relógio, highlight
- **7.1** botão esconder/minimizar em `#play-mesa-sec`, estado em
  `localStorage` por sala (não global).
- **7.2** `#play-notas` de `rows="3"` pra `rows="6"` (ou `flex:1`).
- **7.3** novo campo `sala.iniciadaEm` (timestamp gravado pelo host na
  transição pra fase "jogando" — não existe hoje). Relógio em `setInterval`
  mostrando `agora - iniciadaEm`; ao acertar, mostra o tempo congelado
  (`acertouEm - iniciadaEm`).
- **7.4** linhas de `#play-oponentes`: jogador com `acertou` ganha borda verde
  + posição + tempo (dados `acertouEm`/`posicao` já existem).
**Aceite:** `test-navegador.js` (Chrome real) — esconder muda `display` de
verdade; relógio incrementa entre duas leituras; acerto tem `border-color`
verde computado.

### C8 — Avaliação de dificuldade por carta (0-5)
**Confirmado:** cada jogador avalia **todas as cartas da rodada, incluindo a
própria**. **Obrigatório** antes de sair da tela de fim.

Contrato de dados (client-write direto — sem valor de trapaça, diferente do
saldo):
```
cartas/{cartaSlug}                         doc agregado
  { nome, soma, contagem, mediaCache, atualizadoEm }
cartas/{cartaSlug}/votos/{uid}_{pid}       um voto por pessoa por partida (dedupe)
  { uid, pid, nota, em }
```
`cartaSlug` = a própria string da carta normalizada (chave já usada em
`wordFor`/`GROUPS`).
**Regra de segurança:** create-only em `votos/{uid}_{pid}` com
`uid == request.auth.uid`; update do agregado via `increment()` positivo
apenas, nunca decrementa nem sobrescreve (mesmo padrão já provado em `_locks`).
**Fluxo de UI:** nova tela entre o pódio e a home, todas as cartas da partida
listadas com um slider 0-5 cada, sem botão "pular" (obrigatório) — só avança
depois de avaliar todas.
**Aceite:** `test-regras.js` — não vota duas vezes na mesma partida na mesma
carta; não escreve voto em nome de outro uid; agregado nunca aceita valor
negativo.

## O que fica fora (corte deliberado, não regressão)
- Sem tela/ferramenta pra mover cartas de tier manualmente — C8 só **coleta o
  dado**. Mover carta continua manual (editar `GROUPS` olhando o agregado).
- Modo Mesa e Clássico não mudam — já são o que já são.

## Ordem de implementação
```
C2 (ID) ──┬─> C3 (busca por ID)
          └─> (nada mais depende)
C5 ──> C5.1 ──> C6   (mesmo fluxo de sala: código, depois tela, depois nick)
C1, C4, C7, C8 — independentes entre si, qualquer ordem
```

## Antes de fechar cada capacidade
1. Implementar
2. Rodar o teste real listado no "Aceite" — nunca inferir que passou
3. `npm test` completo + `npm run test:regras` não podem regredir
4. Commitar (checkpoint contínuo ligado — commits `WIP:` automáticos por
   unidade verificada; squash/mensagem final ao fechar a capacidade inteira)
