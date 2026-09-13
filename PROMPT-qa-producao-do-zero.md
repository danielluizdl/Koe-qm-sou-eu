# Spec confirmada — QA de produção do zero (10 contas reais)

Status: **aguardando credenciais do dono para começar a Fase 0.** Gerada via
interrogação no formato do skill `/spec` (gstack), adaptado ao formato local
dos outros `PROMPT-*.md` deste repo — sem esteira de GitHub issue, sem gate de
qualidade externo, sem spawn de agente: este projeto não usa nenhum dos três.

## Por quê agora

Sessão anterior fechou os "8 ajustes" e a mudança de ranking geral pra
client-side (opção B), mas terminou com 3 pendências não resolvidas (ver
`[[quem-sou-eu-ranking-geral-opcao-b]]` na memória do projeto). O dono quer
zerar produção e provar, com contas novas e de ponta a ponta, que tudo
funciona — inclusive resolvendo essas 3 pendências no caminho — antes de
seguir usando o app de verdade.

## Decisões já fechadas pelo dono (passo 0 — não reabrir)

1. **Apagar contas, inclusive a do dono.** Não existe service-account neste
   projeto (de propósito, `firebase-config.js:8-10`), então não dá pra apagar
   Auth users em massa por script. O dono vai fornecer e-mail+senha de cada
   conta a apagar (a dele + as 3 de teste antigas, quando souber a senha); o
   script loga como cada uma e se auto-apaga (`deleteUser(auth.currentUser)`).
2. **Enfraquecer `firestore.rules` temporariamente.** `perfis/{uid}` tem
   `allow delete: if false` (linha 127) — histórico de ranking permanente, de
   propósito (README, seção "Pontuação"). Pra este QA, o dono aceitou trocar
   por uma condição que libere apagar o próprio perfil, fazer deploy, rodar a
   limpeza, e **reverter + redeploy** antes de seguir pra Fase 1. Janela de
   exposição: só a duração da limpeza.

## Contexto verificado no código

| Peça | Onde | O que faz |
|---|---|---|
| Único script que cria contas REAIS em produção | `test-e2e-real.js` | Auth real + `contas.js#criar`, limpa `usuarios/nicks` no fim; **não apaga `perfis/` nem o Auth user da segunda conta em todos os casos** — é o modelo a estender, não `test-salas.js` (usa `firestore-fake.js`, em memória, não é produção). |
| Amizade automática | `contas.js:491` `A.amizadeAutomatica(uid, outros)` | "Jogou junto, virou amigo. Sem pedido, sem confirmação." Idempotente; ignora quem não tem conta (convidado da mesa). É a pendência "já tão se adicionando automaticamente". |
| Ranking por sala | `quem-sou-eu-temas.html`, aba "Classificação" do histórico, `calcClassificacao` | Usa `pontuacao.js` (saldo = N−2P+1, soma zero por partida). |
| Ranking geral | Tela "Pontuação", `contas.js#rankAmigos(uid)` | Lê `perfis/{uid}` de você + amigos aceitos, mesma fórmula. 100% client-side desde 2026-09-11 (sem Cloud Function; ver `[[quem-sou-eu-ranking-geral-opcao-b]]`). |
| Cada jogador grava o próprio resultado | `contas.js#registrarResultado`, disparado em `concluirAvaliar()` | `firestore.rules` cruza contra `salas/{codigo}/hist/registro` (só o host escreve) antes de aceitar. |
| Regra de perfis | `firestore.rules:127` | `allow delete: if false` — alvo da mudança temporária da Fase 0. |
| Regra de nicks | `firestore.rules:189-196` | Só quem está autenticado como o dono do nick pode apagá-lo (`anterior().uid == request.auth.uid`) — **se o Auth user for apagado antes do nick, o nick fica órfão para sempre.** Ordem de limpeza importa (ver Fase 0). |

## Pendências herdadas — como cada uma é resolvida nesta spec

1. **Tela de avaliação não apareceu ao reconectar.** Suspeita: artefato do
   método de teste anterior (trocar de conta no mesmo navegador via
   `location.reload()` em sequência rápida corrompe o `localStorage`, que é a
   pendência #3). Nesta rodada, cada conta roda em processo Node isolado
   (como `test-e2e-real.js` já faz para 2 contas) — sem `localStorage`
   compartilhado, sem confundir as duas causas. Se o sintoma voltar mesmo
   assim, é bug real e entra no relatório final; se não voltar, a causa raiz
   fica confirmada como o método de teste antigo, não o produto.
2. **3 contas de teste antigas em produção.** Apagadas na Fase 0 junto com a
   do dono, se as senhas forem fornecidas. Se alguma senha não existir mais,
   o dono apaga aquela pelo Console e o script pula.
3. **Cache local não isolado por conta.** Testado diretamente: dentro do
   mesmo cenário de troca de conta (item 1), verificar que o `jogadorId`
   salvo em `quemsoueu:salas` não vaza de uma conta pra outra quando os dois
   processos são isolados. Continua sendo um problema real só em aparelho
   físico compartilhado — não corrigido nesta spec (fora de escopo, já
   documentado), só **reverificado** como causa da pendência 1.

## Fase 0 — Limpeza de produção

**Pré-requisito:** dono fornece e-mail+senha de cada conta a apagar.

1. Deploy da regra temporária: `perfis/{uid}` aceita `allow delete: if eu(uid)`.
2. Para cada conta, **nesta ordem** (evita órfão, ver tabela acima):
   login → apagar `nicks/{chave}` própria → apagar `usuarios/{uid}` (recursivo:
   `amigos/`, `partidas/`, `salas/`) → apagar `perfis/{uid}` → apagar salas
   onde a conta é `hostId` (regra já permite) → `deleteUser(auth.currentUser)`.
3. Reverter `firestore.rules` pra `allow delete: if false` e redeploy.
4. **Aceite:** `firebase firestore:indexes`/console mostra zero documentos em
   `perfis/`, `usuarios/`, `nicks/` para os UIDs apagados; `signInWithEmailAndPassword`
   com as credenciais antigas retorna `auth/invalid-credential` ou
   `auth/user-not-found`; `firestore.rules` de volta ao original (diff vazio
   contra o commit anterior a esta spec, exceto se algo mais mudou).

## Fase 1 — 10 contas novas, como pessoas reais criariam

Nomes/nicks/e-mails variados (não `qatest1..10` sequencial): primeiro nome +
sobrenome brasileiros comuns, nick derivado com variação (apelido, ano de
nascimento, número aleatório) do jeito que gente de verdade escolhe. Senhas
de 6+ dígitos distintas. Criadas com pequeno espaçamento entre si (não em
paralelo instantâneo) pra não parecer tráfego de bot.

**Aceite:** 10 UIDs novos, 10 `perfis/{uid}` com `partidas: 0, saldo: 0`, 10
nicks únicos reservados, nenhum e-mail duplicado.

## Fase 2 — Matriz de cenários de sala

| # | Sala | Participantes | Sequência | O que prova |
|---|---|---|---|---|
| A | 1 sala, todos juntos | 10/10 | 2 partidas seguidas, placares diferentes | Ranking da sala (Classificação) agrega certo pra grupo grande; amizade automática cria 45 arestas (C(10,2)) após a 1ª partida |
| B | 2 salas separadas, sem sobreposição | 5 + 5 | 1 partida cada, em paralelo | Rankings de sala não vazam entre si; ranking geral de cada jogador só conta amigos de sua própria sala |
| C | 2 salas com sobreposição parcial | sala 1: jogadores 1-6; sala 2: jogadores 5-10 | sala 1 primeiro, depois sala 2 | Jogadores 5 e 6 acumulam amigos das duas salas; ranking geral deles é maior (mais amigos) que o dos exclusivos de uma sala só |
| D | Reconexão | 1 jogador da sala A sai (fecha o processo) e reentra com o mesmo código antes do fim da rodada | — | Isola pendência 1: avaliação de dificuldade aparece/é registrada mesmo após reconexão, em processo isolado (sem `localStorage` cruzado) |
| E | Sala solo | 1 jogador tenta abrir/jogar sozinho | — | Confirma o limite conhecido (mínimo de jogadores) se existir — não é bug, é comportamento esperado a documentar no relatório se divergir do README |

**Aceite objetivo por cenário:**
- A: `calcClassificacao` da sala soma saldo zero por partida (bate com
  `pontuacao.js` calculado à parte para o mesmo `ordem`); 45 pares de amigos
  existem em `usuarios/*/amigos`.
- B: nenhum UID da sala 1 aparece nos amigos de ninguém da sala 2; `perfis/`
  de cada jogador reflete só as próprias partidas.
- C: jogadores 5 e 6 têm `amigos` maior que os outros 8; `rankAmigos` de cada
  um lista corretamente só quem é amigo de fato (aceito), não pendente.
- D: `usuarios/{uid}/partidas/{pid}` da partida em questão existe com nota de
  dificuldade registrada em `cartas/{slug}/votos/{uid}_{pid}` para a carta do
  jogador que reconectou.
- E: comportamento bate com o documentado no README (mínimo de jogadores por
  modo); se não bater, vai pro relatório como achado.

## Como cada verificação é feita

Estender `test-e2e-real.js` — mesmo padrão (Auth real + `contas.js` real +
Firestore real do projeto `quem-sou-eu-e3e32`), generalizado de 2 para N
contas parametrizáveis, com um "device" Node por conta (processo/contexto
isolado, sem estado compartilhado) simulando o fluxo real de sala: criar/
entrar com código, jogar rodada, `concluirAvaliar` (avaliação obrigatória +
`registrarResultado`), ler `calcClassificacao` e `rankAmigos` ao final. Não
usar `test-salas.js`/`firestore-fake.js` para esta verificação — aquele
suite prova lógica em memória, não produção real.

## Fora de escopo

- **Corrigir bugs novos encontrados durante os cenários A-E.** Esta spec é
  teste e relato. Se um cenário revelar um bug que não é uma das 3
  pendências já combinadas, ele entra no relatório final para o dono decidir
  com a "engenharia" — não é corrigido nesta sessão.
- **Corrigir a pendência 3 (cache não isolado por conta) de fato.** Só
  reverificada como causa da pendência 1; a correção em si (isolar
  `quemsoueu:salas` por uid) é trabalho futuro, fora desta spec, exatamente
  como já estava documentado.
- **Testar os modos Clássico e Mesa.** Não usam conta nem rede; nada aqui
  muda esses modos.
- **Deixar a regra de `perfis/` enfraquecida além da janela de limpeza.** A
  Fase 0 já inclui reverter — não é uma mudança permanente de segurança.

## Effort estimate

| Parte | Estimativa |
|---|---|
| Fase 0 — regra temporária + script de limpeza + revert | ~30min |
| Fase 1 — script de criação de 10 contas realistas | ~15min |
| Fase 2 — extensão de `test-e2e-real.js` pros 5 cenários | ~1h30 |
| Rodar tudo contra produção + coletar evidência (dumps de `perfis`/`usuarios`/`nicks`) | ~20min |
| Relatório final de achados | ~15min |

## Rollback

Cada etapa é aditiva ou reversível: a regra volta ao original com um segundo
deploy; contas novas não afetam nada existente; nenhuma escrita em `salas/`
ou `perfis/` de terceiros. Se algo falhar no meio da Fase 0 (ex.: metade das
contas apagadas), a regra permanece revertida no final de qualquer forma —
não fica "meio aberta" entre sessões.

## Arquivos de referência

| Arquivo | Papel nesta spec |
|---|---|
| `firestore.rules:127` | Alvo da mudança temporária (Fase 0) |
| `firestore.rules:189-196` | Ordem de apagar (nick antes do Auth user) |
| `test-e2e-real.js` | Modelo a estender para N contas e os 5 cenários |
| `contas.js:491` (`amizadeAutomatica`) | O que a Fase 2 verifica |
| `pontuacao.js` | Fórmula usada para validar `calcClassificacao` e `rankAmigos` |
| `quem-sou-eu-temas.html` (`calcClassificacao`) | Ranking de sala sob teste |

## Related

- `[[quem-sou-eu-ranking-geral-opcao-b]]` — origem das 3 pendências
- `[[quem-sou-eu-testes-verificar-empiricamente]]` — método de verificação
