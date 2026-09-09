/* ============================================================
   CONTAS, AMIGOS E PERFIL
   ES5 puro, promises. Fala o MESMO contrato de db que o resto do
   jogo (doc/collection/get/set/update/delete/onSnapshot/acquire),
   então roda igual na capability e no Firestore via adaptador.

   COLEÇÕES
     usuarios/{uid}                  PRIVADO: nome, e-mail
     usuarios/{uid}/amigos/{outro}   PRIVADO: uma aresta por lado
     usuarios/{uid}/partidas/{pid}   PRIVADO: histórico imutável
     perfis/{uid}                    PÚBLICO: nick + agregado do rank
     nicks/{chave}                   PÚBLICO: unicidade -> uid, nick

   POR QUE PERFIL É DOIS DOCUMENTOS
   --------------------------------
   Regra de segurança do Firestore decide por DOCUMENTO, nunca por
   campo: ou o leitor recebe o doc inteiro, ou nada. Como o rank
   precisa ler o agregado dos amigos, um perfil único faria amigo ler
   e-mail de amigo. Então o que é público (nick, saldo, partidas) mora
   separado do que é pessoal (nome, e-mail), e só o dono lê o segundo.

   TRÊS DECISÕES QUE MOLDAM AS REGRAS DE SEGURANÇA
   -----------------------------------------------
   1. Cada aparelho grava SÓ a própria linha. Quando a partida acaba,
      cada jogador escreve o seu resultado e atualiza o seu agregado.
      O host não escreve no perfil de ninguém. Sem isso, a regra teria
      de liberar escrita cruzada entre contas — que é como se fabrica
      ponto no rank dos outros.

   2. Amizade são DUAS arestas, uma em cada perfil. A regra libera
      escrever em usuarios/{outro}/amigos/{eu} apenas quando o id do
      documento é o meu uid: dá pra criar uma aresta que aponta pra
      mim, nunca uma que aponta pra terceiros. É o que permite pedir e
      aceitar amizade sem abrir o perfil alheio.

   O rank de amigos lê só os PERFIS (agregado pronto), não as partidas
   de cada um: uma consulta por amigo em vez de uma por partida.
   ============================================================ */
(function(raiz){
  "use strict";

  var PONTOS = (typeof require === "function")
    ? require("./pontuacao.js")
    : raiz.PONTOS;

  function agora(){ return Date.now(); }
  function noop(){}

  /* ---- nick: exibição preserva o que a pessoa digitou; a chave é
     o que garante unicidade e vira id de documento ---- */
  function normNick(s){
    return String(s == null ? "" : s).replace(/^\s+|\s+$/g, "").replace(/\s+/g, " ");
  }
  function chaveNick(s){
    var t = normNick(s).toLowerCase();
    t = t.replace(/[àáâãä]/g, "a").replace(/[èéêë]/g, "e").replace(/[ìíîï]/g, "i")
         .replace(/[òóôõö]/g, "o").replace(/[ùúûü]/g, "u")
         .replace(/[ç]/g, "c").replace(/[ñ]/g, "n");
    return t.replace(/[^a-z0-9_]/g, "");
  }
  function nickValido(s){
    var c = chaveNick(s);
    return c.length >= 2 && c.length <= 16 && normNick(s).length <= 20;
  }

  /* E-mail: exige texto, arroba, dominio e um ponto com extensao de 2+
     letras depois. Nao tenta validar se a caixa existe -- isso so o
     servidor de e-mail sabe -- mas barra o que claramente nao e
     endereco: sem arroba, sem dominio, terminado em ponto. */
  function emailValido(s){
    var t = String(s == null ? "" : s).trim();
    if (!t || t.length > 254) return false;
    if (t.indexOf(" ") >= 0) return false;
    return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/.test(t);
  }

  /* Nome completo: pelo menos duas palavras de 2+ letras. "Ana" nao
     passa, "Ana Souza" passa. */
  function nomeValido(s){
    var t = normNick(s);
    if (t.length < 4 || t.length > 60) return false;
    var partes = t.split(" ");
    var boas = 0, i;
    for (i = 0; i < partes.length; i++){
      if (/^[A-Za-zÀ-ÿ'.-]{2,}$/.test(partes[i])) boas++;
    }
    return boas >= 2;
  }

  /* Mesmo alfabeto dos códigos do jogo: sem 0, 1, I e O, porque quem lê
     um ID em voz alta no grupo confunde zero com O e um com I. */
  var A32 = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  var TAM_ID = 6;

  function sortearId(){
    var s = "", i;
    for (i = 0; i < TAM_ID; i++) s += A32.charAt(Math.floor(Math.random() * A32.length));
    return s;
  }

  /* Aceita com ou sem "#", em qualquer caixa. Devolve "" se não for um
     ID possível — assim quem chama distingue "não é ID" de "é ID que não
     existe". */
  function normId(s){
    var t = String(s == null ? "" : s).replace(/^\s+|\s+$/g, "").replace(/^#/, "").toUpperCase();
    if (t.length !== TAM_ID) return "";
    var i;
    for (i = 0; i < t.length; i++) if (A32.indexOf(t.charAt(i)) < 0) return "";
    return t;
  }
  function idValido(s){ return normId(s) !== ""; }

  function erro(code, msg){ var e = new Error(msg || code); e.code = code; return e; }

  function CriarContas(db){
    var A = {};

    function refUsuario(uid){ return db.doc("usuarios/" + uid); }   // privado
    function refPerfil(uid){ return db.doc("perfis/" + uid); }      // público
    function refAmigos(uid){ return refUsuario(uid).collection("amigos"); }
    function refAmigo(uid, outro){ return refAmigos(uid).doc(outro); }
    function refPartidas(uid){ return refUsuario(uid).collection("partidas"); }
    function refNick(chave){ return db.doc("nicks/" + chave); }
    function refId(id){ return db.doc("ids/" + id); }

    /* ---------------- nick: reserva com lease ----------------
       Mesmo padrão que criar sala usa: acquire, confere, grava. O
       lease evita que dois cadastros simultâneos levem o mesmo nick. */
    function reservarNick(chave, uid, exibicao){
      return refNick(chave).acquire({ holder: uid, ttlMs: 8000 }).then(function(res){
        if (!res || !res.acquired) throw erro("nick_em_uso", "nick sendo registrado agora");
        return refNick(chave).get().then(function(s){
          if (s.exists && s.data().uid !== uid) throw erro("nick_em_uso", "nick já existe");
          /* guarda o nick de exibição junto: adicionar amigo por nick
             passa a ser UMA leitura, sem precisar abrir o perfil de
             um desconhecido. */
          return refNick(chave).set({
            uid: uid, chave: chave, nick: normNick(exibicao || chave), em: agora()
          });
        });
      });
    }

    /* Reserva um ID livre. Mesmo padrão do apelido: acquire, confere,
       grava. Sorteia de novo em colisão — com 32^6 combinações elas são
       raras, mas raras não é nunca. */
    function reservarId(uid, tentativas){
      tentativas = tentativas || 0;
      var id = sortearId();
      return refId(id).acquire({ holder: uid, ttlMs: 8000 }).then(function(res){
        if (!res || !res.acquired){
          if (tentativas < 8) return reservarId(uid, tentativas + 1);
          throw erro("id_indisponivel", "não consegui gerar um ID");
        }
        return refId(id).get().then(function(s){
          if (s.exists && s.data().uid !== uid){
            if (tentativas < 8) return reservarId(uid, tentativas + 1);
            throw erro("id_indisponivel", "não consegui gerar um ID");
          }
          return refId(id).set({ id: id, uid: uid, em: agora() }).then(function(){ return id; });
        });
      });
    }

    /* ---------------- criar / ler perfil ---------------- */

    A.criar = function(uid, dados){
      dados = dados || {};
      if (!uid) return Promise.reject(erro("sem_uid", "uid obrigatório"));
      if (!nomeValido(dados.nome))
        return Promise.reject(erro("nome_invalido", "nome e sobrenome"));
      if (!nickValido(dados.nick))
        return Promise.reject(erro("nick_invalido", "nick precisa de 2 a 16 caracteres"));
      if (!emailValido(dados.email))
        return Promise.reject(erro("email_invalido", "e-mail inválido"));

      var chave = chaveNick(dados.nick), t = agora(), meuId = "";
      return refPerfil(uid).get().then(function(s){
        if (s.exists) throw erro("ja_existe", "esse uid já tem perfil");
        return reservarNick(chave, uid, dados.nick);
      }).then(function(){
        return reservarId(uid);
      }).then(function(id){
        meuId = id;
        return refPerfil(uid).set({
          uid: uid,
          id: meuId,
          nick: normNick(dados.nick),
          nickChave: chave,
          anonimo: false,
          criadoEm: t, atualizadoEm: t,
          /* agregado do rank, mantido só pelo dono */
          partidas: 0, vitorias: 0, podios: 0, saldo: 0, somaAprov: 0
        });
      }).then(function(){
        return refUsuario(uid).set({
          uid: uid,
          nome: normNick(dados.nome || ""),
          email: String(dados.email).toLowerCase(),
          criadoEm: t, atualizadoEm: t
        });
      }).then(function(){ return A.perfil(uid); });
    };

    /* Só o agregado, o nick e o ID — é o que qualquer pessoa logada pode
       ver, e é o que permite alguém te achar. */
    A.perfilPublico = function(uid){
      return refPerfil(uid).get().then(function(s){
        return s.exists ? s.data() : null;
      });
    };

    /* Contas criadas antes do ID existir ganham um na primeira leitura do
       próprio perfil, sem pedir nada a ninguém. Só o dono consegue (a
       regra impede escrever no perfil alheio), então isso roda quando a
       pessoa abre a própria conta. */
    A.garantirId = function(uid){
      return A.perfilPublico(uid).then(function(p){
        if (!p) return null;
        if (p.id) return p;
        return reservarId(uid).then(function(id){
          return refPerfil(uid).update({ id: id, atualizadoEm: agora() })
            .then(function(){ p.id = id; return p; });
        }, function(){ return p; });   // sem ID é melhor que sem perfil
      });
    };

    /* Visão do dono: público + pessoal. Se o privado não vier (regra
       barrou, ou é outra pessoa), devolve só o público — assim quem
       chama nunca precisa tratar dois formatos. */
    A.perfil = function(uid){
      return A.perfilPublico(uid).then(function(pub){
        if (!pub) return null;
        return refUsuario(uid).get().then(function(s){
          if (!s.exists) return pub;
          var priv = s.data(), out = {}, k;
          for (k in pub) if (Object.prototype.hasOwnProperty.call(pub, k)) out[k] = pub[k];
          out.nome = priv.nome; out.email = priv.email;
          return out;
        }, function(){ return pub; });
      });
    };

    /* Devolve {uid, nick} do índice: uma leitura, sem tocar no perfil
       de quem você ainda não conhece. */
    A.porNick = function(nick){
      var chave = chaveNick(nick);
      if (!chave) return Promise.resolve(null);
      return refNick(chave).get().then(function(s){
        return s.exists ? s.data() : null;
      });
    };

    A.porId = function(id){
      var t = normId(id);
      if (!t) return Promise.resolve(null);
      return refId(t).get().then(function(s){
        if (!s.exists) return null;
        var d = s.data();
        return A.perfilPublico(d.uid).then(function(p){
          return p ? { uid: p.uid, nick: p.nick, id: p.id } : null;
        });
      });
    };

    /* O campo de busca é um só: a pessoa cola o que tiver. Tenta apelido
       primeiro (é o que mais se digita); se não achar e o texto tiver
       cara de ID, tenta como ID. */
    A.buscar = function(texto){
      return A.porNick(texto).then(function(achado){
        if (achado) return achado;
        if (!idValido(texto)) return null;
        return A.porId(texto);
      });
    };

    A.renomear = function(uid, novoNick){
      if (!nickValido(novoNick))
        return Promise.reject(erro("nick_invalido", "nick precisa de 2 a 16 caracteres"));
      var nova = chaveNick(novoNick);
      return A.perfilPublico(uid).then(function(p){
        if (!p) throw erro("sem_perfil", "perfil não existe");
        if (p.nickChave === nova){
          return reservarNick(nova, uid, novoNick).then(function(){
            return refPerfil(uid).update({ nick: normNick(novoNick), atualizadoEm: agora() });
          });
        }
        var antiga = p.nickChave;
        return reservarNick(nova, uid, novoNick).then(function(){
          return refPerfil(uid).update({
            nick: normNick(novoNick), nickChave: nova, atualizadoEm: agora()
          });
        }).then(function(){
          /* libera o antigo por último: se cair no meio, a pessoa fica
             com dois nicks reservados, que é melhor que perder o novo
             pra outra pessoa. */
          return refNick(antiga)["delete"]().then(noop, noop);
        });
      }).then(function(){ return A.perfil(uid); });
    };

    /* ---------------- LGPD: anonimizar, não apagar ----------------
       Salas são permanentes e o histórico precisa continuar somando.
       Some o dado pessoal; o rank não quebra. */
    A.anonimizar = function(uid){
      return A.perfilPublico(uid).then(function(p){
        if (!p) return null;
        var t = agora();
        return refNick(p.nickChave)["delete"]().then(noop, noop).then(function(){
          return p.id ? refId(p.id)["delete"]().then(noop, noop) : null;
        }).then(function(){
          return refPerfil(uid).update({
            nick: "jogador removido", nickChave: "", id: "",
            anonimo: true, atualizadoEm: t
          });
        }).then(function(){
          /* o documento pessoal some inteiro: não há por que guardar
             e-mail vazio de conta encerrada. O agregado fica no perfil
             público, sem nada que identifique a pessoa. */
          return refUsuario(uid)["delete"]().then(noop, noop);
        });
      }).then(function(){ return A.perfilPublico(uid); });
    };

    /* ---------------- amizades ---------------- */

    function aresta(uid, outro, perfilOutro, status, direcao){
      return refAmigo(uid, outro).set({
        uid: outro,
        nick: perfilOutro ? perfilOutro.nick : "",
        status: status, direcao: direcao, em: agora()
      });
    }

    A.pedir = function(deUid, paraUid){
      if (deUid === paraUid)
        return Promise.reject(erro("amigo_de_si", "não dá pra se adicionar"));
      return Promise.all([A.perfilPublico(deUid), A.perfilPublico(paraUid)]).then(function(ps){
        var de = ps[0], para = ps[1];
        if (!de || !para) throw erro("sem_perfil", "perfil não existe");
        if (para.anonimo) throw erro("conta_removida", "essa conta foi removida");
        return refAmigo(deUid, paraUid).get().then(function(s){
          /* já existe aresta: se o outro já tinha pedido, aceitar direto */
          if (s.exists){
            var a = s.data();
            if (a.status === "aceito") return "ja_amigos";
            if (a.direcao === "recebido") return A.aceitar(deUid, paraUid).then(function(){ return "aceito"; });
            return "ja_pedido";
          }
          return aresta(deUid, paraUid, para, "pendente", "enviado")
            .then(function(){ return aresta(paraUid, deUid, de, "pendente", "recebido"); })
            .then(function(){ return "pedido"; });
        });
      });
    };

    A.aceitar = function(uid, deUid){
      return refAmigo(uid, deUid).get().then(function(s){
        if (!s.exists) throw erro("sem_pedido", "não há pedido desse jogador");
        if (s.data().status === "aceito") return "ja_amigos";
        return Promise.all([A.perfilPublico(uid), A.perfilPublico(deUid)]).then(function(ps){
          return aresta(uid, deUid, ps[1], "aceito", "aceito")
            .then(function(){ return aresta(deUid, uid, ps[0], "aceito", "aceito"); })
            .then(function(){ return "aceito"; });
        });
      });
    };

    A.recusar = function(uid, deUid){ return A.remover(uid, deUid); };

    A.remover = function(uid, outro){
      return refAmigo(uid, outro)["delete"]().then(function(){
        return refAmigo(outro, uid)["delete"]().then(noop, noop);
      }).then(function(){ return "removido"; });
    };

    function listar(uid, filtro){
      return refAmigos(uid).get().then(function(qs){
        var out = [], i, d;
        for (i = 0; i < qs.docs.length; i++){
          d = qs.docs[i].data();
          if (filtro(d)) out.push(d);
        }
        out.sort(function(a, b){
          return (a.nick || "").localeCompare(b.nick || "");
        });
        return out;
      });
    }

    A.amigos = function(uid){
      return listar(uid, function(d){ return d.status === "aceito"; });
    };
    A.pedidosRecebidos = function(uid){
      return listar(uid, function(d){ return d.status === "pendente" && d.direcao === "recebido"; });
    };
    A.pedidosEnviados = function(uid){
      return listar(uid, function(d){ return d.status === "pendente" && d.direcao === "enviado"; });
    };

    /* ---------------- amizade automática ----------------
       Jogou junto, virou amigo. Sem pedido, sem confirmação.

       Cada aparelho escreve os DOIS lados da SUA relação: a aresta na
       própria lista e a aresta que aponta pra si na lista do outro. A
       regra de segurança permite exatamente isso e nada mais — ninguém
       consegue casar duas pessoas quaisquer, porque a aresta que se pode
       criar na lista alheia é só a que tem o seu próprio uid.

       Idempotente: já amigos, não faz nada; pedido pendente vira aceito.
       Quem não tem conta (convidado da mesa) é ignorado em silêncio —
       não é erro, é gente sem uid. */
    A.amizadeAutomatica = function(uid, outros){
      outros = outros || [];
      var alvos = [], i, vistos = {};
      for (i = 0; i < outros.length; i++){
        var o = outros[i];
        if (!o || o === uid || vistos[o]) continue;
        vistos[o] = 1; alvos.push(o);
      }
      if (!alvos.length) return Promise.resolve([]);

      return A.perfilPublico(uid).then(function(meu){
        if (!meu) return [];
        var novos = [];
        function passo(k){
          if (k >= alvos.length) return Promise.resolve(novos);
          var outro = alvos[k];
          return A.perfilPublico(outro).then(function(p){
            /* sem perfil = convidado sem conta; segue o baile */
            if (!p || p.anonimo) return null;
            return refAmigo(uid, outro).get().then(function(s){
              var jaEra = s.exists && s.data().status === "aceito";
              return aresta(uid, outro, p, "aceito", "aceito")
                .then(function(){ return aresta(outro, uid, meu, "aceito", "aceito"); })
                .then(function(){
                  if (!jaEra) novos.push({ uid: outro, nick: p.nick });
                });
            });
          }, function(){ return null; })
           .then(function(){ return passo(k + 1); }, function(){ return passo(k + 1); });
        }
        return passo(0);
      });
    };

    /* ---------------- partidas e agregado ----------------
       `ordem` é o ranking final da partida, do 1º ao último:
       [{ id, chave }] — o mesmo formato que pontuacao.js consome.
       Grava só a linha de `uid` e só mexe no agregado de `uid`. */
    A.registrarMinhaPartida = function(uid, info){
      info = info || {};
      var pid = info.pid, ordem = info.ordem || [];
      if (!pid) return Promise.reject(erro("sem_pid", "pid obrigatório"));

      var linhas = PONTOS.pontuarPartida(ordem), minha = null, i;
      for (i = 0; i < linhas.length; i++) if (linhas[i].id === uid) minha = linhas[i];
      if (!minha) return Promise.reject(erro("fora_da_partida", "uid não está na ordem"));

      /* idempotente: a mesma partida pode chegar duas vezes (reload,
         listener reemitindo). Só conta uma. */
      return refPartidas(uid).doc(pid).get().then(function(s){
        if (s.exists) return "ja_registrada";
        return refPartidas(uid).doc(pid).set({
          pid: pid, sala: info.sala || "", terminadaEm: info.terminadaEm || agora(),
          n: minha.n, posicao: minha.posicao,
          saldo: minha.saldo, aproveitamento: minha.aproveitamento
        }).then(function(){
          return A.perfilPublico(uid);
        }).then(function(p){
          if (!p) return "sem_perfil";
          return refPerfil(uid).update({
            partidas: (p.partidas || 0) + 1,
            vitorias: (p.vitorias || 0) + (minha.posicao === 1 ? 1 : 0),
            podios: (p.podios || 0) + (minha.posicao <= 3 ? 1 : 0),
            saldo: (p.saldo || 0) + minha.saldo,
            somaAprov: (p.somaAprov || 0) + minha.aproveitamento,
            atualizadoEm: agora()
          }).then(function(){ return "registrada"; });
        });
      });
    };

    /* Reconstrói o agregado a partir das partidas gravadas. Rede de
       segurança: se um update do agregado se perder, isso conserta
       sem inventar número — as partidas é que são a verdade. */
    A.recalcular = function(uid){
      return refPartidas(uid).get().then(function(qs){
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
        return refPerfil(uid).update(t).then(function(){ return t; });
      });
    };

    /* ---------------- minhas salas ----------------
       Onde a pessoa já jogou. Antes isso morava no localStorage, então
       valia só naquele celular: trocar de aparelho apagava o histórico
       de salas. Agora mora na conta.

       Privado (usuarios/{uid}/salas) porque é a lista de onde você
       anda — não é assunto de mais ninguém. Quem está NA sala se lê em
       salas/{codigo}/jogadores, que é público pra quem tem conta. */
    function refSalas(uid){ return refUsuario(uid).collection("salas"); }

    A.marcarSala = function(uid, codigo, extra){
      if (!uid || !codigo) return Promise.resolve(null);
      /* extra.em existe pro teste conseguir controlar o instante: duas
         salas marcadas no mesmo milissegundo empatariam na ordenacao. */
      var t = (extra && extra.em) || agora();
      var ref = refSalas(uid).doc(codigo);
      return ref.get().then(function(s){
        if (s.exists){
          var d = s.data();
          return ref.update({
            ultimaEm: t,
            partidas: (d.partidas || 0) + ((extra && extra.partida) ? 1 : 0),
            nick: (extra && extra.nick) || d.nick || ""
          });
        }
        return ref.set({
          codigo: codigo,
          entrouEm: t, ultimaEm: t,
          partidas: (extra && extra.partida) ? 1 : 0,
          nick: (extra && extra.nick) || ""
        });
      }).then(function(){ return codigo; }, function(){ return null; });
    };

    /* Mais recente primeiro: a sala de ontem interessa mais que a de
       seis meses atrás. */
    A.minhasSalas = function(uid){
      return refSalas(uid).get().then(function(qs){
        var out = [], i;
        for (i = 0; i < qs.docs.length; i++) out.push(qs.docs[i].data());
        /* desempate pelo codigo: sem ele, duas salas com o mesmo
           instante sairiam em ordem imprevisivel a cada leitura. */
        out.sort(function(a, b){
          return ((b.ultimaEm || 0) - (a.ultimaEm || 0)) ||
                 String(a.codigo).localeCompare(String(b.codigo));
        });
        return out;
      }, function(){ return []; });
    };

    /* Quem estava na sala. Lê o roster público — serve pra mostrar a
       turma antes de a pessoa decidir voltar pra lá. */
    A.quemEstaNaSala = function(codigo){
      return db.doc("salas/" + codigo).collection("jogadores").get().then(function(qs){
        var out = [], i, d;
        for (i = 0; i < qs.docs.length; i++){
          d = qs.docs[i].data();
          if (d && d.nick) out.push({ id: d.id, nick: d.nick });
        }
        out.sort(function(a, b){ return (a.nick || "").localeCompare(b.nick || ""); });
        return out;
      }, function(){ return []; });
    };

    /* Os números que a home mostra embaixo de cada ambiente. Um painel
       que diz "veja suas salas" não informa nada; "3 salas · 12
       partidas" responde antes de a pessoa tocar. */
    A.resumo = function(uid){
      return Promise.all([ A.minhasSalas(uid), A.perfilPublico(uid) ])
        .then(function(r){
          var salas = r[0] || [], p = r[1] || {};
          var totalPartidas = 0, i;
          for (i = 0; i < salas.length; i++) totalPartidas += (salas[i].partidas || 0);
          return {
            salas: salas.length,
            partidasEmSalas: totalPartidas,
            partidas: p.partidas || 0,
            saldo: p.saldo || 0,
            aproveitamento: p.partidas ? (p.somaAprov || 0) / p.partidas : 0.5
          };
        });
    };

    /* ---------------- rank entre amigos ----------------
       Lê perfis (agregado pronto), não partidas: 1 leitura por amigo.
       Inclui o próprio jogador — um rank sem você não serve pra nada. */
    A.rankAmigos = function(uid){
      return A.amigos(uid).then(function(as){
        var uids = [uid], i;
        for (i = 0; i < as.length; i++) uids.push(as[i].uid);
        var buscas = [];
        for (i = 0; i < uids.length; i++) buscas.push(A.perfilPublico(uids[i]));
        return Promise.all(buscas);
      }).then(function(ps){
        var linhas = [], i, p;
        for (i = 0; i < ps.length; i++){
          p = ps[i];
          if (!p) continue;
          linhas.push({
            id: p.uid, nick: p.nick, anonimo: !!p.anonimo,
            partidas: p.partidas || 0, vitorias: p.vitorias || 0,
            podios: p.podios || 0, saldo: p.saldo || 0,
            aproveitamento: (p.partidas ? (p.somaAprov || 0) / p.partidas : 0.5),
            eu: p.uid === uid
          });
        }
        linhas.sort(PONTOS.ordenarRank);
        for (i = 0; i < linhas.length; i++) linhas[i].posicao = i + 1;
        return linhas;
      });
    };

    return A;
  }

  var API = {
    CriarContas: CriarContas,
    normNick: normNick, chaveNick: chaveNick,
    nickValido: nickValido, emailValido: emailValido, nomeValido: nomeValido,
    normId: normId, idValido: idValido, A32: A32
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else raiz.CONTAS = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
