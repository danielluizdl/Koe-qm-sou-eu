/* Contas, amigos, perfil e rank.
   Roda contra os DOIS backends, igual ao test-salas.js:

     node test-contas.js
     DB=firestore node test-contas.js

   node test-contas.js */
const { CriarContas, chaveNick, nickValido, emailValido, nomeValido } = require("./contas.js");

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
  t("busca por nick NÃO expõe e-mail", achado.email === undefined, JSON.stringify(achado));
  t("busca por nick inexistente devolve null", (await A.porNick("ninguem")) === null);
}

/* ========= 2b. A separação público/privado é o que protege o e-mail =========
   Regra do Firestore libera o documento inteiro ou nada. Se agregado e
   e-mail morassem juntos, o rank de amigos faria amigo ler e-mail de
   amigo. */
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
  t("e-mail mora só no doc privado",
    docs.filter(k => JSON.stringify(db._dump()[k]).indexOf("ana@mail.com") >= 0)
        .every(k => k.indexOf("usuarios/") === 0),
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

/* ================= 5. Registrar partida e agregado ================= */
{
  const A = CriarContas(makeDb());
  await A.criar("ana", { nick: "ana", nome: "Ana Teste", email: "a@b.co" });

  const ordem = [{ id:"ana", chave:1 }, { id:"bia", chave:2 }, { id:"caio", chave:3 }];
  t("registrar devolve 'registrada'",
    (await A.registrarMinhaPartida("ana", { pid:"p1", sala:"FESTA", ordem })) === "registrada");

  let p = await A.perfil("ana");
  t("agregado conta a partida", p.partidas === 1);
  t("agregado conta a vitória", p.vitorias === 1);
  t("vencer de 3 dá saldo +2", p.saldo === 2, String(p.saldo));
  t("aproveitamento somado é 1", Math.abs(p.somaAprov - 1) < 1e-9);

  t("registrar a mesma partida de novo é no-op",
    (await A.registrarMinhaPartida("ana", { pid:"p1", ordem })) === "ja_registrada");
  p = await A.perfil("ana");
  t("agregado não dobrou", p.partidas === 1 && p.saldo === 2);

  /* segunda partida, agora em último numa mesa de 8 */
  const o8 = [];
  for (let i = 0; i < 7; i++) o8.push({ id:"x"+i, chave:i });
  o8.push({ id:"ana", chave:7 });
  await A.registrarMinhaPartida("ana", { pid:"p2", ordem: o8 });
  p = await A.perfil("ana");
  t("2 partidas no agregado", p.partidas === 2);
  t("último de 8 custa -7 (saldo 2-7=-5)", p.saldo === -5, String(p.saldo));

  t("quem não está na ordem é recusado",
    (await pega(A.registrarMinhaPartida("ana", { pid:"p3", ordem: o8.slice(0,3) }))).e === "fora_da_partida");
  t("sem pid é recusado",
    (await pega(A.registrarMinhaPartida("ana", { ordem }))).e === "sem_pid");

  /* recalcular reconstrói do histórico imutável */
  const rec = await A.recalcular("ana");
  t("recalcular bate com o agregado", rec.partidas === 2 && rec.saldo === -5,
    JSON.stringify(rec));
}

/* ================= 6. Rank entre amigos ================= */
{
  const A = CriarContas(makeDb());
  for (const [uid, nick] of [["ana","ana"],["bia","bia"],["caio","caio"],["dudu","dudu"]])
    await A.criar(uid, { nick, nome: nick.charAt(0).toUpperCase()+nick.slice(1)+" Teste", email: uid + "@b.co" });

  await A.pedir("ana", "bia"); await A.aceitar("bia", "ana");
  await A.pedir("ana", "caio"); await A.aceitar("caio", "ana");
  /* dudu NÃO é amigo da ana */

  const ordem = [{id:"ana",chave:1},{id:"bia",chave:2},{id:"caio",chave:3}];
  await A.registrarMinhaPartida("ana",  { pid:"p1", ordem });
  await A.registrarMinhaPartida("bia",  { pid:"p1", ordem });
  await A.registrarMinhaPartida("caio", { pid:"p1", ordem });
  await A.registrarMinhaPartida("dudu", { pid:"p9",
    ordem: [{id:"dudu",chave:1},{id:"z",chave:2},{id:"y",chave:3},
            {id:"w",chave:4},{id:"v",chave:5},{id:"t",chave:6},
            {id:"s",chave:7},{id:"r",chave:8}] });

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
  await A.registrarMinhaPartida("ana", { pid:"p1",
    ordem: [{id:"ana",chave:1},{id:"bia",chave:2}] });

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

console.log("\n[" + BACKEND + "] " + ok + " passaram, " + falhas.length + " falharam");
if (falhas.length){ falhas.forEach(f => console.log("  x " + f)); process.exit(1); }
})();
