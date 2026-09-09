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
firestore-adapter.js     contrato de db da capability sobre o SDK do Firebase
firebase-boot.js         carrega o SDK, monta o db, login por link mágico
firestore.rules          regras de segurança
build.js                 monta public/index.html concatenando o acima
```

O jogo fala **um contrato de banco só** (`doc`/`collection`/`get`/`set`/`update`
/`delete`/`onSnapshot`/`acquire`). O adaptador o entrega por cima do Firestore,
então `CriarSalaCliente(db)` não sabe de onde vem o banco — e o mesmo suite de
testes prova os dois backends.

## Rodando

```bash
npm install
npm run build      # gera public/index.html
npm test           # 12 suites
npm run test:regras  # regras de segurança no emulador (precisa de Java)
npm run deploy     # build + Firebase Hosting
```

## Sobre as chaves em `firebase-config.js`

São **públicas por natureza**: viajam no JavaScript que roda no navegador de
todo jogador. Não há como escondê-las e não há por que tentar — quem protege o
banco é o `firestore.rules`, não o sigilo delas.

O que nunca entra no repositório é a chave de conta de serviço, que ignora todas
as regras. Este projeto não usa nenhuma.

## Limites conhecidos

**O agregado do rank é declarado pelo cliente.** Uma regra do Firestore não
consegue provar que o saldo declarado corresponde a uma partida real — isso
exigiria ler as partidas de todos os participantes. Alguém com conhecimento
técnico consegue inflar o próprio saldo pelo console do navegador. As partidas
ficam gravadas e imutáveis em `usuarios/{uid}/partidas`, então dá para
recalcular e ver a divergência. A correção definitiva é uma Cloud Function.

**O código do Modo Mesa detecta ~93% dos erros de digitação.** Quando o formato
passou a guardar o tema, o checksum caiu de 6 bits para 3. Hoje um erro de um
dígito vira outra partida válida em **6,81%** das vezes — cerca de 1 em 15 — sem
erro na tela, e a mesa recebe cartas que não combinam. Corrigir exige um dígito
a mais ou menos sementes.

## Licença

Sem licença definida. Todos os direitos reservados.
