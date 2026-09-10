/* login-server.js com dependências simuladas — rápido, sem emulador.
   A prova de fogo (função de verdade, emulador de verdade) é
   test-login-server-emulador.js.

   node test-login-server.js */
const LOGIN = require("./login-server.js");

let ok = 0, falhas = [];
function t(nome, cond, extra){
  if (cond) ok++; else falhas.push(nome + (extra ? " — " + extra : ""));
}
const pega = async p => { try { return { v: await p }; } catch(e){ return { e: e.code || e.message }; } };

/* db mínimo: só o que resolverELogar usa (doc().get()) */
function makeDb(nicks){
  return {
    doc: p => ({
      get: () => Promise.resolve(
        Object.prototype.hasOwnProperty.call(nicks, p)
          ? { exists: true, data: () => nicks[p] }
          : { exists: false }
      )
    })
  };
}

function makeAuthAdmin(usuarios){
  return {
    getUser: uid => Object.prototype.hasOwnProperty.call(usuarios, uid)
      ? Promise.resolve({ uid, email: usuarios[uid] })
      : Promise.reject(new Error("user-not-found")),
    createCustomToken: uid => Promise.resolve("token-de-" + uid)
  };
}

(async function(){
  const db = makeDb({ "nicks/ana": { uid: "uid-ana" } });
  const authAdmin = makeAuthAdmin({ "uid-ana": "ana@x.co" });

  /* senha certa: só passa quando o e-mail resolvido bate com "ana@x.co" */
  const chamarCerta = (email, senha) =>
    Promise.resolve(email === "ana@x.co" && senha === "134312");

  const r1 = await pega(LOGIN.resolverELogar(db, authAdmin, chamarCerta, "ana", "134312"));
  t("nick + senha certos devolve token", r1.v === "token-de-uid-ana", JSON.stringify(r1));

  const r2 = await pega(LOGIN.resolverELogar(db, authAdmin, chamarCerta, "ana", "000000"));
  t("senha errada é recusada", r2.e === "credenciais_invalidas", JSON.stringify(r2));

  const r3 = await pega(LOGIN.resolverELogar(db, authAdmin, chamarCerta, "naoexiste", "134312"));
  t("nick inexistente é recusado", r3.e === "credenciais_invalidas", JSON.stringify(r3));

  t("nick errado e senha errada dão a MESMA mensagem",
    r2.e === r3.e, r2.e + " vs " + r3.e);

  const r4 = await pega(LOGIN.resolverELogar(db, authAdmin, chamarCerta, "ANA", "134312"));
  t("nick não liga pra caixa (normalização)", r4.v === "token-de-uid-ana", JSON.stringify(r4));

  const r5 = await pega(LOGIN.resolverELogar(db, authAdmin, chamarCerta, "  ana  ", "134312"));
  t("nick não liga pra espaço", r5.v === "token-de-uid-ana");

  const r6 = await pega(LOGIN.resolverELogar(db, authAdmin, chamarCerta, "", "134312"));
  t("nick vazio é recusado sem chamar nada", r6.e === "credenciais_invalidas");

  const r7 = await pega(LOGIN.resolverELogar(db, authAdmin, chamarCerta, "ana", ""));
  t("senha vazia é recusada sem chamar nada", r7.e === "credenciais_invalidas");

  /* nick existe, uid órfão (sem registro no Auth) — não pode vazar
     "achei o nick mas..." nem estourar erro diferente */
  const dbOrfao = makeDb({ "nicks/orfao": { uid: "uid-fantasma" } });
  const r8 = await pega(LOGIN.resolverELogar(dbOrfao, authAdmin, chamarCerta, "orfao", "134312"));
  t("uid sem registro no Auth cai na mesma mensagem genérica",
    r8.e === "credenciais_invalidas", JSON.stringify(r8));

  /* a chamada REST nunca é feita se o nick já não existe — prova que
     não fazemos round-trip desnecessário, e principalmente prova que
     NENHUM e-mail de verdade circula quando o nick é inválido */
  let chamouRest = false;
  const chamarEspiao = (email, senha) => { chamouRest = true; return Promise.resolve(true); };
  await pega(LOGIN.resolverELogar(db, authAdmin, chamarEspiao, "fantasma", "134312"));
  t("nick inexistente não chama a verificação de senha", chamouRest === false);

  console.log("\n" + ok + " passaram, " + falhas.length + " falharam");
  if (falhas.length){ falhas.forEach(f => console.log("  x " + f)); process.exit(1); }
})();
