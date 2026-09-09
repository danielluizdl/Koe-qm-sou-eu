/* ============================================================
   PONTUAÇÃO — saldo sobre o esperado
   ES5 puro, sem dependência: roda no navegador e no node.

   A ideia: uma partida de N pessoas é um torneio de todos contra
   todos. Terminar em P significa que você passou (N-P) pessoas e
   foi passado por (P-1). Cada duelo vale 1 ponto.

       saldo = (N - P) - (P - 1) = N - 2P + 1

   Por que isso é justo entre 2 e 8 jogadores: o valor de ganhar
   escala com quanta gente você teve que bater. Ganhar de 1 vale
   +1; ganhar de 7 vale +7. E a soma dos saldos de uma partida é
   sempre zero — ninguém ganha ponto do nada, só tira de alguém.

   É a fórmula que o jogo já usava (N-P+1), recentrada no valor
   esperado: saldo = 2*(N-P+1) - (N+1). Quem termina no meio da
   tabela fica em zero, que é exatamente o que a sorte prevê.
   ============================================================ */
(function(raiz){
  "use strict";

  /* Saldo de uma colocação. P pode ser fracionário (empate). */
  function saldo(n, p){
    if (!(n > 1)) return 0;                 // partida de 1 não pontua
    return n - 2 * p + 1;
  }

  /* Aproveitamento: fração dos adversários que ficaram atrás.
     1 = ganhou de todos, 0 = perdeu pra todos, .5 = mediano.
     Não escala com N — serve pra comparar consistência entre
     partidas de tamanhos diferentes. É o "%" da conversa: numa
     partida de 3, a sorte te dá 1/3 de chance de tirar 1.0, e o
     aproveitamento médio esperado é sempre .5, com qualquer N. */
  function aproveitamento(n, p){
    if (!(n > 1)) return 0.5;
    return (n - p) / (n - 1);
  }

  /* Posições fracionárias a partir da ordem final.
     `chaves` vem ordenado do 1º ao último; chaves iguais empatam e
     dividem as posições que ocupariam. Sem isso, quem não adivinhou
     (todos empatados no fim) receberia posições arbitrárias e o
     saldo da partida deixaria de somar zero. */
  function posicoes(chaves){
    var out = [], i = 0, j, k, media;
    while (i < chaves.length){
      j = i;
      while (j + 1 < chaves.length && iguais(chaves[j + 1], chaves[i])) j++;
      media = ((i + 1) + (j + 1)) / 2;      // posições são 1-based
      for (k = i; k <= j; k++) out.push(media);
      i = j + 1;
    }
    return out;
  }
  function iguais(a, b){
    if (a === b) return true;
    return a != null && b != null && String(a) === String(b);
  }

  /* Pontua uma partida inteira.
     `ordem` = array do 1º ao último: { id, chave }
     A `chave` decide empates: dois ids com a mesma chave dividem a
     posição. Passe a chave como null/undefined pra nunca empatar. */
  function pontuarPartida(ordem){
    var n = ordem.length, pos = posicoes(pluck(ordem)), r = [], i;
    for (i = 0; i < n; i++){
      r.push({
        id: ordem[i].id,
        posicao: pos[i],
        saldo: saldo(n, pos[i]),
        aproveitamento: aproveitamento(n, pos[i]),
        venceu: pos[i] === 1,
        n: n
      });
    }
    return r;
  }
  function pluck(ordem){
    var a = [], i;
    for (i = 0; i < ordem.length; i++){
      a.push(ordem[i].chave === undefined ? "#" + i : ordem[i].chave);
    }
    return a;
  }

  /* Acumula várias partidas num perfil por jogador.
     Serve tanto pro rank da sala quanto pro perfil global entre
     amigos — muda só quais partidas você joga aqui dentro. */
  function agregar(partidas){
    var mapa = {}, i, k, r, x, lista = [];
    for (i = 0; i < partidas.length; i++){
      r = partidas[i];
      for (k = 0; k < r.length; k++){
        x = mapa[r[k].id] || (mapa[r[k].id] = {
          id: r[k].id, partidas: 0, vitorias: 0, podios: 0,
          saldo: 0, somaAprov: 0
        });
        x.partidas++;
        if (r[k].posicao === 1) x.vitorias++;
        if (r[k].posicao <= 3) x.podios++;
        x.saldo += r[k].saldo;
        x.somaAprov += r[k].aproveitamento;
      }
    }
    for (k in mapa){
      if (!mapa.hasOwnProperty(k)) continue;
      x = mapa[k];
      x.aproveitamento = x.partidas ? x.somaAprov / x.partidas : 0.5;
      delete x.somaAprov;
      lista.push(x);
    }
    lista.sort(ordenarRank);
    return lista;
  }

  /* Ordem do rank: saldo manda; aproveitamento desempata (premia
     quem é consistente, não só quem jogou muito); depois vitórias. */
  function ordenarRank(a, b){
    return (b.saldo - a.saldo)
        || (b.aproveitamento - a.aproveitamento)
        || (b.vitorias - a.vitorias)
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  var API = {
    saldo: saldo, aproveitamento: aproveitamento, posicoes: posicoes,
    pontuarPartida: pontuarPartida, agregar: agregar, ordenarRank: ordenarRank
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else raiz.PONTOS = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
