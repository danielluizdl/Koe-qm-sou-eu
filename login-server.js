/* ============================================================
   LOGIN POR NICK — LADO SERVIDOR

   POR QUE ISSO PRECISA DE SERVIDOR
   ---------------------------------
   Login por e-mail funciona direto no cliente: o Firebase Auth já
   sabe resolver "esse e-mail, essa senha" sozinho. Login por NICK
   precisa primeiro achar o e-mail associado — e isso é uma leitura no
   banco, que as regras corretamente bloqueiam pra quem ainda não
   provou quem é (é assim que o app protege o e-mail de todo mundo,
   nem amigo vê e-mail de amigo).

   A saída: nada de e-mail sai do servidor pro cliente, nunca. Este
   módulo resolve nick -> uid -> e-mail e verifica a senha TUDO do
   lado de dentro, e devolve só um token de acesso — do jeito que
   funcionar ou não funcionar (nick errado, senha errada, nick que não
   existe) parece exatamente igual do lado de fora. Sem essa
   uniformidade, alguém varrendo nicks aprenderia quais existem só
   pela mensagem de erro mudar.

   `chamarRest(email, senha)` verifica a senha chamando a MESMA API
   REST que o SDK do cliente usa por baixo dos panos
   (identitytoolkit.googleapis.com) — o Admin SDK não tem como
   verificar senha diretamente (só cria/edita conta, nunca confere
   contra o hash salvo). `functions/index.js` implementa isso de
   verdade; os testes passam uma versão que aponta pro emulador.

   ES5 puro, promises. Fala o contrato de db de sempre pra leitura do
   nick; authAdmin é só {getUser(uid), createCustomToken(uid)} —
   suficiente do Admin SDK do Firebase.
   ============================================================ */
(function(raiz){
  "use strict";

  var CONTAS = (typeof require === "function") ? require("./contas.js") : raiz.CONTAS;
  var chaveNick = CONTAS.chaveNick;

  /* Uma mensagem só, pro nick errado, senha errada e nick inexistente
     serem indistinguíveis do lado de fora. */
  function erroGenerico(){
    var e = new Error("nick ou senha não conferem");
    e.code = "credenciais_invalidas";
    return e;
  }

  function resolverELogar(db, authAdmin, chamarRest, nick, senha){
    var chave = chaveNick(nick);
    if (!chave || !senha) return Promise.reject(erroGenerico());

    /* Uma cadeia linear só. QUALQUER falha no meio do caminho — nick
       não existe, uid sem registro no Auth, senha errada, e-mail sem
       @ (nunca deveria acontecer, mas não é motivo pra vazar detalhe)
       — cai no mesmo .catch() no fim e sai com a MESMA mensagem. */
    return db.doc("nicks/" + chave).get().then(function(s){
      if (!s.exists) throw erroGenerico();
      return authAdmin.getUser(s.data().uid);
    }).then(function(registro){
      if (!registro || !registro.email) throw erroGenerico();
      return chamarRest(registro.email, senha).then(function(ok){
        if (!ok) throw erroGenerico();
        return authAdmin.createCustomToken(registro.uid);
      });
    })["catch"](function(e){
      throw (e && e.code === "credenciais_invalidas") ? e : erroGenerico();
    });
  }

  var API = { resolverELogar: resolverELogar, erroGenerico: erroGenerico };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else raiz.LOGIN_SERVER = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
