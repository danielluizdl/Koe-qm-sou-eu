/* ============================================================
   BOOTSTRAP DO FIREBASE

   Ponte entre o SDK modular (ESM, moderno) e o jogo (ES5, um IIFE só).
   Carrega o SDK por import() dinâmico, monta o `db` no contrato da
   capability via criarDbFirestore, cuida do login por link mágico e
   entrega tudo pronto pra quem estiver esperando.

   Por que import() dinâmico e não uma tag de módulo: assim este arquivo
   continua sendo script clássico, carrega na ordem junto com o resto, e
   o jogo não precisa saber o que é um módulo.

   NADA aqui é obrigatório pro jogo rodar. Se a rede cair, se o SDK não
   carregar, se a pessoa não estiver logada — o jogo segue funcionando
   nos modos offline. É a mesma postura da capability `db`: recurso que
   acende quando dá, nunca requisito.
   ============================================================ */
(function(raiz){
  "use strict";

  var VERSAO_SDK = "12.18.0";
  var BASE = "https://www.gstatic.com/firebasejs/" + VERSAO_SDK + "/";
  var CHAVE_EMAIL = "quemsoueu:email-pendente";

  var ouvintes = [];
  var estado = { pronto: false, db: null, auth: null, identidade: null, erro: null };
  var sdkAuth = null;

  function avisar(){
    var i, copia = ouvintes.slice();
    for (i = 0; i < copia.length; i++){
      try { copia[i](estado); } catch(e){}
    }
  }

  var API = {};

  /* Chame quando quiser ser avisado. Se já estiver pronto, o callback
     roda na hora — quem chega atrasado não fica esperando pra sempre. */
  API.aoMudar = function(cb){
    if (typeof cb !== "function") return;
    ouvintes.push(cb);
    if (estado.pronto) { try { cb(estado); } catch(e){} }
  };

  API.estado = function(){ return estado; };

  /* ---- login por link mágico ----
     O e-mail fica guardado localmente entre "pedir o link" e "abrir o
     link", porque o Firebase precisa dele pra fechar o login e o link
     pode ser aberto em outro navegador. Quando isso acontece, a gente
     pergunta o e-mail de novo em vez de falhar. */
  API.enviarLink = function(email){
    if (!estado.auth || !sdkAuth)
      return Promise.reject(new Error("firebase ainda não carregou"));
    email = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return Promise.reject(new Error("e-mail inválido"));

    var destino = raiz.location.origin + raiz.location.pathname;
    return sdkAuth.sendSignInLinkToEmail(estado.auth, email, {
      url: destino,
      handleCodeInApp: true
    }).then(function(){
      try { raiz.localStorage.setItem(CHAVE_EMAIL, email); } catch(e){}
      return email;
    });
  };

  API.precisaConfirmarEmail = function(){
    if (!estado.auth || !sdkAuth) return false;
    if (!sdkAuth.isSignInWithEmailLink(estado.auth, raiz.location.href)) return false;
    return !emailGuardado();
  };

  API.concluirLoginCom = function(email){
    if (!estado.auth || !sdkAuth)
      return Promise.reject(new Error("firebase ainda não carregou"));
    return sdkAuth.signInWithEmailLink(estado.auth, String(email || "").trim().toLowerCase(),
                                       raiz.location.href)
      .then(function(cred){ limparLink(); return cred.user; });
  };

  API.sair = function(){
    if (!estado.auth || !sdkAuth) return Promise.resolve();
    return sdkAuth.signOut(estado.auth);
  };

  function emailGuardado(){
    try { return raiz.localStorage.getItem(CHAVE_EMAIL) || ""; } catch(e){ return ""; }
  }

  /* Tira o código do link da barra de endereço depois de usar. Sem isso,
     recarregar a página tenta reusar um código já queimado e mostra erro
     pra quem não fez nada de errado. */
  function limparLink(){
    try { raiz.localStorage.removeItem(CHAVE_EMAIL); } catch(e){}
    try {
      if (raiz.history && raiz.history.replaceState){
        raiz.history.replaceState({}, "", raiz.location.origin + raiz.location.pathname);
      }
    } catch(e){}
  }

  /* ---- carga ---- */
  function carregar(){
    var CONFIG = raiz.FIREBASE_CONFIG;
    var criarDb = raiz.criarDbFirestore;

    if (!CONFIG || !criarDb){
      estado.erro = "falta firebase-config.js ou firestore-adapter.js";
      estado.pronto = true; avisar(); return;
    }

    Promise.all([
      import(BASE + "firebase-app.js"),
      import(BASE + "firebase-firestore.js"),
      import(BASE + "firebase-auth.js")
    ]).then(function(mods){
      var app = mods[0], fs = mods[1], au = mods[2];
      sdkAuth = au;

      var instancia = app.initializeApp(CONFIG);
      var firestore = fs.getFirestore(instancia);

      estado.auth = au.getAuth(instancia);
      estado.db = criarDb({
        db: firestore,
        doc: fs.doc, collection: fs.collection,
        getDoc: fs.getDoc, getDocs: fs.getDocs,
        setDoc: fs.setDoc, updateDoc: fs.updateDoc, deleteDoc: fs.deleteDoc,
        onSnapshot: fs.onSnapshot, runTransaction: fs.runTransaction,
        query: fs.query, where: fs.where, orderBy: fs.orderBy, limit: fs.limit
      });

      /* voltando de um link mágico */
      if (au.isSignInWithEmailLink(estado.auth, raiz.location.href)){
        var email = emailGuardado();
        if (email){
          au.signInWithEmailLink(estado.auth, email, raiz.location.href)
            .then(limparLink, function(e){ estado.erro = e && e.code; limparLink(); });
        }
        /* sem e-mail guardado, a UI pergunta e chama concluirLoginCom() */
      }

      au.onAuthStateChanged(estado.auth, function(user){
        estado.identidade = user ? {
          uid: user.uid,
          email: user.email || "",
          novo: !!(user.metadata && user.metadata.creationTime &&
                   user.metadata.creationTime === user.metadata.lastSignInTime)
        } : null;
        estado.pronto = true;
        avisar();
      });
    }, function(e){
      /* offline, CDN bloqueado, navegador antigo sem import(): o jogo
         continua nos modos que não precisam de rede. */
      estado.erro = (e && e.message) || "não consegui carregar o Firebase";
      estado.pronto = true;
      avisar();
    });
  }

  if (typeof module !== "undefined" && module.exports){
    module.exports = API;                 // pra teste em node
  } else {
    raiz.QSE_FIREBASE = API;
    if (raiz.document && raiz.document.readyState === "loading"){
      raiz.document.addEventListener("DOMContentLoaded", carregar);
    } else {
      carregar();
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
