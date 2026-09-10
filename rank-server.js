/* ============================================================
   RANK — LADO SERVIDOR
   ES5 puro, promises. Fala o MESMO contrato de db do resto do jogo
   (doc/collection/get/set/update), então roda igual contra o
   firestore-fake.js dos testes e contra o Admin SDK na Cloud Function.

   POR QUE ISSO EXISTE
   ------------------
   Antes, cada aparelho gravava a própria partida em
   `usuarios/{uid}/partidas/{pid}` E incrementava o agregado em
   `perfis/{uid}`. Nenhuma regra do Firestore consegue provar que o
   saldo declarado veio de partida real — então qualquer pessoa com o
   console do navegador inflava o próprio rank.

   Agora a fonte de verdade é o resultado que o HOST grava em
   `salas/{codigo}/hist/registro` (protegido por `souHostDa`). Só o
   Admin SDK escreve `partidas` e o agregado; o cliente perde essa
   escrita nas regras.

   `processarPartida` é idempotente: a mesma partida pode chegar duas
   vezes (o gatilho reprocessa, o host regrava o hist) e não dobra
   nada. O agregado é RECONSTRUÍDO da subcoleção inteira de partidas a
   cada vez — se um update anterior se perdeu, isso conserta.
   ============================================================ */
(function(raiz){
  "use strict";

  var PONTOS = (typeof require === "function")
    ? require("./pontuacao.js")
    : raiz.PONTOS;

  function agora(){ return Date.now(); }

  /* Lê salas/{codigo}/hist/registro e devolve o item de `pid`, ou null. */
  function lerResultado(db, codigo, pid){
    return db.doc("salas/" + codigo + "/hist/registro").get().then(function(s){
      if (!s.exists) return null;
      var d = s.data() || {};
      var it = d.items && d.items[pid];
      if (!it || !it.resultados || !it.resultados.length) return null;
      return it;
    });
  }

  /* Reconstrói o agregado de um jogador a partir de TODAS as partidas
     dele. Espelha contas.js#recalcular — as partidas é que são a
     verdade, o agregado é cache. */
  function recalcularAgregado(db, uid){
    return db.collection("usuarios/" + uid + "/partidas").get().then(function(qs){
      var t = { partidas: 0, vitorias: 0, podios: 0, saldo: 0, somaAprov: 0 }, i, d;
      for (i = 0; i < qs.docs.length; i++){
        d = qs.docs[i].data();
        t.partidas++;
        if (d.posicao === 1) t.vitorias++;
        if (d.posicao <= 3) t.podios++;
        t.saldo += d.saldo;
        t.somaAprov += d.aproveitamento;
      }
      t.atualizadoEm = agora();
      return db.doc("perfis/" + uid).update(t).then(function(){ return t; });
    });
  }

  /* Processa uma partida: lê o resultado do host, pontua, e para cada
     participante COM CONTA grava a partida imutável e recalcula o
     agregado. Convidado sem `perfis/{id}` é ignorado em silêncio.

     Resolve com { processados: [uid], pulados: [uid] }. */
  function processarPartida(db, codigo, pid){
    return lerResultado(db, codigo, pid).then(function(item){
      var processados = [], pulados = [];
      if (!item) return { processados: processados, pulados: pulados, semResultado: true };

      var res = item.resultados.slice().sort(function(a, b){ return a.posicao - b.posicao; });
      var ordem = [], i;
      for (i = 0; i < res.length; i++) ordem.push({ id: res[i].id, chave: res[i].posicao });

      var linhas = PONTOS.pontuarPartida(ordem);
      var terminadaEm = item.terminadaEm || agora();

      function passo(k){
        if (k >= linhas.length) return Promise.resolve({ processados: processados, pulados: pulados });
        var linha = linhas[k];
        return db.doc("perfis/" + linha.id).get().then(function(p){
          if (!p.exists){ pulados.push(linha.id); return passo(k + 1); }
          var partRef = db.doc("usuarios/" + linha.id + "/partidas/" + pid);
          return partRef.get().then(function(s){
            if (s.exists){ processados.push(linha.id); return passo(k + 1); }
            return partRef.set({
              pid: pid, sala: codigo, terminadaEm: terminadaEm,
              n: linha.n, posicao: linha.posicao,
              saldo: linha.saldo, aproveitamento: linha.aproveitamento
            }).then(function(){
              return recalcularAgregado(db, linha.id);
            }).then(function(){
              processados.push(linha.id);
              return passo(k + 1);
            });
          });
        });
      }
      return passo(0);
    });
  }

  var API = {
    processarPartida: processarPartida,
    recalcularAgregado: recalcularAgregado,
    lerResultado: lerResultado
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else raiz.RANK_SERVER = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
