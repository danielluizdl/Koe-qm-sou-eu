# Prompt — Home navegável, perfil com ID, minhas salas, pontuação e amizade automática

## Missão

Transformar a home de **cartaz** em **painel**. Hoje, depois de logar, a
pessoa continua vendo a mesma capa de apresentação — eyebrow, logotipo
gigante, frase de venda e contagem de cartas — com dois botões embaixo.
Isso serve para quem chega; não serve para quem já entrou e quer jogar.

Cinco entregas, nesta ordem de dependência:

1. **ID de jogador** — gerado no cadastro, é como se adiciona e convida
2. **Perfil no topo** — círculo com inicial, abre tudo sobre a pessoa
3. **Home em ambientes** — quatro destinos claros no lugar da capa
4. **Minhas salas** — onde a pessoa já jogou, e quem estava lá
5. **Amizade automática** — jogou junto, virou amigo

---

## 1. Como o jogo está hoje (leia antes de escrever qualquer linha)

| Onde | O quê |
|---|---|
| `quem-sou-eu-temas.html` | O jogo inteiro. ES5 puro, sem framework. 19 telas trocadas por `show(id)` |
| `contas.js` | `CriarContas(db)` — perfil, apelido único, amizades, rank. Fala o contrato de db da capability |
| `perfis/{uid}` | **PÚBLICO**: nick, nickChave, anonimo, agregado do rank |
| `usuarios/{uid}` | **PRIVADO**: nome, e-mail. Só o dono lê |
| `usuarios/{uid}/amigos/{outro}` | Uma aresta por lado. Regra deixa escrever a que aponta pra você |
| `usuarios/{uid}/partidas/{pid}` | Histórico imutável |
| `nicks/{chave}` | Índice de unicidade → uid |
| `firestore.rules` | 50 testes no emulador. **Toda coleção nova precisa de regra e de teste** |

Persistência local relevante: `quemsoueu:salas` no `localStorage` guarda
as salas daquele **aparelho**. É o que "Minhas salas" precisa substituir.

**Restrições que não se negociam:**

- ES5 no arquivo do jogo (`var`, `function`, sem arrow, sem template literal)
- Nada quebra sem Firebase: rodando como Artifact ou offline, o jogo
  continua inteiro nos modos que não precisam de rede
- Todo `hidden` depende de `[hidden]{display:none !important}` — regra do
  autor vence a do navegador, e sem ela `hidden` não esconde nada
- O teste que vale é `test-navegador.js`, que abre no Chrome de verdade.
  DOM simulado não enxerga CSS

---

## 2. ID de jogador

**Por quê:** o apelido já é único, mas muda. O ID não muda nunca — é o
que a pessoa manda no grupo do WhatsApp pra ser adicionada.

**Formato:** 6 caracteres do alfabeto `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`
(o mesmo `A32` que o jogo já usa para códigos). Sem `0`, `1`, `I` e `O`
— quem lê em voz alta não confunde com O e L. Exibido como `#K7M2XA`.

**Unicidade:** mesmo padrão já provado do apelido — coleção `ids/{id}`
apontando pro uid, reservada com `acquire` antes de gravar. Em colisão,
sorteia outro (até 8 tentativas).

**Onde mora:** campo `id` em `perfis/{uid}` (público — é preciso para
alguém te achar) e a coleção `ids/{id} → {uid}`.

**Contas que já existem** não têm ID. Gerar sob demanda na primeira vez
que o perfil for lido sem ele, sem pedir nada à pessoa.

**Busca:** o campo de adicionar amigo aceita **apelido ou ID**. Se o
texto tiver 6 caracteres do alfabeto e não existir como apelido, procura
como ID. Aceitar com ou sem `#`.

---

## 3. Perfil no topo

Um círculo de 40px no canto superior direito, com a **inicial do
apelido**. Presente em todas as telas de navegação (home, salas,
pontuação), ausente durante a partida — ali nada pode distrair.

Tocar abre `s-conta`, que passa a mostrar:

- Apelido em destaque, nome completo abaixo
- **O ID, em fonte mono, com um toque para copiar** (`navigator.clipboard`,
  com aviso de confirmação; o jogo já tem `toast()` e um helper de cópia)
- Botão **Convidar** que usa `navigator.share` quando existe, com um texto
  pronto: apelido, ID e o link do jogo
- Os quatro números do agregado (saldo, aproveitamento, partidas, vitórias)
- E-mail (só o dono vê — vem do documento privado)
- Sair da conta

---

## 4. Home em ambientes

**Deslogado:** a capa continua exatamente como está. Ela é boa para quem
chega — logotipo, frase, contagem de cartas, `Entrar` e `Criar conta`.

**Logado:** a capa **some**. No lugar:

```
                                          (K)   ← avatar, canto superior direito
  Olá, Keko

  ┌──────────────────────────────────┐
  │  Criar sala                    › │   ação principal, destaque
  └──────────────────────────────────┘
  ┌──────────────────────────────────┐
  │  Entrar com código             › │
  └──────────────────────────────────┘
  ┌──────────────────────────────────┐
  │  Minhas salas                  › │
  │  3 salas · 12 partidas           │   ← subtítulo com número real
  └──────────────────────────────────┘
  ┌──────────────────────────────────┐
  │  Pontuação                     › │
  │  +14 de saldo · 2º entre amigos  │
  └──────────────────────────────────┘
```

Os subtítulos carregam **número de verdade**, nunca rótulo genérico. Um
painel que diz "veja suas salas" não informa nada; um que diz "3 salas ·
12 partidas" responde antes de a pessoa tocar. Enquanto os dados não
chegam, o subtítulo fica vazio — nunca "carregando…", que é ruído.

Reaproveitar a classe `.row` que já existe. Não inventar componente novo.

---

## 5. Minhas salas

**Tela nova `s-salas`.** Lista as salas em que a pessoa jogou, da mais
recente para a mais antiga. Cada linha: código, quantas partidas, quando
foi a última.

Tocar numa sala abre o detalhe: **quem estava lá** (apelido de cada
participante) e um botão para voltar a jogar naquela sala.

**Onde mora:** `usuarios/{uid}/salas/{codigo}` — privado, com
`{ codigo, entrouEm, ultimaEm, partidas }`. Escrito pelo próprio
aparelho quando entra numa sala e quando termina uma partida.

Isso **substitui** o `quemsoueu:salas` do `localStorage`, que só valia
naquele celular. O local vira cache: se o Firestore responder, ele manda.

Para "quem está nela", ler `salas/{codigo}/jogadores` — a regra já
permite leitura para quem está logado.

---

## 6. Pontuação

**Tela nova `s-pontuacao`**, que absorve o que hoje está espalhado:

- **Seus números** em destaque: saldo, aproveitamento, partidas, vitórias
- **Classificação entre amigos** — a `rankAmigos` que já existe, com você
  destacado na lista
- Um caminho para a tela de amigos (adicionar, pedidos)

A tela de amigos (`s-amigos`) continua existindo, mas deixa de ser o
lugar do ranking: vira só gestão de amizade. Ranking é assunto de
pontuação.

**Explicar o saldo sem manual.** Uma linha abaixo do número:
"ganhar de 7 vale +7; de 1 vale +1". Quem vê "+14" sem contexto não sabe
se é bom.

---

## 7. Amizade automática

Ao terminar uma partida, **cada aparelho** adiciona os outros
participantes como amigos, já em `aceito`, sem pedido nem confirmação.

**Por que cada aparelho, e não o host:** a regra de segurança só deixa
escrever a aresta cujo id é o seu próprio uid. É o que impede alguém de
casar duas pessoas quaisquer. Então cada um escreve os dois lados da
**sua** relação — permitido — e nunca a relação de terceiros.

**Idempotente:** se já são amigos, não faz nada. Se havia pedido
pendente, promove para aceito.

**Só vale para quem tem conta.** Participante convidado (sem uid do Auth)
é ignorado, sem erro.

**A implicação, dita em voz alta:** jogar com alguém expõe seu perfil
público a essa pessoa — apelido, ID e agregado. Como o jogo é presencial
e vocês estão na mesma mesa, é aceitável. Mas precisa aparecer na tela de
fim de partida: "Vocês agora são amigos" com a lista de quem entrou.
Adicionar em silêncio seria uma surpresa desagradável.

---

## 8. O que testar

Toda entrega precisa passar por `npm test` (14 suites) e, para o que é
visual, por `test-navegador.js`. Especificamente:

| Comportamento | Onde provar |
|---|---|
| ID gerado, único, 6 caracteres do A32 | `test-contas.js`, nos dois backends |
| Conta antiga ganha ID sem pedir nada | `test-contas.js` |
| Achar amigo por ID, com e sem `#` | `test-contas.js` |
| Capa some depois de logar | `test-navegador.js`, com `getComputedStyle` |
| Avatar aparece logado, some na partida | `test-navegador.js` |
| Os quatro ambientes abrem as telas certas | `test-navegador.js` |
| Subtítulos com número real | `test-navegador.js` |
| Minhas salas lista e mostra quem estava | `test-conta-ui.js` |
| Amizade automática nos dois lados | `test-contas.js` |
| Amizade automática ignora convidado | `test-contas.js` |
| Regra permite os dois lados da própria relação | `test-regras.js` |
| Regra recusa aresta entre terceiros | `test-regras.js` |
| `ids/` só pode ser reservado pelo dono | `test-regras.js` |

---

## 9. Ordem sugerida

1. ID no `contas.js` + regra de `ids/` + testes — tudo depende dele
2. Amizade automática no `contas.js` + regra + testes — não mexe em tela
3. Home nova + avatar + as duas telas novas
4. Ligar os subtítulos aos números reais
5. Aviso de amizade na tela de fim de partida

Cada passo fecha verde antes do seguinte. Nada de publicar com a bateria
vermelha.
