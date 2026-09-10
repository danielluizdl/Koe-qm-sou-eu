/* Contas, amigos, perfil e rank.
   Roda contra os DOIS backends, igual ao test-salas.js:

     node test-contas.js
     DB=firestore node test-contas.js

   node test-contas.js */
const { CriarContas, chaveNick, nickValido, emailValido, nomeValido,
        normId, idValido, formatarId, formatoIdAtual } = require("./contas.js");
const RANK = require("./rank-server.js");

const BACKEND = process.env.DB === "firestore" ? "firestore" : "capability";

/* ---- db da capability, mesmo contrato do test-salas.js ---- */
function makeDbCapability(){
  const store = new Map(), leases = new Map();
  const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const dbErr = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };
  function deepMerge(t, patch){
    for (const k of Object.keys(patch)){
      const pv = patch[k];
      if (pv && typeof pv === "object" && !Array.isArray(pv) &&
          t[k] && typeof t[k] === "object" && !Array.isArray(t[k])) deepMerge(t[k], pv);
      else t[k] = clone(pv);
    }
  }
  const docSnap = path => {
    const d = store.get(path);
    return { id: path.split("/").pop(), exists: d !== undefined,
             data: () => (d === undefined ? undefined : clone(d)) };
  };
  function filhos(coll){
    const pre = coll + "/", n = coll.split("/").length + 1;
    return [...store.keys()].filter(k => k.startsWith(pre) && k.split("/").length === n).sort();
  }
  function docRef(path){
    return {
      id: path.split("/").pop(), path,
      get: () => Promise.resolve(docSnap(path)),
      set(d){ store.set(path, clone(d)); return Promise.resolve(); },
      update(d){
        if (!store.has(path)) return Promise.reject(dbErr("invalid_argument", "não existe: " + path));
        const cur = store.get(path); deepMerge(cur, d); store.set(path, cur);
        return Promise.resolve();
      },
      delete(){ store.delete(path); return Promise.resolve(); },
      acquire(opts){
        const now = Date.now(), cur = leases.get(path);
        const free = !cur || cur.expiresAt <= now || cur.holder === opts.holder;
        if (!free) return Promise.resolve({ acquired: false });
        leases.set(path, { holder: opts.holder, expiresAt: now + (opts.ttlMs || 30000) });
        return Promise.resolve({ acquired: true, holder: opts.holder });
      },
      onSnapshot(){ return () => {}; },
      collection: sub => collRef(path + "/" + sub)
    };
  }
  function collRef(path){
    return {
      path,
      doc: id => docRef(path + "/" + id),
      get: () => Promise.resolve({ docs: filhos(path).map(docSnap) }),
      onSnapshot(){ return () => {}; }
    };
  }
  return { doc: p => docRef(p), collection: p => collRef(p),
           _dump: () => { const o = {}; for (const [k,v] of store) o[k] = v; return o; } };
}

function makeDb(){
  return BACKEND === "firestore"
    ? require("./firestore-fake.js").makeFirestoreDb()
    : makeDbCapability();
}

let ok = 0, falhas = [];
function t(nome, cond, extra){
  if (cond) ok++; else falhas.push(nome + (extra ? " — " + extra : ""));
}
const pega = async p => { try { return { v: await p }; } catch(e){ return { e: e.code || e.message }; } };

/* O agregado do rank não é mais escrito pelo cliente: o host grava o
   resultado da partida em salas/{sala}/hist/registro e a Cloud Function
   deriva partidas + agregado pelo Admin SDK. Aqui simulamos o host e
   rodamos rank-server.js#processarPartida, o mesmo código que a função
   chama. `ordem` é [{id, chave}], já do 1º ao último. */
async function jogarPartida(db, pid, sala, ordem){
  const resultados = ordem.map((o, i) => ({ id: o.id, nick: o.id, carta: "c" + i, posicao: i + 1 }));
  const ref = db.doc("salas/" + sala + "/hist/registro");
  const snap = await ref.get();
  const items = (snap.exists && snap.data().items) || {};
  items[pid] = { terminadaEm: Date.now(), mask: 1, nivel: 0, resultados };
  await ref.set({ items });
  return RANK.processarPartida(db, sala, pid);
}

(async function(){

/* ================= 1. Normalização de nick ================= */
t("chaveNick tira acento", chaveNick("Ánã") === "ana", chaveNick("Ánã"));
t("chaveNick tira espaço e caixa", chaveNick("  João Silva ") === "joaosilva", chaveNick("  João Silva "));
t("chaveNick tira ç e ñ", chaveNick("Açaí Niño") === "acainino", chaveNick("Açaí Niño"));
t("nick de 1 caractere é inválido", !nickValido("a"));
t("nick de 2 é válido (mínimo novo)", nickValido("an"));
t("nick de 3 é válido", nickValido("ana"));
t("nome com uma palavra só é inválido", !nomeValido("Ana"));
t("nome e sobrenome é válido", nomeValido("Ana Souza"));
t("extensão de 1 letra não é e-mail", !emailValido("x@y.z"));
t("extensão de 2 letras é e-mail", emailValido("x@y.co"));
t("nick de 16 é válido", nickValido("a".repeat(16)));
t("nick de 17 é inválido", !nickValido("a".repeat(17)));
t("nick só de símbolos é inválido", !nickValido("!!!!"));
t("email válido", emailValido("a@b.co"));
t("email sem arroba é inválido", !emailValido("ab.co"));

/* ================= 2. Criar conta ================= */
{
  const A = CriarContas(makeDb());
  const p = await A.criar("u1", { nick: "Ana", nome: "Ana Souza", email: "Ana@Mail.COM" });
  t("criar devolve o perfil", p && p.uid === "u1");
  t("nick preserva o que foi digitado", p.nick === "Ana");
  t("nickChave é normalizada", p.nickChave === "ana");
  t("email vai minúsculo", p.email === "ana@mail.com");
  t("agregado começa zerado", p.partidas === 0 && p.saldo === 0);
  t("conta nasce não anônima", p.anonimo === false);

  const dup = await pega(A.criar("u2", { nick: "ANA", nome: "Ana Teste", email: "x@y.co" }));
  t("nick duplicado (outra caixa) é recusado", dup.e === "nick_em_uso", String(dup.e));

  const mesmo = await pega(A.criar("u1", { nick: "Outro", nome: "Outro Teste", email: "x@y.co" }));
  t("uid repetido é recusado", mesmo.e === "ja_existe", String(mesmo.e));

  const ruim = await pega(A.criar("u3", { nick: "o", nome: "Ok Teste", email: "x@y.co" }));
  t("nick inválido é recusado", ruim.e === "nick_invalido");
  const mail = await pega(A.criar("u4", { nick: "beto", nome: "Beto Teste", email: "naoemail" }));
  t("email inválido é recusado", mail.e === "email_invalido");

  const achado = await A.porNick("  aNa ");
  t("busca por nick acha, sem ligar pra caixa/espaço", achado && achado.uid === "u1");
  t("busca por nick traz o nick de exibição", achado.nick === "Ana", String(achado.nick));
  /* De propósito: nicks/{chave} é lido SEM estar logado pra login por
     nick funcionar sem Cloud Function (ver firebase-boot.js). O preço
     é expor o e-mail de quem tem nick pra quem souber o nick — decisão
     do dono, documentada em firestore.rules. */
  t("busca por nick expõe e-mail (de propósito, é o que faz login por nick funcionar sem servidor)",
    achado.email === "ana@mail.com", JSON.stringify(achado));
  t("busca por nick inexistente devolve null", (await A.porNick("ninguem")) === null);
}

/* ========= 2b. perfis/{uid} (agregado do rank) continua sem e-mail =========
   Regra do Firestore libera o documento inteiro ou nada. Se agregado e
   e-mail morassem juntos em perfis/{uid} (lido por QUALQUER logado pra
   montar o rank de amigos), amigo leria e-mail de amigo. nicks/{chave}
   é uma exceção deliberada e separada (ver teste acima), não isso. */
{
  const db = makeDb();
  const A = CriarContas(db);
  await A.criar("u1", { nick: "ana", nome: "Ana Souza", email: "ana@mail.com" });

  const pub = await A.perfilPublico("u1");
  t("público tem nick", pub.nick === "ana");
  t("público tem o agregado do rank", pub.partidas === 0 && pub.saldo === 0);
  t("público NÃO tem e-mail", pub.email === undefined, JSON.stringify(pub));
  t("público NÃO tem nome", pub.nome === undefined);

  const meu = await A.perfil("u1");
  t("dono enxerga o e-mail", meu.email === "ana@mail.com");
  t("dono enxerga o nome", meu.nome === "Ana Souza");
  t("dono enxerga o agregado junto", meu.saldo === 0);

  const docs = Object.keys(db._dump());
  t("e-mail só mora em usuarios/ (privado) e nicks/ (público, de propósito — login por nick)",
    docs.filter(k => JSON.stringify(db._dump()[k]).indexOf("ana@mail.com") >= 0)
        .every(k => k.indexOf("usuarios/") === 0 || k.indexOf("nicks/") === 0),
    docs.join(","));
  t("existe um doc público separado", docs.indexOf("perfis/u1") >= 0, docs.join(","));
}

/* ================= 3. Renomear ================= */
{
  const A = CriarContas(makeDb());
  await A.criar("u1", { nick: "ana", nome: "Ana Teste", email: "a@b.co" });
  await A.criar("u2", { nick: "bia", nome: "Bia Teste", email: "b@b.co" });

  const p = await A.renomear("u1", "Aninha");
  t("renomear troca o nick", p.nick === "Aninha" && p.nickChave === "aninha");
  t("nick antigo fica livre", (await A.porNick("ana")) === null);
  t("nick novo aponta pro dono", (await A.porNick("aninha")).uid === "u1");

  const col = await pega(A.renomear("u2", "Aninha"));
  t("não dá pra tomar o nick de outro", col.e === "nick_em_uso", String(col.e));

  const so = await A.renomear("u1", "ANINHA");
  t("mudar só a caixa é permitido", so.nick === "ANINHA" && so.nickChave === "aninha");
}

/* ================= 4. Amizade ================= */
{
  const A = CriarContas(makeDb());
  await A.criar("ana", { nick: "ana", nome: "Ana Teste", email: "a@b.co" });
  await A.criar("bia", { nick: "bia", nome: "Bia Teste", email: "b@b.co" });
  await A.criar("caio", { nick: "caio", nome: "Caio Teste", email: "c@b.co" });

  t("sem amigos no começo", (await A.amigos("ana")).length === 0);

  t("pedir devolve 'pedido'", (await A.pedir("ana", "bia")) === "pedido");
  t("quem pediu vê como enviado", (await A.pedidosEnviados("ana")).length === 1);
  t("quem recebeu vê como recebido", (await A.pedidosRecebidos("bia")).length === 1);
  t("pedido não conta como amizade (lado A)", (await A.amigos("ana")).length === 0);
  t("pedido não conta como amizade (lado B)", (await A.amigos("bia")).length === 0);
  t("aresta guarda o nick pra listar sem 2ª leitura",
    (await A.pedidosRecebidos("bia"))[0].nick === "ana");

  t("pedir de novo não duplica", (await A.pedir("ana", "bia")) === "ja_pedido");

  t("aceitar devolve 'aceito'", (await A.aceitar("bia", "ana")) === "aceito");
  t("virou amizade dos dois lados",
    (await A.amigos("ana")).length === 1 && (await A.amigos("bia")).length === 1);
  t("some dos pendentes", (await A.pedidosRecebidos("bia")).length === 0);
  t("pedir pra quem já é amigo é no-op", (await A.pedir("ana", "bia")) === "ja_amigos");

  /* pedido cruzado vira amizade na hora */
  await A.pedir("caio", "ana");
  t("pedido cruzado aceita direto", (await A.pedir("ana", "caio")) === "aceito");
  t("ana agora tem 2 amigos", (await A.amigos("ana")).length === 2);

  t("não dá pra se adicionar", (await pega(A.pedir("ana", "ana"))).e === "amigo_de_si");
  t("pedir pra quem não existe falha", (await pega(A.pedir("ana", "zzz"))).e === "sem_perfil");
  t("aceitar sem pedido falha", (await pega(A.aceitar("ana", "zzz"))).e === "sem_pedido");

  await A.remover("ana", "bia");
  t("remover tira dos dois lados",
    (await A.amigos("ana")).length === 1 && (await A.amigos("bia")).length === 0);
}

/* ================= 5. Partida e agregado (derivados do host) ================= */
{
  const db = makeDb();
  const A = CriarContas(db);
  await A.criar("ana", { nick: "ana", nome: "Ana Teste", email: "a@b.co" });

  const ordem = [{ id:"ana", chave:1 }, { id:"bia", chave:2 }, { id:"caio", chave:3 }];
  const r1 = await jogarPartida(db, "p1", "FESTA", ordem);
  t("processa quem tem conta", r1.processados.join(",") === "ana", JSON.stringify(r1));
  t("pula convidado sem conta", r1.pulados.sort().join(",") === "bia,caio", JSON.stringify(r1));

  let p = await A.perfil("ana");
  t("agregado conta a partida", p.partidas === 1);
  t("agregado conta a vitória", p.vitorias === 1);
  t("vencer de 3 dá saldo +2", p.saldo === 2, String(p.saldo));
  t("aproveitamento somado é 1", Math.abs(p.somaAprov - 1) < 1e-9);

  const partida = await db.doc("usuarios/ana/partidas/p1").get();
  t("a partida imutável foi gravada", partida.exists && partida.data().saldo === 2);

  await jogarPartida(db, "p1", "FESTA", ordem);   // mesmo pid de novo
  p = await A.perfil("ana");
  t("reprocessar a mesma partida não dobra", p.partidas === 1 && p.saldo === 2, String(p.saldo));

  /* segunda partida, agora em último numa mesa de 8 */
  const o8 = [];
  for (let i = 0; i < 7; i++) o8.push({ id:"x"+i, chave:i });
  o8.push({ id:"ana", chave:7 });
  await jogarPartida(db, "p2", "FESTA", o8);
  p = await A.perfil("ana");
  t("2 partidas no agregado", p.partidas === 2);
  t("último de 8 custa -7 (saldo 2-7=-5)", p.saldo === -5, String(p.saldo));

  /* partida sem nenhum resultado desse pid é no-op */
  const vazio = await RANK.processarPartida(db, "FESTA", "nao-existe");
  t("pid sem resultado no hist é no-op", vazio.semResultado === true, JSON.stringify(vazio));

  /* recalcularAgregado reconstrói do histórico imutável */
  const rec = await RANK.recalcularAgregado(db, "ana");
  t("recalcular bate com o agregado", rec.partidas === 2 && rec.saldo === -5,
    JSON.stringify(rec));
}

/* ================= 6. Rank entre amigos ================= */
{
  const db = makeDb();
  const A = CriarContas(db);
  for (const [uid, nick] of [["ana","ana"],["bia","bia"],["caio","caio"],["dudu","dudu"]])
    await A.criar(uid, { nick, nome: nick.charAt(0).toUpperCase()+nick.slice(1)+" Teste", email: uid + "@b.co" });

  await A.pedir("ana", "bia"); await A.aceitar("bia", "ana");
  await A.pedir("ana", "caio"); await A.aceitar("caio", "ana");
  /* dudu NÃO é amigo da ana */

  /* uma partida no hist pontua TODOS os participantes com conta de uma vez */
  await jogarPartida(db, "p1", "FESTA",
    [{id:"ana",chave:1},{id:"bia",chave:2},{id:"caio",chave:3}]);
  await jogarPartida(db, "p9", "OUTRA",
    [{id:"dudu",chave:1},{id:"z",chave:2},{id:"y",chave:3},
     {id:"w",chave:4},{id:"v",chave:5},{id:"t",chave:6},
     {id:"s",chave:7},{id:"r",chave:8}]);

  const r = await A.rankAmigos("ana");
  t("rank inclui você e seus amigos", r.length === 3, "tem " + r.length);
  t("rank NÃO inclui quem não é amigo", !r.some(x => x.id === "dudu"),
    r.map(x=>x.id).join(","));
  t("ana lidera o rank", r[0].id === "ana" && r[0].saldo === 2, JSON.stringify(r[0]));
  t("caio é o último", r[2].id === "caio" && r[2].saldo === -2);
  t("posições atribuídas", r.map(x=>x.posicao).join(",") === "1,2,3");
  t("marca quem é você", r.filter(x=>x.eu).length === 1 && r.find(x=>x.eu).id === "ana");
  t("aproveitamento vem calculado", Math.abs(r[0].aproveitamento - 1) < 1e-9);
  t("rank soma zero entre quem jogou junto",
    Math.abs(r.reduce((s,x)=>s+x.saldo,0)) < 1e-9);

  const rd = await A.rankAmigos("dudu");
  t("quem não tem amigos vê só a si mesmo", rd.length === 1 && rd[0].id === "dudu");
  t("dudu ganhou de 7: saldo +7", rd[0].saldo === 7, String(rd[0].saldo));
}

/* ================= 7. Anonimização (LGPD) ================= */
{
  const db1 = makeDb();
  const A = CriarContas(db1);
  await A.criar("ana", { nick: "ana", nome: "Ana Souza", email: "a@b.co" });
  await A.criar("bia", { nick: "bia", nome: "Bia Teste", email: "b@b.co" });
  await A.pedir("ana", "bia"); await A.aceitar("bia", "ana");
  await jogarPartida(db1, "p1", "FESTA", [{id:"ana",chave:1},{id:"bia",chave:2}]);

  const p = await A.anonimizar("ana");
  t("nick vira rótulo neutro", p.nick === "jogador removido");
  t("marcada como anônima", p.anonimo === true);
  t("nick antigo é liberado", (await A.porNick("ana")) === null);

  /* o dado pessoal não é esvaziado: o documento inteiro some */
  t("doc privado é apagado", db1._dump()["usuarios/ana"] === undefined,
    JSON.stringify(Object.keys(db1._dump())));
  t("nenhum resquício do e-mail no banco",
    JSON.stringify(db1._dump()).indexOf("a@b.co") < 0);
  t("nenhum resquício do nome no banco",
    JSON.stringify(db1._dump()).indexOf("Ana Souza") < 0);

  t("histórico continua somando", p.partidas === 1 && p.saldo === 1, JSON.stringify(p));
  const r = await A.rankAmigos("bia");
  t("rank do amigo não quebra", r.length === 2);
  t("aparece como removido no rank", r.some(x => x.anonimo && x.nick === "jogador removido"));

  t("não dá pra adicionar conta removida",
    (await pega(A.pedir("bia", "ana"))).e === "conta_removida" ||
    (await A.amigos("bia")).length === 1);
}

/* ================= 8. ID de jogador ================= */
t("normId aceita com #", normId("#00007") === "00007");
t("normId recusa tamanho errado", normId("007") === "");
t("normId recusa letra", normId("0007A") === "");
t("formatarId poe zero a esquerda", formatarId(7) === "00007", formatarId(7));
t("formatarId nao trunca acima de 5 digitos", formatarId(123456) === "123456");
t("formatoIdAtual aceita 5 digitos", formatoIdAtual("00042") === true);
t("formatoIdAtual recusa formato antigo (6 alfanumerico)", formatoIdAtual("K7M2XA") === false);

{
  const A = CriarContas(makeDb());
  const p = await A.criar("u1", { nick: "ana", nome: "Ana Souza", email: "a@b.co" });
  t("conta nova nasce com ID", !!p.id, JSON.stringify(p.id));
  t("ID é o primeiro da contagem: #00001", p.id === "00001", String(p.id));

  const porId = await A.porId(p.id);
  t("acha por ID", porId && porId.uid === "u1", JSON.stringify(porId));
  t("acha por ID com #", (await A.porId("#" + p.id)).uid === "u1");
  t("ID inexistente devolve null", (await A.porId("99999")) === null);

  t("buscar acha por apelido", (await A.buscar("ana")).uid === "u1");
  t("buscar acha por ID", (await A.buscar(p.id)).uid === "u1");
  t("buscar com texto solto devolve null", (await A.buscar("naoexiste")) === null);

  const B = await A.criar("u2", { nick: "bia", nome: "Bia Lima", email: "b@b.co" });
  t("segundo cadastro pega o próximo: #00002", B.id === "00002", String(B.id));
  t("dois jogadores, dois IDs diferentes", B.id !== p.id);

  const C = await A.criar("u3", { nick: "caio", nome: "Caio Dias", email: "c@b.co" });
  t("terceiro pega #00003, contador nunca reinicia", C.id === "00003", String(C.id));
}

/* cadastros concorrentes nunca saem com o mesmo número — é o ponto
   central do sistema: sem isso, dois sinais de "criar conta" ao mesmo
   tempo dariam o mesmo ID pra duas pessoas. Cada candidato trava
   individualmente (não um contador central), então isso é rápido: só
   quem mira o MESMO número ao mesmo tempo disputa, e quem perde anda
   pro próximo na hora, sem esperar TTL nenhum. */
{
  const A = CriarContas(makeDb());
  const uids = ["c1", "c2", "c3", "c4", "c5"];
  const nomes = ["Ana Um", "Bia Dois", "Caio Tres", "Duda Quatro", "Ema Cinco"];
  const t0 = Date.now();
  const perfis = await Promise.all(uids.map(function(uid, i){
    return A.criar(uid, { nick: "n" + uid, nome: nomes[i], email: uid + "@b.co" });
  }));
  const ids = perfis.map(function(p){ return p.id; });
  t("5 cadastros simultâneos, 5 IDs distintos",
    new Set(ids).size === 5, JSON.stringify(ids));
  t("todos no formato novo", ids.every(formatoIdAtual), JSON.stringify(ids));
  t("rápido: sem fila de TTL entre cadastros sequenciais/concorrentes",
    Date.now() - t0 < 1000, (Date.now() - t0) + "ms");
}

/* conta sem ID nenhum ganha um sem pedir nada */
{
  const db2 = makeDb();
  const A = CriarContas(db2);
  await A.criar("velho", { nick: "velho", nome: "Zé Antigo", email: "v@b.co" });
  await db2.doc("perfis/velho").update({ id: "" });
  t("simulou conta sem ID", !(await A.perfilPublico("velho")).id);

  const p = await A.garantirId("velho");
  t("garantirId gera pra conta sem ID", !!p.id, JSON.stringify(p.id));
  t("no formato novo", formatoIdAtual(p.id));
  t("e o ID fica gravado", !!(await A.perfilPublico("velho")).id);
  const mesmo = await A.garantirId("velho");
  t("chamar de novo não troca o ID", mesmo.id === p.id);
}

/* conta com ID no FORMATO ANTIGO (6 chars alfanuméricos, de antes desta
   troca) migra sozinha pro formato novo — é exatamente o caso das duas
   contas de teste reais ("teste", "dlzin"), criadas antes desta mudança. */
{
  const db3 = makeDb();
  const A = CriarContas(db3);
  await A.criar("teste", { nick: "teste", nome: "Conta Teste", email: "t@b.co" });
  await db3.doc("perfis/teste").update({ id: "K7M2XA" });   // formato antigo, simulado
  await db3.doc("ids/K7M2XA").set({ id: "K7M2XA", uid: "teste", em: 1 });
  t("simulou conta com ID no formato antigo",
    (await A.perfilPublico("teste")).id === "K7M2XA");

  const p = await A.garantirId("teste");
  t("garantirId detecta formato antigo e migra", formatoIdAtual(p.id), JSON.stringify(p.id));
  t("o ID antigo não é reaproveitado", p.id !== "K7M2XA");
  t("perfil público reflete o novo ID", (await A.perfilPublico("teste")).id === p.id);
  t("busca pelo ID antigo não acha mais ninguém", (await A.porId("K7M2XA")) === null);
  t("busca pelo ID novo acha a conta", (await A.porId(p.id)).uid === "teste");

  const outraVez = await A.garantirId("teste");
  t("já migrada, não migra de novo", outraVez.id === p.id);
}

/* anonimizar libera o ID */
{
  const A = CriarContas(makeDb());
  const p = await A.criar("ana", { nick: "ana", nome: "Ana Souza", email: "a@b.co" });
  await A.anonimizar("ana");
  t("ID é liberado ao encerrar a conta", (await A.porId(p.id)) === null);
}

/* ================= 9. Amizade automática ================= */
{
  const A = CriarContas(makeDb());
  for (const [uid, nick] of [["ana","ana"],["bia","bia"],["caio","caio"]])
    await A.criar(uid, { nick, nome: nick.charAt(0).toUpperCase() + nick.slice(1) + " Teste",
                         email: uid + "@b.co" });

  t("começam sem amigos", (await A.amigos("ana")).length === 0);

  const novos = await A.amizadeAutomatica("ana", ["bia", "caio"]);
  t("adiciona os dois", novos.length === 2, JSON.stringify(novos));
  t("devolve os apelidos pra tela avisar",
    novos.map(n => n.nick).sort().join(",") === "bia,caio", JSON.stringify(novos));
  t("ana tem 2 amigos", (await A.amigos("ana")).length === 2);
  t("e do outro lado também", (await A.amigos("bia")).some(x => x.uid === "ana"));
  t("já entram como aceitos, sem pedido",
    (await A.pedidosRecebidos("bia")).length === 0);

  const denovo = await A.amizadeAutomatica("ana", ["bia", "caio"]);
  t("jogar de novo não duplica", denovo.length === 0, JSON.stringify(denovo));
  t("continua com 2 amigos", (await A.amigos("ana")).length === 2);

  t("ignora quem não tem conta",
    (await A.amizadeAutomatica("ana", ["fantasma"])).length === 0);
  t("ignora você mesmo", (await A.amizadeAutomatica("ana", ["ana"])).length === 0);
  t("lista vazia é no-op", (await A.amizadeAutomatica("ana", [])).length === 0);
}

/* pedido pendente vira amizade */
{
  const A2 = CriarContas(makeDb());
  await A2.criar("x", { nick: "xis", nome: "Xis Teste", email: "x@b.co" });
  await A2.criar("y", { nick: "ypsilon", nome: "Ypsilon Teste", email: "y@b.co" });
  await A2.pedir("x", "y");
  t("havia pedido pendente", (await A2.pedidosRecebidos("y")).length === 1);
  await A2.amizadeAutomatica("x", ["y"]);
  t("pedido pendente vira amizade", (await A2.amigos("x")).length === 1);
  t("e some dos pendentes", (await A2.pedidosRecebidos("y")).length === 0);
}

/* ================= 10. Minhas salas ================= */
{
  const A = CriarContas(makeDb());
  await A.criar("ana", { nick: "ana", nome: "Ana Souza", email: "a@b.co" });

  t("começa sem salas", (await A.minhasSalas("ana")).length === 0);

  await A.marcarSala("ana", "FESTA", { nick: "ana", nome: "Rolê da firma" });
  let salas = await A.minhasSalas("ana");
  t("entrar numa sala registra", salas.length === 1 && salas[0].codigo === "FESTA",
    JSON.stringify(salas));
  t("sala nova começa com 0 partidas", salas[0].partidas === 0);
  t("guarda o nome da sala pra Minhas Salas", salas[0].nome === "Rolê da firma", JSON.stringify(salas[0]));

  await A.marcarSala("ana", "FESTA", { partida: true });   // sem repassar o nome
  await A.marcarSala("ana", "FESTA", { partida: true });
  salas = await A.minhasSalas("ana");
  t("não duplica a sala", salas.length === 1, JSON.stringify(salas.map(s => s.codigo)));
  t("conta as partidas", salas[0].partidas === 2, String(salas[0].partidas));
  t("nome persiste quando marca de novo sem repassar", salas[0].nome === "Rolê da firma", JSON.stringify(salas[0]));

  await A.marcarSala("ana", "PRAIA", { nick: "ana", partida: true, em: Date.now() + 1000 });
  salas = await A.minhasSalas("ana");
  t("segunda sala entra", salas.length === 2);
  t("mais recente vem primeiro", salas[0].codigo === "PRAIA",
    salas.map(s => s.codigo).join(","));

  t("sem código é no-op", (await A.marcarSala("ana", "")) === null);

  const r = await A.resumo("ana");
  t("resumo conta as salas", r.salas === 2, JSON.stringify(r));
  t("resumo soma as partidas das salas", r.partidasEmSalas === 3, String(r.partidasEmSalas));
  t("resumo traz o saldo do perfil", r.saldo === 0);
}

/* quem está na sala vem do roster público */
{
  const db3 = makeDb();
  const A = CriarContas(db3);
  await db3.doc("salas/FESTA/jogadores/ana").set({ id: "ana", nick: "Ana" });
  await db3.doc("salas/FESTA/jogadores/bia").set({ id: "bia", nick: "Bia" });
  const quem = await A.quemEstaNaSala("FESTA");
  t("lista quem estava na sala", quem.length === 2, JSON.stringify(quem));
  t("em ordem alfabética", quem.map(q => q.nick).join(",") === "Ana,Bia");
  t("sala vazia devolve lista vazia", (await A.quemEstaNaSala("NADA")).length === 0);
}

console.log("\n[" + BACKEND + "] " + ok + " passaram, " + falhas.length + " falharam");
if (falhas.length){ falhas.forEach(f => console.log("  x " + f)); process.exit(1); }
})();
