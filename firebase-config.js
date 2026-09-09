/* ============================================================
   CONFIGURAÇÃO DO FIREBASE — projeto quem-sou-eu-e3e32

   Estas chaves são PÚBLICAS por natureza: elas viajam no JavaScript
   que roda no navegador de todo jogador. Não há como escondê-las e
   não há por que tentar. Quem protege o banco é o firestore.rules.

   O que NUNCA entra aqui é a chave de conta de serviço
   (Configurações → Contas de serviço → Gerar nova chave privada):
   essa ignora todas as regras. Não precisamos dela.
   ============================================================ */
(function(raiz){
  "use strict";

  var CONFIG = {
    apiKey: "AIzaSyAG8ZoChkM5NQz2_umH7aRKDpLrZNSbpq8",
    authDomain: "quem-sou-eu-e3e32.firebaseapp.com",
    projectId: "quem-sou-eu-e3e32",
    storageBucket: "quem-sou-eu-e3e32.firebasestorage.app",
    messagingSenderId: "974767228531",
    appId: "1:974767228531:web:901e4b1e84a7f63bd78c06"
  };

  if (typeof module !== "undefined" && module.exports) module.exports = CONFIG;
  else raiz.FIREBASE_CONFIG = CONFIG;
})(typeof globalThis !== "undefined" ? globalThis : this);
