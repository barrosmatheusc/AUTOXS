(() => {
  const grade = document.querySelector('#grade-materias');
  const modelo = document.querySelector('#modelo-editor-materia');
  const botaoAdicionar = document.querySelector('#adicionar-mais');
  const editoresAbertos = new Map();
  const editoresFechados = new Map();
  function atualizarGrade() {
    grade.dataset.quantidade = String(editoresAbertos.size);
    botaoAdicionar.disabled = editoresAbertos.size >= 4;
    botaoAdicionar.textContent = editoresAbertos.size >= 4 ? '4 espaços abertos' : 'Adicionar +1';
    editoresAbertos.forEach(editor => editor.atualizarFechar());
  }
  function fecharEspaco(espaco) {
    const editor = editoresAbertos.get(espaco);
    if (!editor || editoresAbertos.size <= 1 || editor.ocupado()) return;
    // Guarda o quadro na memória para recuperar texto e revisões ao reabri-lo.
    // Não fecha nem altera a aba da matéria que já esteja no site.
    editoresAbertos.delete(espaco);
    editoresFechados.set(espaco, editor);
    editor.raiz.remove();
    atualizarGrade();
    grade.querySelector('.editor-materia')?.focus();
    document.querySelector('#recado-adicao').textContent = 'Quadro fechado. Adicionar +1 recupera os quadros fechados nesta sessão.';
  }
  function adicionarEspaco() {
    if (editoresAbertos.size >= 4) return;
    // Reutiliza um número livre sem renumerar as matérias e suas abas no site.
    const espaco = [1, 2, 3, 4].find(numero => !editoresAbertos.has(numero));
    const seguinte = [...editoresAbertos.entries()].filter(([numero]) => numero > espaco)
      .sort(([a], [b]) => a - b)[0]?.[1].raiz || null;
    const guardado = editoresFechados.get(espaco);
    if (guardado) {
      editoresFechados.delete(espaco);
      grade.insertBefore(guardado.raiz, seguinte);
      editoresAbertos.set(espaco, guardado);
      atualizarGrade(); guardado.raiz.focus();
      document.querySelector('#recado-adicao').textContent = 'Quadro reaberto com o conteúdo preservado.';
      return;
    }
    const raiz = modelo.content.firstElementChild.cloneNode(true);
    raiz.setAttribute('aria-label', 'Matéria ' + espaco);
    raiz.setAttribute('tabindex', '-1');
    raiz.querySelector('[data-numero-materia]').textContent = 'Matéria ' + espaco;
    // IDs e rótulos exclusivos evitam que uma edição alcance o campo de outro quadro.
    raiz.querySelectorAll('[id]').forEach(el => { el.dataset.ref = el.id; el.id += '-' + espaco; });
    raiz.querySelectorAll('[for]').forEach(el => { el.htmlFor += '-' + espaco; });
    grade.insertBefore(raiz, seguinte);
    editoresAbertos.set(espaco, criarEditor(raiz, espaco));
    atualizarGrade();
    document.querySelector('#recado-adicao').textContent = '';
    raiz.querySelector('[data-ref="texto-bruto"]').focus();
  }
  window.exibirProgressoEnvio = (espaco, mensagem) => editoresAbertos.get(espaco)?.progresso(mensagem);
  botaoAdicionar.addEventListener('click', adicionarEspaco);
  document.querySelector('#voltar-painel').addEventListener('click', async () => {
    try { await window.voltarAoPainel(); }
    catch { document.querySelector('#recado-adicao').textContent = 'Abra a janela do painel inicial para voltar.'; }
  });
  function criarEditor(raiz, espaco) {
    const $ = seletor => raiz.querySelector(seletor.replace(/#([\w-]+)/g, '[data-ref="$1"]'));
  const entrada = $('#entrada-materia');
  const revisao = $('#revisao-materia');
  const bruto = $('#texto-bruto');
  const continuar = $('#continuar-revisao');
  const botaoEnvio = $('#enviar-ao-site');
  const botaoGemini = $('#identificar-gemini');
  const estadoIdentificacao = $('#estado-identificacao');
  const mensagemIdentificacao = $('#mensagem-identificacao');
  const tempoIdentificacao = $('#tempo-identificacao');
  const botaoFechar = $('#fechar-espaco');
  botaoFechar.setAttribute('aria-label', 'Fechar quadro da matéria ' + espaco);
  botaoFechar.addEventListener('click', () => fecharEspaco(espaco));
  const campos = [['categoria','Categoria'], ['data','Data de publicação'], ['titulo','Título'], ['chapeu','Chapéu'], ['bigode','Bigode'], ['autor','Autor'], ['imagem','Imagem destaque'], ['redacao','Redação']];
  const editores = new Map();
  const normalizar = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  let enviando = false, carregandoCategorias = false, analisandoGemini = false;
  let materiaAtual = { texto: '', textoIdentificado: '', campos: null, origem: {} };
  let atualizarSugestoesChapeu = () => {};
  try { localStorage.removeItem('manual-materia-rascunho-v1'); } catch {}
  bruto.value = '';
  function atualizarContinuar() { continuar.hidden = !materiaAtual.campos || bruto.value !== materiaAtual.textoIdentificado; }
  function ocupado() { return enviando || carregandoCategorias || analisandoGemini; }
  function mostrarEstado(mensagem, estado = 'informacao') {
    estadoIdentificacao.hidden = !mensagem;
    estadoIdentificacao.dataset.estado = estado;
    mensagemIdentificacao.textContent = mensagem;
    tempoIdentificacao.hidden = estado !== 'carregando';
    if (estado !== 'carregando') tempoIdentificacao.textContent = '';
  }
  function informarOcupacao() {
    if (analisandoGemini) return;
    mostrarEstado(enviando ? 'A matéria está sendo preenchida no site. Aguarde terminar.'
      : 'As categorias do site ainda estão carregando. Aguarde terminar.');
  }
  function atualizarFechar() { botaoFechar.disabled = editoresAbertos.size <= 1 || ocupado(); }
  function atualizarEnvio() {
    botaoEnvio.disabled = ocupado();
    botaoGemini.disabled = ocupado();
    $('#identificar-campos').disabled = ocupado();
    continuar.disabled = ocupado();
    bruto.readOnly = analisandoGemini;
    entrada.setAttribute('aria-busy', String(analisandoGemini));
    atualizarFechar();
  }
  bruto.addEventListener('input', () => {
    materiaAtual.texto = bruto.value; $('#recado-entrada').textContent = ''; atualizarContinuar();
    if (!ocupado()) mostrarEstado('');
  });
  function formatar(id, valor) {
    if (!valor) return 'Em branco';
    if (id === 'data' && /^\d{4}-\d{2}-\d{2}T/.test(valor)) {
      const [dia, hora] = valor.split('T'); return dia.split('-').reverse().join('/') + ' às ' + hora + ' — Brasília';
    }
    return valor;
  }
  function desenharCategoria(bloco, titulo, origem) {
    const seletor = document.createElement('select');
    seletor.setAttribute('aria-labelledby', titulo.id); seletor.append(new Option('Em branco', ''));
    const atual = materiaAtual.campos.categoria;
    if (atual) {
      const sugestao = new Option(atual + ' — aguardando conferência no site', atual, true, true);
      sugestao.disabled = true; seletor.append(sugestao);
    }
    const carregar = document.createElement('button');
    carregar.type = 'button'; carregar.className = 'secundario'; carregar.textContent = 'Recarregar categorias';
    const recado = document.createElement('p'); recado.className = 'origem'; recado.setAttribute('role','status');
    bloco.append(seletor, origem, carregar, recado);
    seletor.addEventListener('change', () => {
      materiaAtual.campos.categoria = seletor.value;
      materiaAtual.origem.categoria = 'Revisado por você'; origem.textContent = 'Revisado por você';
      atualizarSugestoesChapeu();
    });
    const carregarLista = async () => {
      if (carregandoCategorias || enviando) return;
      carregandoCategorias = true; atualizarEnvio(); seletor.disabled = true; carregar.disabled = true;
      recado.textContent = 'Carregando as categorias do site…';
      const materia = materiaAtual;
      try {
        if (typeof window.listarCategoriasDoSite !== 'function') throw new Error('Reinicie o AutoXS para carregar as categorias do site.');
        const resposta = await window.listarCategoriasDoSite(espaco);
        if (!resposta.ok) throw new Error(resposta.mensagem);
        if (materia !== materiaAtual || !seletor.isConnected) return;
        const anterior = materia.campos.categoria, nomes = resposta.categorias;
        const correspondencias = nomes.filter(nome => normalizar(nome) === normalizar(anterior));
        seletor.replaceChildren(new Option('Em branco', ''));
        nomes.forEach(nome => seletor.append(new Option(nome, nome)));
        seletor.value = correspondencias.length === 1 ? correspondencias[0] : '';
        materia.campos.categoria = seletor.value;
        atualizarSugestoesChapeu();
        if (anterior && !seletor.value) {
          origem.textContent = 'A sugestão “' + anterior + '” não corresponde a uma opção do site. Escolha uma categoria ou deixe em branco.';
          materia.origem.categoria = origem.textContent;
        }
        recado.textContent = 'Categorias disponíveis no site. Você também pode deixar em branco.';
      } catch (erro) {
        if (materia === materiaAtual && seletor.isConnected) recado.textContent = erro.message || 'Não foi possível carregar. Clique em Recarregar categorias.';
      } finally {
        carregandoCategorias = false; atualizarEnvio(); seletor.disabled = enviando; carregar.disabled = enviando;
      }
    };
    carregar.addEventListener('click', carregarLista); void carregarLista();
  }
  function desenhar() {
    const lista = $('#campos-identificados'); lista.replaceChildren(); editores.clear();
    atualizarSugestoesChapeu = () => {};
    for (const [id, nome] of campos) {
      const bloco = document.createElement('section'); bloco.className = 'campo-revisao'; bloco.dataset.campo = id;
      const linha = document.createElement('div'); linha.className = 'linha-campo';
      const titulo = document.createElement('h3'); titulo.textContent = nome; titulo.id = 'rotulo-' + id + '-' + espaco;
      const origem = document.createElement('p'); origem.className = 'origem';
      origem.textContent = id === 'data' ? 'Horário preenchido na identificação da matéria.' : (materiaAtual.origem[id] || (materiaAtual.campos[id] ? '' : 'Não identificado no texto.'));
      linha.append(titulo); bloco.append(linha); lista.append(bloco);
      if (id === 'categoria') { desenharCategoria(bloco, titulo, origem); continue; }
      const alterar = document.createElement('button'); alterar.type = 'button'; alterar.className = 'secundario'; alterar.textContent = 'Alterar'; alterar.setAttribute('aria-label', 'Alterar ' + nome);
      const valor = document.createElement('p'); valor.className = 'valor'; valor.textContent = formatar(id, materiaAtual.campos[id]);
      linha.append(alterar); bloco.append(valor, origem);
      if (id === 'chapeu') {
        const sugestoes = document.createElement('div'); sugestoes.className = 'sugestoes-chapeu';
        const legenda = document.createElement('p'); legenda.className = 'origem';
        legenda.textContent = 'Palavras do subtítulo e dos dois primeiros parágrafos — clique para usar';
        const cabecalhoSugestoes = document.createElement('div'); cabecalhoSugestoes.className = 'cabecalho-sugestoes-chapeu';
        const renovar = document.createElement('button'); renovar.type = 'button';
        renovar.className = 'secundario renovar-chapeu'; renovar.textContent = '↻';
        renovar.setAttribute('aria-label', 'Mostrar outras sugestões de chapéu');
        const opcoes = document.createElement('div'); opcoes.className = 'opcoes-chapeu';
        opcoes.id = 'sugestoes-chapeu-' + espaco;
        renovar.setAttribute('aria-controls', opcoes.id);
        opcoes.setAttribute('role', 'group'); opcoes.setAttribute('aria-label', 'Sugestões de chapéu da matéria ' + espaco);
        cabecalhoSugestoes.append(legenda, renovar);
        sugestoes.append(cabecalhoSugestoes, opcoes); bloco.prepend(sugestoes);
        let anteriores = '', conjuntoAnterior = '', grupoAtual = 0;
        atualizarSugestoesChapeu = (mostrarOutras = false) => {
          if (!materiaAtual.campos) return;
          const todas = window.SugestoesChapeu.sugerirChapeus(materiaAtual.campos, { todas: true });
          const conjunto = JSON.stringify(todas);
          // Cada quadro percorre suas opções. Uma nova lista recomeça pelas
          // mais relevantes, sem mexer no chapéu aplicado nem em edições abertas.
          if (conjunto !== conjuntoAnterior) { conjuntoAnterior = conjunto; grupoAtual = 0; }
          const grupos = Math.max(1, Math.ceil(todas.length / 5));
          if (mostrarOutras && grupos > 1) grupoAtual = (grupoAtual + 1) % grupos;
          const propostas = todas.slice(grupoAtual * 5, grupoAtual * 5 + 5);
          renovar.disabled = enviando || grupos <= 1;
          renovar.title = grupos > 1 ? 'Mostrar outras sugestões de chapéu' : 'Todas as sugestões disponíveis já estão aparecendo';
          if (mostrarOutras) $('#recado-revisao').textContent = grupos > 1
            ? 'Sugestões de chapéu: grupo ' + (grupoAtual + 1) + ' de ' + grupos + '. O chapéu escolhido foi mantido.'
            : 'Todas as sugestões disponíveis já estão aparecendo.';
          legenda.textContent = propostas.length
            ? 'Palavras do subtítulo e dos dois primeiros parágrafos — clique para usar'
            : 'Sem sugestão clara nesse trecho. Use Alterar para escrever o chapéu.';
          const chave = propostas.join('|');
          if (chave !== anteriores) {
            anteriores = chave; opcoes.replaceChildren();
            for (const proposta of propostas) {
              const botao = document.createElement('button');
              botao.type = 'button'; botao.className = 'secundario'; botao.textContent = proposta;
              botao.addEventListener('click', () => {
                if (enviando) return;
                // Se Alterar estiver aberto, sincroniza o editor para que um
                // envio posterior não restaure o valor anterior à sugestão.
                const campoAberto = bloco.querySelector('.editor textarea');
                if (campoAberto) {
                  campoAberto.value = proposta;
                  if (!editores.get('chapeu')?.()) return;
                } else {
                  materiaAtual.campos.chapeu = proposta.toLocaleUpperCase('pt-BR');
                  valor.textContent = materiaAtual.campos.chapeu;
                }
                materiaAtual.origem.chapeu = 'Sugestão escolhida por você';
                origem.textContent = materiaAtual.origem.chapeu;
                $('#recado-revisao').textContent = 'Chapéu aplicado: ' + materiaAtual.campos.chapeu + '.';
                atualizarSugestoesChapeu(); botao.focus();
              });
              opcoes.append(botao);
            }
          }
          for (const botao of opcoes.children) {
            botao.setAttribute('aria-pressed', String(normalizar(botao.textContent) === normalizar(materiaAtual.campos.chapeu)));
            botao.disabled = enviando;
          }
        };
        renovar.addEventListener('click', () => {
          if (!enviando) atualizarSugestoesChapeu(true);
        });
        atualizarSugestoesChapeu();
      }
      alterar.addEventListener('click', () => {
        if (editores.has(id) || enviando) return;
        const editor = document.createElement('div'); editor.className = 'editor';
        const campo = document.createElement(id === 'data' ? 'input' : 'textarea');
        if (id === 'data') { campo.type = 'datetime-local'; campo.step = '1'; }
        else campo.rows = id === 'redacao' ? 14 : 3;
        campo.setAttribute('aria-labelledby', titulo.id); campo.value = materiaAtual.campos[id];
        const acoes = document.createElement('div'); acoes.className = 'acoes';
        const aplicar = document.createElement('button'); aplicar.type = 'button'; aplicar.textContent = 'Aplicar';
        const cancelar = document.createElement('button'); cancelar.type = 'button'; cancelar.className = 'secundario'; cancelar.textContent = 'Cancelar';
        const fechar = () => { editor.remove(); valor.hidden = false; origem.hidden = false; alterar.disabled = false; editores.delete(id); alterar.focus(); };
        const guardar = () => {
          if (!campo.reportValidity()) return false;
          materiaAtual.campos[id] = id === 'chapeu' ? campo.value.trim().toLocaleUpperCase('pt-BR') : campo.value;
          materiaAtual.origem[id] = 'Revisado por você';
          valor.textContent = formatar(id, materiaAtual.campos[id]); origem.textContent = 'Revisado por você';
          $('#recado-revisao').textContent = 'Alteração aplicada.'; fechar(); atualizarSugestoesChapeu(); return true;
        };
        aplicar.addEventListener('click', guardar); cancelar.addEventListener('click', fechar);
        acoes.append(aplicar, cancelar); editor.append(campo, acoes); bloco.append(editor);
        editores.set(id, guardar); valor.hidden = true; origem.hidden = true; alterar.disabled = true; campo.focus();
      });
    }
  }
  function abrirRevisao() {
    entrada.hidden = true; revisao.hidden = false; desenhar(); $('#recado-revisao').textContent = '';
    const resumo = $('#resumo-ia');
    resumo.hidden = !materiaAtual.ia;
    resumo.textContent = materiaAtual.ia
      ? 'Campos separados pelo Gemini. Confira o resultado.' + (Number.isInteger(materiaAtual.ia.tokensTotal)
        ? ' Uso desta análise: ' + materiaAtual.ia.tokensTotal.toLocaleString('pt-BR') + ' tokens.' : '')
      : '';
    const trechos = $('#trechos-ia');
    trechos.hidden = !materiaAtual.descartados?.length; trechos.open = false;
    $('#descartados-ia').textContent = (materiaAtual.descartados || []).join('\n\n');
  }
  $('#identificar-campos').addEventListener('click', () => {
    if (ocupado()) { informarOcupacao(); return; }
    try {
      const resultado = window.IdentificadorMateria.identificarMateria(bruto.value);
      materiaAtual = { id: crypto.randomUUID(), texto: bruto.value, textoIdentificado: bruto.value, ...resultado }; abrirRevisao();
      mostrarEstado('Campos identificados. Confira a revisão abaixo.', 'concluido');
    } catch (erro) {
      $('#recado-entrada').textContent = erro.message;
      mostrarEstado(erro.message || 'Não foi possível identificar os campos. O texto foi preservado.', 'erro'); bruto.focus();
    }
  });
  botaoGemini.addEventListener('click', async () => {
    if (ocupado()) { informarOcupacao(); return; }
    const texto = bruto.value, anterior = materiaAtual;
    const recado = $('#recado-entrada');
    if (!texto.trim()) {
      recado.textContent = 'Cole o texto da matéria para identificar com Gemini.';
      mostrarEstado(recado.textContent, 'erro'); bruto.focus(); return;
    }
    if (texto.length > 120000) {
      recado.textContent = 'Cole uma matéria de cada vez, com até 120 mil caracteres.';
      mostrarEstado(recado.textContent, 'erro'); return;
    }
    let relogio, limiteEspera;
    try {
      analisandoGemini = true;
      mostrarEstado('Preparando a análise com Gemini…', 'carregando');
      tempoIdentificacao.textContent = '0 s';
      atualizarEnvio(); botaoGemini.textContent = 'Analisando…';
      recado.textContent = 'Acompanhe o andamento no aviso acima do texto.';
      const inicio = Date.now();
      relogio = setInterval(() => {
        const segundos = Math.floor((Date.now() - inicio) / 1000);
        tempoIdentificacao.textContent = segundos + ' s';
        if (segundos >= 20) mensagemIdentificacao.textContent = 'O Gemini ainda está respondendo. Aguarde; seu texto está preservado.';
      }, 1000);
      // Dá ao navegador uma oportunidade de desenhar o aviso antes da chamada.
      await new Promise(resolve => setTimeout(resolve, 50));
      if (typeof window.identificarMateriaComGemini !== 'function') throw new Error('Reinicie o AutoXS para conectar a análise com Gemini.');
      mostrarEstado('Analisando o texto com Gemini. Aguarde…', 'carregando');
      const resposta = await Promise.race([
        window.identificarMateriaComGemini({ espaco, texto }),
        new Promise((_, rejeitar) => {
          limiteEspera = setTimeout(() => rejeitar(new Error('A resposta não chegou ao painel em 75 segundos. Seu texto foi preservado. Reinicie o AutoXS antes de tentar com Gemini novamente; você também pode usar Identificar campos.')), 75000);
        })
      ]);
      clearInterval(relogio); clearTimeout(limiteEspera);
      if (!resposta || typeof resposta.ok !== 'boolean') throw new Error('O AutoXS recebeu uma resposta inesperada. Reinicie o programa para carregar a integração atualizada.');
      if (!resposta.ok) throw new Error(resposta.mensagem);
      if (materiaAtual !== anterior || bruto.value !== texto) {
        recado.textContent = 'O texto mudou durante a análise. O resultado anterior não foi aplicado.';
        mostrarEstado(recado.textContent, 'erro');
        return;
      }
      materiaAtual = { id: crypto.randomUUID(), texto, textoIdentificado: texto, ...resposta.resultado };
      analisandoGemini = false;
      recado.textContent = ''; atualizarContinuar(); abrirRevisao();
      mostrarEstado('Análise concluída. Confira os campos separados pelo Gemini abaixo.', 'concluido');
    } catch (erro) {
      recado.textContent = erro.message || 'Não foi possível analisar. O texto foi preservado.';
      mostrarEstado(recado.textContent, 'erro');
    } finally {
      clearInterval(relogio); clearTimeout(limiteEspera);
      analisandoGemini = false; botaoGemini.textContent = 'Identificar com Gemini'; atualizarEnvio();
    }
  });
  const exibirProgresso = texto => { $('#recado-revisao').textContent = String(texto); };
  botaoEnvio.addEventListener('click', async () => {
    if (ocupado() || !materiaAtual.campos || !guardarEdicoes()) return;
    enviando = true;
    atualizarEnvio();
    const controles = [...revisao.querySelectorAll('button, select')]; controles.forEach(b=>{b.disabled=true;});
    botaoEnvio.textContent = 'Preenchendo no site…'; exibirProgresso('Aguardando o preenchimento desta matéria…');
    let mensagemSucesso = '';
    try {
      const resposta = await window.enviarMateriaAoSite({espaco,id:materiaAtual.id,campos:{...materiaAtual.campos}});
      if (resposta?.ok !== true) throw new Error(resposta?.mensagem || 'O preenchimento no site não foi confirmado.');
      mensagemSucesso = (resposta.reutilizada ? 'A aba já preenchida foi reaberta.' : 'Matéria preenchida no site.') + ' Este quadro está pronto para uma nova matéria. A publicação final continua sendo feita por você no site.' + (resposta.avisos?.length ? ' ' + resposta.avisos.join(' ') : '');
    } catch (erro) {
      exibirProgresso(erro.message || 'Não foi possível preencher. Confira a aba do site.');
    } finally {
      enviando = false; controles.forEach(b=>{b.disabled=false;}); botaoEnvio.textContent = 'Enviar matéria ao site'; atualizarEnvio(); atualizarSugestoesChapeu();
    }
    if (mensagemSucesso) {
      // Limpa só este quadro depois da confirmação. Não rouba o foco se outra
      // matéria estiver sendo digitada enquanto o site termina o preenchimento.
      iniciarNovaMateria({ focar: raiz.contains(document.activeElement) });
      mostrarEstado(mensagemSucesso, 'concluido');
    }
  });
  continuar.addEventListener('click', () => { if (!ocupado()) abrirRevisao(); });
  function guardarEdicoes() { for (const aplicar of [...editores.values()]) if (!aplicar()) return false; return true; }
  function iniciarNovaMateria({ focar = true } = {}) {
    materiaAtual = { texto: '', textoIdentificado: '', campos: null, origem: {} };
    editores.clear(); $('#campos-identificados').replaceChildren(); bruto.value = '';
    atualizarSugestoesChapeu = () => {};
    $('#resumo-ia').textContent = ''; $('#resumo-ia').hidden = true;
    $('#descartados-ia').textContent = '';
    $('#trechos-ia').hidden = true; $('#trechos-ia').open = false;
    $('#recado-entrada').textContent = ''; $('#recado-revisao').textContent = '';
    mostrarEstado('');
    atualizarContinuar(); revisao.hidden = true; entrada.hidden = false;
    entrada.querySelector('.miolo').scrollTop = 0;
    if (focar) bruto.focus();
  }
  $('#nova-materia').addEventListener('click', () => {
    if (ocupado()) return;
    iniciarNovaMateria();
  });
  $('#voltar-texto').addEventListener('click', () => {
    if (ocupado() || !guardarEdicoes()) return;
    revisao.hidden = true; atualizarContinuar(); entrada.hidden = false;
  });
    return { raiz, progresso: exibirProgresso, ocupado, atualizarFechar };
  }
  adicionarEspaco();
})();
