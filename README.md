# Quem Sou Eu

Jogo de adivinhar quem você é, para jogar **presencialmente** — todo mundo na
mesma mesa, cada um com o celular na testa.

O que é online aqui não é o jogo: é a **sessão**. Quem é quem, o estado ao vivo
entre os aparelhos da mesma mesa, a pontuação e o histórico. Não há partida à
distância, chat nem matchmaking; se as pessoas não estiverem juntas, o jogo não
faz sentido.

## Três modos

| Modo | Precisa de rede? | Como funciona |
|---|---|---|
| **Clássico** | não | Um código de 7 caracteres **é** a configuração. Cada aparelho deriva as cartas sozinho. |
| **Mesa** | não | Código de 5 números com tema, nível, número de pessoas e semente. Revelação única por rodada. |
| **Sala** | sim | Estado compartilhado no Firestore: nicks, quem já revelou, colocação, histórico permanente. |

Os dois primeiros são determinísticos: o código carrega tudo, e nada trafega
entre celulares. É o que mantém o jogo inteiro funcionando em modo avião.

## Baralho

1.578 cartas em 16 grupos e 3 níveis cumulativos, calibradas para um brasileiro
de uns 30 anos. `node audit.js` audita duplicatas, cobertura por nível e
tamanho de cada tema.

## Pontuação

Uma partida de N pessoas é um torneio de todos contra todos: terminar em Pº
significa passar (N−P) pessoas e ser passado por (P−1).

```
saldo = (N − P) − (P − 1) = N − 2P + 1
```

Ganhar de 7 vale +7; ganhar de 1 vale +1. **A soma de toda partida é zero** —
não adianta juntar sempre a mesma turma para inflar o rank de todos. Cada
perfil carrega também o **aproveitamento** — `(N−P)/(N−1)`, média esperada 50%
com qualquer N — para comparar quem joga muito com quem joga pouco.

## Arquitetura

Sem framework, sem transpilação. ES5 puro, porque é um jogo de festa que precisa
rodar em celular velho.

```
quem-sou-eu-temas.html   o jogo inteiro: telas, estilo e lógica
pontuacao.js             saldo e aproveitamento
contas.js                perfil, apelido único, amizades, rank
rank-server.js           pontua a partida do lado do servidor (roda na Function)
firestore-adapter.js     contrato de db da capability sobre o SDK do Firebase
firebase-boot.js         carrega o SDK, monta o db, login por link mágico
firestore.rules          regras de segurança
functions/index.js       Cloud Function derivarRank: agregado do rank pelo Admin SDK
build.js                 monta public/index.html; --stage-functions copia p/ functions/
```

O jogo fala **um contrato de banco só** (`doc`/`collection`/`get`/`set`/`update`
/`delete`/`onSnapshot`/`acquire`). O adaptador o entrega por cima do Firestore,
então `CriarSalaCliente(db)` não sabe de onde vem o banco — e o mesmo suite de
testes prova os dois backends. `rank-server.js` fala o mesmo contrato: os testes
o exercitam contra o db falso, e a Cloud Function o chama em produção.

## Rodando

```bash
npm install
npm run build      # gera public/index.html
npm test           # 15 suites
npm run test:regras  # regras de segurança no emulador (precisa de Java)
npm run deploy     # build + Firebase Hosting
```

A Cloud Function `derivarRank` (`functions/`) exige o **plano Blaze**. Deploy
separado, depois de `npm install` dentro de `functions/`:

```bash
npx firebase deploy --only functions,firestore:rules --project quem-sou-eu-e3e32
```

O predeploy (`node build.js --stage-functions`) copia `rank-server.js` e
`pontuacao.js` para dentro de `functions/` — o deploy só sobe esse diretório.

## Sobre as chaves em `firebase-config.js`

São **públicas por natureza**: viajam no JavaScript que roda no navegador de
todo jogador. Não há como escondê-las e não há por que tentar — quem protege o
banco é o `firestore.rules`, não o sigilo delas.

O que nunca entra no repositório é a chave de conta de serviço, que ignora todas
as regras. Este projeto não usa nenhuma.

## Limites conhecidos

**O host da sala dita o resultado.** O agregado do rank não é mais escrito pelo
cliente: a Cloud Function `derivarRank` dispara quando o host grava o resultado
em `salas/{codigo}/hist`, pontua com `pontuacao.js` e escreve
`usuarios/{uid}/partidas` + `perfis/{uid}` pelo Admin SDK. As regras tiraram
essas duas escritas do cliente, então inflar o próprio saldo pelo console não
funciona mais. O que resta: quem é **host** de uma sala escreve o `hist` dela, e
a função confia nesse resultado — um host mal-intencionado consegue deslocar o
rank dos participantes daquela sala (não o próprio à toa, e só de quem esteve
com ele). Fechar isso exigiria validar jogada a jogada.

**O código do Modo Mesa detecta ~98% dos erros de digitação.** Tema e nível
passaram a ser empacotados juntos (6 bits em vez de 7) e o campo de semente saiu
— os 3 bits liberados foram para o checksum, que subiu de 3 para 6 bits. Hoje um
erro de um dígito vira outra partida válida em **~1,6%** das vezes (era 6,81%),
sem erro na tela. O preço: o mesmo tema+nível+n distribui sempre as mesmas
cartas, sem variação de replay.

## Licença

Sem licença definida. Todos os direitos reservados.
