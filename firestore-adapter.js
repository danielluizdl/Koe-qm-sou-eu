/* ============================================================
   ADAPTADOR FIRESTORE
   Expõe o mesmo contrato da capability `db` do runtime de Artifacts,
   por cima do SDK modular do Firebase (v9+). O jogo não sabe a
   diferença: CriarSalaCliente(db) continua igual.

   ES5 puro, promises, sem async/await — o resto do jogo é assim.

   O SDK entra por injeção (não por import) pra que o arquivo de
   teste possa exercitar o adaptador com um Firestore de mentira.

     var db = criarDbFirestore({
       db: getFirestore(app), doc: doc, collection: collection,
       getDoc: getDoc, getDocs: getDocs, setDoc: setDoc,
       updateDoc: updateDoc, deleteDoc: deleteDoc,
       onSnapshot: onSnapshot, runTransaction: runTransaction,
       query: query, where: where, orderBy: orderBy, limit: limit
     });

   TRÊS TRADUÇÕES QUE NÃO SÃO ÓBVIAS
   ---------------------------------
   1. update() faz merge RECURSIVO no contrato; updateDoc() do
      Firestore substitui mapas aninhados. Sem tradução, o
      update({items:{<id>:...}}) do histórico apagaria todas as
      partidas anteriores a cada partida nova. Resolvido achatando
      o patch em dot-paths: {a:{b:1}} vira {"a.b": 1}.

   2. acquire() é um lease com TTL, que o Firestore não tem. Vira
      uma transaction sobre uma coleção separada `_locks`. Separada
      porque o fluxo de criar sala faz acquire e logo em seguida
      confere snap.exists — se o lease morasse no próprio doc, toda
      sala nasceria "já existente" e ninguém criaria sala nenhuma.

   3. exists é PROPRIEDADE no contrato e MÉTODO no SDK modular.
   ============================================================ */
(function(raiz){
  "use strict";

  function criarDbFirestore(sdk){
    if (!sdk || !sdk.db) throw new TypeError("criarDbFirestore: falta sdk.db");

    /* ---- erros com o mesmo formato do contrato ---- */
    function erro(code, msg){
      var e = new Error(msg || code); e.code = code; return e;
    }

    /* ---- validação de caminho, igual ao contrato ---- */
    function checarCaminho(caminho, querDoc){
      var p = String(caminho), partes = p.split("/"), i;
      for (i = 0; i < partes.length; i++){
        if (partes[i] === "" || partes[i] === "." || partes[i] === "..")
          throw new TypeError("segmento inválido: " + p);
      }
      if (!/^[A-Za-z0-9_\-.~:@+/]+$/.test(p))
        throw new TypeError("caractere inválido no path: " + p);
      if (querDoc && partes.length % 2 !== 0)
        throw new TypeError("doc precisa de nº par de segmentos: " + p);
      if (!querDoc && partes.length % 2 === 0)
        throw new TypeError("collection precisa de nº ímpar: " + p);
      return partes;
    }

    /* ---- exists: método no SDK modular, propriedade no v8 ---- */
    function existe(snap){
      if (!snap) return false;
      return typeof snap.exists === "function" ? snap.exists() : !!snap.exists;
    }

    /* ---- snapshot de doc no formato do contrato ---- */
    function envelopeDoc(snap, caminho){
      var temDado = existe(snap);
      return {
        id: caminho.split("/").pop(),
        exists: temDado,
        data: function(){ return temDado ? snap.data() : undefined; },
        metadata: {
          fromCache: !!(snap && snap.metadata && snap.metadata.fromCache),
          hasPendingWrites: !!(snap && snap.metadata && snap.metadata.hasPendingWrites)
        }
      };
    }

    function envelopeQuery(qs){
      var docs = [];
      qs.forEach(function(d){
        docs.push({
          id: d.id,
          exists: true,
          data: (function(dd){ return function(){ return dd.data(); }; })(d),
          metadata: {
            fromCache: !!(d.metadata && d.metadata.fromCache),
            hasPendingWrites: !!(d.metadata && d.metadata.hasPendingWrites)
          }
        });
      });
      return {
        docs: docs, size: docs.length, empty: docs.length === 0,
        docChanges: function(){ return []; },
        metadata: {
          fromCache: !!(qs.metadata && qs.metadata.fromCache),
          hasPendingWrites: !!(qs.metadata && qs.metadata.hasPendingWrites)
        }
      };
    }

    /* ---- TRADUÇÃO 1: patch aninhado vira dot-paths ----
       {a:{b:1}, c:2}  ->  {"a.b":1, "c":2}
       Arrays, null e Date são folhas: substituem, não mesclam —
       é o que o deepMerge do contrato faz.
       Objeto vazio também é folha: {a:{}} grava {} em a. */
    function achatar(patch, prefixo, saida){
      saida = saida || {};
      prefixo = prefixo || "";
      var k, v, chave;
      for (k in patch){
        if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
        v = patch[k];
        chave = prefixo ? prefixo + "." + k : k;
        if (ehMapaSimples(v)){
          if (vazio(v)) saida[chave] = {};
          else achatar(v, chave, saida);
        } else {
          saida[chave] = v;
        }
      }
      return saida;
    }

    function vazio(o){
      var k;
      for (k in o){ if (Object.prototype.hasOwnProperty.call(o, k)) return false; }
      return true;
    }

    /* "É um mapa comum?" — precisa responder certo em três situações:

       1. Objeto de OUTRO REALM (iframe, contexto vm do teste). Comparar
          `getPrototypeOf(v) === Object.prototype` dá falso: cada realm
          tem o seu. O mapa viraria folha e o update SUBSTITUIRIA o
          histórico inteiro em vez de mesclar — silenciosamente.

       2. Instância de classe (Timestamp, FieldValue, GeoPoint,
          DocumentReference do Firestore). Precisa ser FOLHA: achatar
          um sentinel do SDK o destruiria.

       3. Date, RegExp, Map — folhas.

       O critério que separa os três: um mapa comum tem protótipo null,
       ou um protótipo que é ele mesmo raiz (o proto dele é null) e cujo
       constructor se chama Object. Instância de classe falha nisso,
       porque o proto do proto dela é Object.prototype, não null. */
    function ehMapaSimples(v){
      if (!v || typeof v !== "object" || Array.isArray(v)) return false;
      if (Object.prototype.toString.call(v) !== "[object Object]") return false;
      var proto = Object.getPrototypeOf(v);
      if (proto === null) return true;
      if (proto === Object.prototype) return true;
      var ctor = proto.constructor;
      return Object.getPrototypeOf(proto) === null &&
             typeof ctor === "function" && ctor.name === "Object";
    }

    /* Nome de campo com ponto quebraria o dot-path. Não acontece com
       os ids que o jogo gera, mas é barato blindar. */
    function temPontoNasChaves(patch){
      var k;
      for (k in patch){
        if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
        if (k.indexOf(".") >= 0) return true;
        if (ehMapaSimples(patch[k]) && temPontoNasChaves(patch[k])) return true;
      }
      return false;
    }

    /* ---- TRADUÇÃO 2: lease com TTL sobre transaction ----
       Guarda o lease em `_locks/<caminho escapado>`, nunca no doc
       alvo. Escapa / e ~ porque id de documento não aceita barra. */
    function chaveDeLock(caminho){
      return caminho.replace(/~/g, "~7E").replace(/\//g, "~2F");
    }

    function refDoc(caminho){
      checarCaminho(caminho, true);
      var ref = sdk.doc(sdk.db, caminho);

      return {
        id: caminho.split("/").pop(),
        path: caminho,

        get: function(){
          return sdk.getDoc(ref).then(function(s){ return envelopeDoc(s, caminho); });
        },

        set: function(dados){
          if (!dados || typeof dados !== "object" || Array.isArray(dados))
            return Promise.reject(erro("invalid_argument", "corpo precisa ser objeto"));
          return sdk.setDoc(ref, dados);
        },

        /* merge recursivo + falha se o doc não existe, como no contrato */
        update: function(dados){
          if (!dados || typeof dados !== "object" || Array.isArray(dados))
            return Promise.reject(erro("invalid_argument", "corpo precisa ser objeto"));
          if (temPontoNasChaves(dados))
            return Promise.reject(erro("invalid_argument", "nome de campo com '.' não é suportado"));
          if (vazio(dados)) return Promise.resolve();
          return sdk.updateDoc(ref, achatar(dados))["catch"](function(e){
            var c = e && e.code;
            if (c === "not-found" || c === "firestore/not-found")
              throw erro("invalid_argument", "documento não existe: " + caminho);
            throw e;
          });
        },

        "delete": function(){ return sdk.deleteDoc(ref); },

        acquire: function(opts){
          opts = opts || {};
          var agora = Date.now();
          var ttl = Math.min(600000, Math.max(1000, opts.ttlMs || 30000));
          var lock = sdk.doc(sdk.db, "_locks/" + chaveDeLock(caminho));
          return sdk.runTransaction(sdk.db, function(tx){
            return tx.get(lock).then(function(s){
              var cur = existe(s) ? s.data() : null;
              var livre = !cur || !cur.expiresAt || cur.expiresAt <= agora ||
                          cur.holder === opts.holder;
              if (!livre){
                return { acquired: false,
                         expiresAt: new Date(cur.expiresAt).toISOString() };
              }
              var exp = agora + ttl;
              var versao = ((cur && cur.version) || 0) + 1;
              tx.set(lock, {
                holder: opts.holder == null ? null : opts.holder,
                expiresAt: exp, version: versao, alvo: caminho
              });
              return { acquired: true, holder: opts.holder,
                       expiresAt: new Date(exp).toISOString(), version: versao };
            });
          });
        },

        /* O contrato não reemite quando o valor não mudou; o Firestore
           reemite (eco local do próprio write). Deduplica pra que a UI
           não repinte à toa. */
        onSnapshot: function(next, aoErro){
          var ultimo = " INIT";
          return sdk.onSnapshot(ref, function(s){
            var env = envelopeDoc(s, caminho);
            var chave = serializar([env.exists, env.data() || 0]);
            if (chave === ultimo) return;
            ultimo = chave;
            try { next(env); } catch(e){}
          }, function(e){ if (aoErro) aoErro(e); });
        },

        collection: function(sub){ return refColecao(caminho + "/" + sub); }
      };
    }

    function refColecao(caminho, restricoes){
      checarCaminho(caminho, false);
      var base = sdk.collection(sdk.db, caminho);
      var rs = restricoes || [];

      function comRestricao(r){ return refColecao(caminho, rs.concat([r])); }
      function montar(){
        if (!rs.length) return base;
        return sdk.query.apply(null, [base].concat(rs));
      }

      return {
        path: caminho,
        where: function(campo, op, valor){ return comRestricao(sdk.where(campo, op, valor)); },
        orderBy: function(campo, dir){ return comRestricao(sdk.orderBy(campo, dir)); },
        limit: function(n){ return comRestricao(sdk.limit(n)); },

        get: function(){ return sdk.getDocs(montar()).then(envelopeQuery); },

        doc: function(id){ return refDoc(caminho + "/" + (id || idAleatorio())); },

        add: function(dados){
          var r = refDoc(caminho + "/" + idAleatorio());
          return r.set(dados).then(function(){ return r; });
        },

        onSnapshot: function(next, aoErro){
          var ultimo = " INIT";
          return sdk.onSnapshot(montar(), function(qs){
            var env = envelopeQuery(qs), pares = [], i;
            for (i = 0; i < env.docs.length; i++)
              pares.push([env.docs[i].id, env.docs[i].data()]);
            var chave = serializar(pares);
            if (chave === ultimo) return;
            ultimo = chave;
            try { next(env); } catch(e){}
          }, function(e){ if (aoErro) aoErro(e); });
        }
      };
    }

    function idAleatorio(){
      return "auto-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }

    /* Ordena as chaves antes de serializar: a ordem de iteração de um
       objeto remontado pelo SDK não é a mesma do anterior, e sem isso
       a deduplicação dá falso negativo e a tela repinta à toa. */
    function serializar(v){
      return JSON.stringify(v, function(k, val){
        if (val && typeof val === "object" && !Array.isArray(val)){
          var chaves = Object.keys(val).sort(), o = {}, i;
          for (i = 0; i < chaves.length; i++) o[chaves[i]] = val[chaves[i]];
          return o;
        }
        return val;
      });
    }

    return {
      doc: function(p){ return refDoc(p); },
      collection: function(p){ return refColecao(p); },
      _achatar: achatar,
      _chaveDeLock: chaveDeLock
    };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = criarDbFirestore;
  else raiz.criarDbFirestore = criarDbFirestore;
})(typeof globalThis !== "undefined" ? globalThis : this);
