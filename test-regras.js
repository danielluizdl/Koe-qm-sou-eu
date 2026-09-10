/* REGRAS DE SEGURANÇA — testadas contra o emulador do Firestore.

   Roda offline: o projeto "demo-*" faz o emulador não pedir credencial
   nenhuma. Não toca no projeto de verdade.

     npm run test:regras

   A postura aqui é a do atacante: cada teste tenta fazer algo que NÃO
   deveria ser possível, e falha se conseguir. Testar só o caminho feliz
   provaria apenas que o jogo funciona — não que ele está protegido.
*/
const { initializeTestEnvironment, assertFails, assertSucceeds } =
  require("@firebase/rules-unit-testing");
const fs = require("fs");
const {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs
} = require("firebase/firestore");

let ok = 0, falhas = [];
async function t(nome, fn){
  try { await fn(); ok++; }
  catch (e){ falhas.push(nome + " — " + (e && e.message ? e.message.split("\n")[0] : e)); }
}

(async function(){
  const env = await initializeTestEnvironment({
    projectId: "demo-quem-sou-eu",
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080
    }
  });

  const ana  = env.authenticatedContext("ana").firestore();
  const bia  = env.authenticatedContext("bia").firestore();
  const zeca = env.authenticatedContext("zeca").firestore();
  const fora = env.unauthenticatedContext().firestore();

  /* Semeia direto, ignorando as regras — é o estado "já existente". */
  async function semear(fn){ await env.withSecurityRulesDisabled(ctx => fn(ctx.firestore())); }
  const perfilBase = (uid, extra) => Object.assign({
    uid, nick: uid, nickChave: uid, anonimo: false,
    criadoEm: 1, atualizadoEm: 1,
    partidas: 0, vitorias: 0, podios: 0, saldo: 0, somaAprov: 0
  }, extra || {});

  await env.clearFirestore();
  await semear(async db => {
    await setDoc(doc(db, "perfis/ana"), perfilBase("ana", { partidas: 3, saldo: 5 }));
    await setDoc(doc(db, "perfis/bia"), perfilBase("bia"));
    await setDoc(doc(db, "usuarios/ana"), { uid:"ana", nome:"Ana", email:"ana@x.co", criadoEm:1 });
    await setDoc(doc(db, "usuarios/bia"), { uid:"bia", nome:"Bia", email:"bia@x.co", criadoEm:1 });
    await setDoc(doc(db, "nicks/ana"), { uid:"ana", chave:"ana", nick:"Ana", em:1 });
    await setDoc(doc(db, "salas/FESTA"), { codigo:"FESTA", hostId:"ana", fase:"lobby", mask:1, nivel:0 });
    await setDoc(doc(db, "salas/FESTA/jogadores/ana"), { id:"ana", nick:"Ana" });
    await setDoc(doc(db, "salas/FESTA/jogadores/bia"), { id:"bia", nick:"Bia" });
    await setDoc(doc(db, "salas/FESTA/hist/registro"), { items:{} });
  });

  /* ============ perfis: público pra ler, só o dono pra escrever ============ */
  await t("amigo lê o perfil público (é o que o rank precisa)",
    () => assertSucceeds(getDoc(doc(bia, "perfis/ana"))));
  await t("deslogado NÃO lê perfil",
    () => assertFails(getDoc(doc(fora, "perfis/ana"))));
  await t("dono edita nick e ID do próprio perfil",
    () => assertSucceeds(updateDoc(doc(ana, "perfis/ana"), { nick: "Aninha", atualizadoEm: 2 })));
  await t("nem o DONO grava o próprio saldo (é da Cloud Function)",
    () => assertFails(updateDoc(doc(ana, "perfis/ana"), { saldo: 7 })));
  await t("nem o DONO mexe em partidas/vitorias do agregado",
    () => assertFails(updateDoc(doc(ana, "perfis/ana"), { partidas: 10, vitorias: 10 })));
  await t("OUTRO NÃO infla o saldo alheio",
    () => assertFails(updateDoc(doc(bia, "perfis/ana"), { saldo: 999 })));
  await t("ninguém apaga perfil (salas permanentes dependem dele)",
    () => assertFails(deleteDoc(doc(ana, "perfis/ana"))));
  await t("conta nova não nasce com saldo",
    () => assertFails(setDoc(doc(zeca, "perfis/zeca"), perfilBase("zeca", { saldo: 50 }))));
  await t("conta nova não nasce com pódios nem somaAprov",
    () => assertFails(setDoc(doc(zeca, "perfis/zeca"), perfilBase("zeca", { podios: 3 }))));
  await t("conta nova zerada é aceita",
    () => assertSucceeds(setDoc(doc(zeca, "perfis/zeca"), perfilBase("zeca"))));
  await t("não dá pra criar perfil no nome de outro",
    () => assertFails(setDoc(doc(bia, "perfis/carlos"), perfilBase("carlos"))));

  /* ============ usuarios: e-mail e nome, só do dono ============ */
  await t("dono lê o próprio cadastro",
    () => assertSucceeds(getDoc(doc(ana, "usuarios/ana"))));
  await t("AMIGO NÃO lê o e-mail do amigo",
    () => assertFails(getDoc(doc(bia, "usuarios/ana"))));
  await t("deslogado não lê cadastro",
    () => assertFails(getDoc(doc(fora, "usuarios/ana"))));
  await t("outro não escreve no cadastro alheio",
    () => assertFails(updateDoc(doc(bia, "usuarios/ana"), { email: "invadido@x.co" })));

  /* ============ amizade: a aresta que aponta pra mim ============ */
  await t("dono escreve na própria lista",
    () => assertSucceeds(setDoc(doc(ana, "usuarios/ana/amigos/bia"),
      { uid:"bia", nick:"Bia", status:"pendente", direcao:"enviado", em:1 })));
  await t("bia cria a aresta que aponta pra ELA na lista da ana (é o pedido)",
    () => assertSucceeds(setDoc(doc(bia, "usuarios/ana/amigos/bia"),
      { uid:"bia", nick:"Bia", status:"aceito", direcao:"aceito", em:1 })));
  await t("bia NÃO cria aresta apontando pra terceiro na lista da ana",
    () => assertFails(setDoc(doc(bia, "usuarios/ana/amigos/zeca"),
      { uid:"zeca", nick:"Zeca", status:"aceito", direcao:"aceito", em:1 })));
  await t("bia NÃO forja o campo uid da própria aresta",
    () => assertFails(setDoc(doc(bia, "usuarios/ana/amigos/bia"),
      { uid:"zeca", nick:"Zeca", status:"aceito", direcao:"aceito", em:1 })));
  await t("estranho NÃO lê a lista de amigos alheia",
    () => assertFails(getDocs(collection(bia, "usuarios/ana/amigos"))));
  await t("dono lê a própria lista",
    () => assertSucceeds(getDocs(collection(ana, "usuarios/ana/amigos"))));

  /* ============ partidas: só o Admin SDK escreve (Cloud Function) ============ */
  await semear(async db => {
    await setDoc(doc(db, "usuarios/ana/partidas/p0"), { pid:"p0", n:3, posicao:1, saldo:2 });
  });
  await t("dono LÊ o próprio histórico de partidas",
    () => assertSucceeds(getDocs(collection(ana, "usuarios/ana/partidas"))));
  await t("nem o DONO cria partida à mão (declararia qualquer saldo)",
    () => assertFails(setDoc(doc(ana, "usuarios/ana/partidas/p1"),
      { pid:"p1", n:3, posicao:1, saldo:2, aproveitamento:1 })));
  await t("partida gravada é IMUTÁVEL",
    () => assertFails(updateDoc(doc(ana, "usuarios/ana/partidas/p0"), { saldo: 99 })));
  await t("partida gravada não pode ser apagada",
    () => assertFails(deleteDoc(doc(ana, "usuarios/ana/partidas/p0"))));
  await t("outro não grava partida na conta alheia",
    () => assertFails(setDoc(doc(bia, "usuarios/ana/partidas/p3"), { pid:"p3", n:3 })));

  /* ============ nicks: índice de unicidade ============ */
  await t("logado lê o índice (é como se acha amigo por nick)",
    () => assertSucceeds(getDoc(doc(bia, "nicks/ana"))));
  await t("reserva nick apontando pro próprio uid",
    () => assertSucceeds(setDoc(doc(zeca, "nicks/zeca"), { uid:"zeca", chave:"zeca", nick:"Zeca", em:1 })));
  await t("NÃO reserva nick apontando pra outro",
    () => assertFails(setDoc(doc(zeca, "nicks/livre"), { uid:"ana", chave:"livre", nick:"x", em:1 })));
  await t("chave tem que bater com o id do documento",
    () => assertFails(setDoc(doc(zeca, "nicks/outra"), { uid:"zeca", chave:"naobate", nick:"x", em:1 })));
  await t("NÃO rouba o nick que já é de outro",
    () => assertFails(setDoc(doc(bia, "nicks/ana"), { uid:"bia", chave:"ana", nick:"Bia", em:1 })));
  await t("dono libera o próprio nick",
    () => assertSucceeds(deleteDoc(doc(ana, "nicks/ana"))));

  /* ============ _locks: lease do acquire ============ */
  const daquiA = ms => Date.now() + ms;
  await t("pega lease assinando com o próprio uid",
    () => assertSucceeds(setDoc(doc(ana, "_locks/salas~2FNOVA"),
      { holder:"ana", expiresAt: daquiA(8000), version:1, alvo:"salas/NOVA" })));
  await t("NÃO assina lease com uid de outro",
    () => assertFails(setDoc(doc(bia, "_locks/salas~2FOUTRA"),
      { holder:"ana", expiresAt: daquiA(8000), version:1, alvo:"salas/OUTRA" })));
  await t("NÃO rouba lease vivo de outro",
    () => assertFails(setDoc(doc(bia, "_locks/salas~2FNOVA"),
      { holder:"bia", expiresAt: daquiA(8000), version:2, alvo:"salas/NOVA" })));
  await t("NÃO senta em cima de um nick com validade no ano 3000",
    () => assertFails(setDoc(doc(bia, "_locks/nicks~2Fcobicado"),
      { holder:"bia", expiresAt: daquiA(999999999), version:1, alvo:"nicks/cobicado" })));
  await semear(async db => {
    await setDoc(doc(db, "_locks/salas~2FVELHA"),
      { holder:"ana", expiresAt: Date.now() - 1000, version:1, alvo:"salas/VELHA" });
  });
  await t("lease vencido pode ser tomado",
    () => assertSucceeds(setDoc(doc(bia, "_locks/salas~2FVELHA"),
      { holder:"bia", expiresAt: daquiA(8000), version:2, alvo:"salas/VELHA" })));

  /* ============ salas: host manda na sala, cada um no seu jogador ====== */
  await t("qualquer logado lê a sala",
    () => assertSucceeds(getDoc(doc(bia, "salas/FESTA"))));
  await t("deslogado não lê a sala",
    () => assertFails(getDoc(doc(fora, "salas/FESTA"))));
  await t("host reconfigura a sala",
    () => assertSucceeds(updateDoc(doc(ana, "salas/FESTA"), { nivel: 2 })));
  await t("quem não é host NÃO reconfigura",
    () => assertFails(updateDoc(doc(bia, "salas/FESTA"), { nivel: 2 })));
  await t("quem não é host NÃO apaga a sala",
    () => assertFails(deleteDoc(doc(bia, "salas/FESTA"))));
  await t("criar sala exige ser o próprio host",
    () => assertFails(setDoc(doc(bia, "salas/NOVA2"), { codigo:"NOVA2", hostId:"ana", fase:"lobby" })));
  await t("criar sala com hostId próprio funciona",
    () => assertSucceeds(setDoc(doc(bia, "salas/NOVA3"), { codigo:"NOVA3", hostId:"bia", fase:"lobby" })));

  await t("jogador escreve o próprio documento",
    () => assertSucceeds(updateDoc(doc(bia, "salas/FESTA/jogadores/bia"), { revelou: true })));
  await t("JOGADOR NÃO MARCA ACERTO POR OUTRO",
    () => assertFails(updateDoc(doc(bia, "salas/FESTA/jogadores/ana"), { acertouEm: 1, posicao: 1 })));
  await t("host distribui cartas (escreve no doc dos outros)",
    () => assertSucceeds(updateDoc(doc(ana, "salas/FESTA/jogadores/bia"), { carta: "Goku", slot: 1 })));
  await t("estranho não entra escrevendo no doc de outro",
    () => assertFails(setDoc(doc(zeca, "salas/FESTA/jogadores/bia"), { id:"bia", nick:"falso" })));
  await t("entrar na sala criando o próprio doc funciona",
    () => assertSucceeds(setDoc(doc(zeca, "salas/FESTA/jogadores/zeca"), { id:"zeca", nick:"Zeca" })));

  await t("só o host grava o histórico da sala",
    () => assertSucceeds(updateDoc(doc(ana, "salas/FESTA/hist/registro"), { "items.p1": { n:2 } })));
  await t("quem não é host NÃO grava histórico",
    () => assertFails(updateDoc(doc(bia, "salas/FESTA/hist/registro"), { "items.p2": { n:2 } })));

  /* ============ ids: o handle que não muda ============ */
  await semear(async db => {
    await setDoc(doc(db, "ids/AAA111"), { id:"AAA111", uid:"ana", em:1 });
  });
  await t("logado lê o índice de ID (é como se acha alguém)",
    () => assertSucceeds(getDoc(doc(bia, "ids/AAA111"))));
  await t("deslogado NÃO lê o índice de ID",
    () => assertFails(getDoc(doc(fora, "ids/AAA111"))));
  await t("reserva ID apontando pro próprio uid",
    () => assertSucceeds(setDoc(doc(zeca, "ids/ZZZ999"), { id:"ZZZ999", uid:"zeca", em:1 })));
  await t("NÃO reserva ID apontando pra outra pessoa",
    () => assertFails(setDoc(doc(zeca, "ids/BBB222"), { id:"BBB222", uid:"ana", em:1 })));
  await t("o campo id tem que bater com o documento",
    () => assertFails(setDoc(doc(zeca, "ids/CCC333"), { id:"OUTRO", uid:"zeca", em:1 })));
  await t("NÃO rouba o ID de outro",
    () => assertFails(setDoc(doc(bia, "ids/AAA111"), { id:"AAA111", uid:"bia", em:1 })));
  await t("dono libera o próprio ID",
    () => assertSucceeds(deleteDoc(doc(ana, "ids/AAA111"))));

  /* ============ amizade automática ============
     Cada aparelho escreve os dois lados da SUA relação. O que a regra
     precisa garantir é que ninguém escreva a relação de terceiros. */
  await t("escrevo a aresta na minha lista",
    () => assertSucceeds(setDoc(doc(ana, "usuarios/ana/amigos/bia"),
      { uid:"bia", nick:"Bia", status:"aceito", direcao:"aceito", em:1 })));
  await t("escrevo a aresta que aponta pra MIM na lista do outro",
    () => assertSucceeds(setDoc(doc(ana, "usuarios/bia/amigos/ana"),
      { uid:"ana", nick:"Ana", status:"aceito", direcao:"aceito", em:1 })));
  await t("NÃO escrevo aresta entre DUAS outras pessoas",
    () => assertFails(setDoc(doc(ana, "usuarios/bia/amigos/zeca"),
      { uid:"zeca", nick:"Zeca", status:"aceito", direcao:"aceito", em:1 })));
  await t("NÃO forjo o uid da aresta que ponho na lista alheia",
    () => assertFails(setDoc(doc(ana, "usuarios/bia/amigos/ana"),
      { uid:"zeca", nick:"Zeca", status:"aceito", direcao:"aceito", em:1 })));

  /* ============ o campo id no perfil ============ */
  await t("dono grava o próprio id no perfil",
    () => assertSucceeds(updateDoc(doc(ana, "perfis/ana"), { id:"NOVO12", atualizadoEm: 9 })));
  await t("outro NÃO grava id no perfil alheio",
    () => assertFails(updateDoc(doc(bia, "perfis/ana"), { id:"HACK99" })));

  /* ============ o resto do banco não existe ============ */
  await t("caminho não previsto é negado (leitura)",
    () => assertFails(getDoc(doc(ana, "qualquerOutra/coisa"))));
  await t("caminho não previsto é negado (escrita)",
    () => assertFails(setDoc(doc(ana, "qualquerOutra/coisa"), { x: 1 })));

  await env.cleanup();

  console.log("\nregras · " + ok + " passaram, " + falhas.length + " falharam");
  if (falhas.length){ falhas.forEach(f => console.log("  x " + f)); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
