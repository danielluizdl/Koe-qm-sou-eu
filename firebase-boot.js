/* ============================================================
   BOOTSTRAP DO FIREBASE

   Ponte entre o SDK modular (ESM, moderno) e o jogo (ES5, um IIFE só).
   Carrega o SDK por import() dinâmico, monta o `db` no contrato da
   capability via criarDbFirestore, cuida do login por e-mail e senha
   e entrega tudo pronto pra quem estiver esperando.

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

  /* ---- login com e-mail e senha ----
     Cada função devolve uma promessa que rejeita com um Error que tem
     `.code` do Firebase. Quem chama traduz o código pra frase; aqui não
     entra texto de interface. */

  function semSdk(){
    return Promise.reject(new Error("firebase ainda não carregou"));
  }

  API.criarConta = function(email, senha){
    if (!estado.auth || !sdkAuth) return semSdk();
    return sdkAuth.createUserWithEmailAndPassword(
      estado.auth, String(email || "").trim().toLowerCase(), String(senha || "")
    ).then(function(cred){
      /* Confirmação de e-mail: mandada e esquecida. Não trava o
         cadastro — a conta já vale. Se falhar (cota, rede), o silêncio
         é proposital: seria cruel travar quem acabou de se cadastrar
         por causa de um e-mail que nem é obrigatório. */
      try {
        if (sdkAuth.sendEmailVerification) sdkAuth.sendEmailVerification(cred.user)["catch"](noop);
      } catch(e){}
      return cred.user;
    });
  };

  API.entrar = function(email, senha){
    if (!estado.auth || !sdkAuth) return semSdk();
    return sdkAuth.signInWithEmailAndPassword(
      estado.auth, String(email || "").trim().toLowerCase(), String(senha || "")
    ).then(function(cred){ return cred.user; });
  };

  API.esqueciSenha = function(email){
    if (!estado.auth || !sdkAuth) return semSdk();
    return sdkAuth.sendPasswordResetEmail(estado.auth, String(email || "").trim().toLowerCase());
  };

  API.sair = function(){
    if (!estado.auth || !sdkAuth) return Promise.resolve();
    return sdkAuth.signOut(estado.auth);
  };

  function noop(){}

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
