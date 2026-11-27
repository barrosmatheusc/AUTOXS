(() => {
  const grade = document.querySelector('#grade-materias');
  const modelo = document.querySelector('#modelo-editor-materia');
  const botaoAdicionar = document.querySelector('#adicionar-mais');
  const resumoLote = document.querySelector('#resumo-lote');
  const listaFila = document.querySelector('#lista-fila');
  const contadorFila = document.querySelector('#contador-fila');
  const recadoFila = document.querySelector('#recado-fila');
  const botaoAtualizarFila = document.querySelector('#atualizar-fila');
  const editoresAbertos = new Map();
  const idsFilaAutorizados = new Set();
  const STATUS_PENDENTES = new Set(['revisao','aprovado','na-fila','encaminhado','liberada','aguardando-fotografia','aguardando-revisao','publicacao-nao-confirmada']);
  let filaDrenagem = Promise.resolve();
  let operacaoFila = false;
  async function acaoFila(acao, outros = {}) {
    if (typeof window.capturaAutoXS !== 'function') throw new Error('Reinicie o AutoXS para carregar a fila persistente.');
    return window.capturaAutoXS({ acao, ...outros });
  }
  function escreverResumo(texto) { if (resumoLote) resumoLote.textContent = texto; }
  function atualizarGrade() {
    grade.dataset.quantidade = String(editoresAbertos.size);
    botaoAdicionar.hidden = false;
    botaoAdicionar.disabled = editoresAbertos.size >= 4;
    botaoAdicionar.textContent = editoresAbertos.size >= 4 ? '4 painéis abertos' : 'Adicionar +1';
    editoresAbertos.forEach(editor => editor.atualizarFechar());
  }
  async function fecharEspaco(espaco) {
    const editor = editoresAbertos.get(espaco);
    if (!editor || editor.ocupado()) return;
    const liberado = await editor.liberar();
    if (!liberado || espaco === 1) return;
    editoresAbertos.delete(espaco);
    editor.raiz.remove();
    atualizarGrade();
    document.querySelector('#recado-adicao').textContent = `Painel ${espaco} liberado e ocultado.`;
  }
  function adicionarEspaco() {
    if (editoresAbertos.size >= 4) return;
    // Reutiliza um número livre sem renumerar as matérias e suas abas no site.
    const espaco = [1, 2, 3, 4].find(numero => !editoresAbertos.has(numero));
    const seguinte = [...editoresAbertos.entries()].filter(([numero]) => numero > espaco)
      .sort(([a], [b]) => a - b)[0]?.[1].raiz || null;
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
    if (editoresAbertos.size === 1) raiz.querySelector('[data-ref="texto-bruto"]').focus();
  }
  window.exibirProgressoEnvio = (espaco, mensagem) => editoresAbertos.get(espaco)?.progresso(mensagem);
  // Recebe somente rascunhos aprovados; o envio ao CMS continua em seu botão próprio.
  window.receberRascunhoCaptura = rascunho => {
    if (!STATUS_PENDENTES.has(rascunho?.status) || !rascunho?.campos)
      return { ok: false, mensagem: 'Este rascunho não está disponível para revisão.' };
    const carregado = [...editoresAbertos.entries()].find(([, editor]) => editor.temCaptura(rascunho.id));
    if (carregado) return { ok: true, espaco: carregado[0], reutilizada: true };
    let livre = [...editoresAbertos.entries()].find(([, editor]) => editor.vazio());
    if (!livre && editoresAbertos.size < 4) {
      adicionarEspaco();
      livre = [...editoresAbertos.entries()].find(([, editor]) => editor.vazio());
    }
    if (!livre) return { ok: false, mensagem: 'Os quatro quadros estão ocupados. O rascunho permanece na fila.' };
    livre[1].carregarCaptura(rascunho);
    return { ok: true, espaco: livre[0] };
  };
  async function executarDrenagem(idsPermitidos = idsFilaAutorizados) {
    try {
      const permitidos = new Set(idsPermitidos);
      const estado = await acaoFila('listar');
      const pendentes = estado.rascunhos.filter(item => permitidos.has(item.id) && STATUS_PENDENTES.has(item.status));
      let distribuidas = 0;
      for (const item of pendentes) {
        const preparado = await acaoFila('prepararEncaminhamento', { id:item.id });
        const resposta = window.receberRascunhoCaptura(preparado);
        if (!resposta?.ok) break;
        if (!resposta.reutilizada) {
          distribuidas++;
          if (item.status !== 'encaminhado') await acaoFila('marcarEstado', { id:item.id, status:'encaminhado', motivo:'Distribuída automaticamente para revisão em um painel.' });
        }
      }
      const atual = await acaoFila('listar');
      const aguardando = atual.rascunhos.filter(item => STATUS_PENDENTES.has(item.status) &&
        ![...editoresAbertos.values()].some(editor => editor.temCaptura(item.id))).length;
      const ocupados = [...editoresAbertos.values()].filter(editor => !editor.vazio()).length;
      escreverResumo(`${ocupados} painel(is) ocupado(s) · ${aguardando} matéria(s) aguardando na fila.`);
      await atualizarFilaVisivel();
      return { distribuidas, aguardando };
    } catch (erro) {
      escreverResumo(erro.message || 'A fila persistente não pôde ser atualizada.');
      return { distribuidas:0, aguardando:0, erro };
    }
  }
  function drenarFilaInterna(idsPermitidos = idsFilaAutorizados) {
    const ids = [...idsPermitidos];
    const proxima = filaDrenagem.then(() => executarDrenagem(ids));
    filaDrenagem = proxima.catch(() => {});
    return proxima;
  }
  window.drenarFilaCaptura = drenarFilaInterna;
  const textoEstado = status => ({
    revisao:'Revisão necessária', aprovado:'Aprovada', 'na-fila':'Aguardando painel', encaminhado:'Carregada anteriormente',
    liberada:'Painel liberado', 'aguardando-fotografia':'Aguardando fotografia', 'aguardando-revisao':'Revisão necessária',
    'publicacao-nao-confirmada':'Envio não confirmado'
  })[status] || status;
  const rotulosDetalhes = [
    ['titulo','Título'], ['chapeu','Chapéu'], ['bigode','Bigode'], ['autor','Autor'], ['categoria','Categoria'],
    ['legendaImagem','Legenda'], ['creditoImagem','Créditos da foto'], ['redacao','Texto completo']
  ];
  async function carregarItemFila(id, enviar = false) {
    if (operacaoFila) return;
    operacaoFila = true; recadoFila.textContent = enviar ? 'Preparando a matéria escolhida para o site…' : 'Carregando a matéria escolhida…';
    try {
      const preparado = await acaoFila('prepararEncaminhamento', { id });
      const resposta = window.receberRascunhoCaptura(preparado);
      if (!resposta?.ok) throw new Error(resposta?.mensagem || 'Não existe painel livre. Libere um painel e tente novamente.');
      await acaoFila('marcarEstado', { id, status:'encaminhado', motivo:'Matéria carregada no painel escolhido pelo operador.' });
      recadoFila.textContent = `Matéria carregada no painel ${resposta.espaco}.`;
      if (enviar) await editoresAbertos.get(resposta.espaco).enviarAoSite();
    } catch (erro) {
      recadoFila.textContent = erro.message || 'Não foi possível carregar esta matéria.';
    } finally {
      operacaoFila = false; await atualizarFilaVisivel();
    }
  }
  function criarBotao(texto, acao, classe = '') {
    const botao = document.createElement('button'); botao.type = 'button'; botao.textContent = texto;
    if (classe) botao.className = classe;
    botao.addEventListener('click', acao); return botao;
  }
  async function atualizarFilaVisivel() {
    if (typeof window.capturaAutoXS !== 'function') {
      contadorFila.textContent = 'Reinicie o AutoXS para carregar a fila persistente.'; return;
    }
    try {
      const estado = await acaoFila('listar');
      const carregados = new Set([...editoresAbertos.values()].map(editor => editor.capturaId()).filter(Boolean));
      const pendentes = estado.rascunhos.filter(item => STATUS_PENDENTES.has(item.status) && !carregados.has(item.id));
      contadorFila.textContent = pendentes.length ? `${pendentes.length} matéria(s) aguardando.` : 'Nenhuma matéria aguardando.';
      listaFila.replaceChildren();
      pendentes.forEach((item, indice) => {
        const artigo = document.createElement('article'); artigo.className = 'item-fila'; artigo.dataset.rascunhoId = item.id;
        const topo = document.createElement('div'); topo.className = 'item-fila-cabecalho';
        const posicao = document.createElement('span'); posicao.className = 'posicao-fila'; posicao.textContent = String(indice + 1);
        const resumo = document.createElement('div');
        const titulo = document.createElement('h3'); titulo.textContent = item.campos?.titulo || 'Matéria sem título';
        const meta = document.createElement('p'); meta.className = 'meta';
        meta.textContent = [item.campos?.chapeu || 'Sem chapéu', item.campos?.categoria || 'Sem categoria', item.campos?.autor || 'Sem autor'].join(' · ');
        resumo.append(titulo, meta);
        const estadoVisual = document.createElement('span'); estadoVisual.className = 'estado-painel'; estadoVisual.textContent = textoEstado(item.status);
        topo.append(posicao, resumo, estadoVisual);
        const acoes = document.createElement('div'); acoes.className = 'acoes acoes-fila';
        const acoesPrincipais = document.createElement('div'); acoesPrincipais.className = 'grupo-acoes-fila';
        const acoesOrganizacao = document.createElement('div'); acoesOrganizacao.className = 'grupo-acoes-fila organizacao-fila';
        const detalhes = document.createElement('div'); detalhes.className = 'detalhes-fila'; detalhes.hidden = true;
        const dl = document.createElement('dl');
        for (const [campo, rotulo] of rotulosDetalhes) {
          const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = rotulo; dd.textContent = item.campos?.[campo] || 'Em branco'; dl.append(dt, dd);
        }
        detalhes.append(dl);
        acoesPrincipais.append(
          criarBotao('Visualizar', () => { detalhes.hidden = !detalhes.hidden; }, 'acao-neutra'),
          criarBotao('Carregar no painel', () => void carregarItemFila(item.id), 'acao-principal'),
          criarBotao('Enviar ao site', () => void carregarItemFila(item.id, true), 'acao-destaque')
        );
        const confirmacao = document.createElement('div'); confirmacao.className = 'confirmacao-remocao'; confirmacao.hidden = true;
        const pergunta = document.createElement('p'); pergunta.textContent = 'Remover somente esta matéria da fila?';
        const confirmarRemocao = criarBotao('Sim, remover', async () => {
            if (operacaoFila) return;
            operacaoFila = true;
            try { await acaoFila('descartar', { id:item.id }); recadoFila.textContent = 'Matéria removida da fila.'; }
            catch (erro) { recadoFila.textContent = erro.message || 'Não foi possível remover a matéria.'; }
            finally { operacaoFila = false; await atualizarFilaVisivel(); }
          }, 'confirmar-remocao');
        const cancelarRemocao = criarBotao('Cancelar', () => { confirmacao.hidden = true; remover.focus(); }, 'cancelar-remocao');
        confirmacao.append(pergunta, confirmarRemocao, cancelarRemocao);
        const remover = criarBotao('Remover', () => {
          confirmacao.hidden = false; confirmarRemocao.focus();
        }, 'acao-remover');
        acoesOrganizacao.append(
          criarBotao('↑ Subir', async () => { if (operacaoFila) return; await acaoFila('mover', { id:item.id, direcao:-1, ordem:pendentes.map(rascunho => rascunho.id) }); await atualizarFilaVisivel(); }, 'acao-ordem'),
          criarBotao('↓ Descer', async () => { if (operacaoFila) return; await acaoFila('mover', { id:item.id, direcao:1, ordem:pendentes.map(rascunho => rascunho.id) }); await atualizarFilaVisivel(); }, 'acao-ordem'),
          remover
        );
        acoes.append(acoesPrincipais, acoesOrganizacao);
        artigo.append(topo, acoes, confirmacao, detalhes); listaFila.append(artigo);
      });
    } catch (erro) {
      recadoFila.textContent = erro.message || 'Não foi possível carregar a fila persistente.';
    }
  }
  botaoAtualizarFila.addEventListener('click', () => void atualizarFilaVisivel());
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
  const estadoPainel = raiz.querySelector('[data-estado-painel]');
  botaoFechar.textContent = espaco === 1 ? 'Limpar painel' : 'Liberar e ocultar';
  botaoFechar.setAttribute('aria-label', (espaco === 1 ? 'Limpar painel da matéria ' : 'Liberar e ocultar painel da matéria ') + espaco);
  botaoFechar.addEventListener('click', () => fecharEspaco(espaco));
  const campos = [['categoria','Categoria'], ['data','Data de publicação'], ['titulo','Título'], ['chapeu','Chapéu'], ['bigode','Bigode'], ['autor','Autor'],
    ['imagemNome','Nome da fotografia'], ['legendaImagem','Legenda da imagem'], ['creditoImagem','Crédito da imagem'], ['cidade','Cidade (Radar Clima)'], ['portais','Portais recomendados'], ['tags','Tags'],
    ['imagem','Situação da imagem'], ['redacao','Redação']];
  const editores = new Map();
  const normalizar = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  let enviando = false, carregandoCategorias = false, analisandoGemini = false;
  let categoriasEmAndamento = Promise.resolve();
  let materiaAtual = { texto: '', textoIdentificado: '', campos: null, origem: {} };
  let atualizarSugestoesChapeu = () => {};
  try { localStorage.removeItem('manual-materia-rascunho-v1'); } catch {}
  bruto.value = '';
  function atualizarContinuar() { continuar.hidden = !materiaAtual.campos || bruto.value !== materiaAtual.textoIdentificado; }
  function ocupado() { return enviando || carregandoCategorias || analisandoGemini; }
  function vazio() { return !materiaAtual.campos && !bruto.value.trim(); }
  function temCaptura(id) { return materiaAtual.capturaId === id; }
  function capturaId() { return materiaAtual.capturaId || null; }
  function definirEstado(rotulo, estado = '') {
    estadoPainel.textContent = rotulo;
    estadoPainel.dataset.estadoPainel = estado || rotulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');
  }
  function carregarCaptura(rascunho) {
    if (!vazio()) throw new Error('Este quadro já contém uma matéria.');
    const originais = (rascunho.mensagens || []).map(item => item.textoOriginal).join('\n\n');
    const texto = originais || Object.values(rascunho.campos).join('\n');
    const foto = rascunho.fotoCaminho ? `Foto pronta para envio: ${rascunho.fotoNome || rascunho.campos.imagemNome || 'arquivo associado'}.` :
      (rascunho.campos.imagemNome ? `Fotografia esperada: ${rascunho.campos.imagemNome}.` : '');
    bruto.value = texto;
    const camposRascunho = { categoria: '', data: '', titulo: '', chapeu: '', bigode: '', autor: '',
      imagemNome:'', legendaImagem:'', creditoImagem:'', portais:'', tags:'', tipoRadar:'', cidade:'', redacao: '', ...rascunho.campos };
    camposRascunho.imagem ||= foto;
    materiaAtual = { id: rascunho.id, capturaId:rascunho.id, fotoCaminho:rascunho.fotoCaminho || null, texto, textoIdentificado: texto,
      campos: camposRascunho, origem: {} };
    for (const chave of Object.keys(materiaAtual.campos)) materiaAtual.origem[chave] = 'Identificado no e-mail colado';
    abrirRevisao();
    definirEstado('Matéria identificada', 'identificada');
    mostrarEstado(rascunho.fotoCaminho ? 'Rascunho carregado com a fotografia associada. Confira os campos antes de preencher o CMS.' : 'Rascunho carregado. Se houver nome de fotografia, o AutoXS tentará encontrá-la na pasta configurada.', 'concluido');
    raiz.focus();
  }
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
  function atualizarFechar() { botaoFechar.disabled = ocupado(); }
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
    definirEstado(bruto.value.trim() ? 'Em edição' : 'Livre', bruto.value.trim() ? 'identificada' : 'livre');
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
    const iniciarCarregamento = () => (categoriasEmAndamento = carregarLista());
    carregar.addEventListener('click', iniciarCarregamento); void iniciarCarregamento();
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
  $('#identificar-campos').addEventListener('click', async () => {
    if (ocupado()) { informarOcupacao(); return; }
    try {
      if (typeof window.capturaAutoXS === 'function') {
        if (!bruto.value.trim()) throw new Error('Cole uma ou mais matérias para identificar.');
        mostrarEstado('Identificando o conteúdo colado…', 'carregando');
        const analise = await acaoFila('analisarLote', { entrada:{ texto:bruto.value } });
        if (analise.quantidade === 1) {
          const unica = analise.materias[0];
          materiaAtual = { id:crypto.randomUUID(), texto:bruto.value, textoIdentificado:bruto.value, ...unica.resultado };
          abrirRevisao();
          definirEstado('Matéria identificada', 'identificada');
          mostrarEstado('Matéria identificada neste painel. Confira os campos antes de preencher o CMS.', 'concluido');
          return;
        }
        mostrarEstado(`Separando e distribuindo ${analise.quantidade} matérias…`, 'carregando');
        const resultado = await acaoFila('importarLote', { entrada:{ texto:bruto.value, origem:'E-mail colado no Adicionar Matérias' } });
        if (!resultado.novas) throw new Error('Estas matérias já estão nos painéis ou na fila. Nenhum registro foi duplicado.');
        resultado.ids.forEach(id => idsFilaAutorizados.add(id));
        iniciarNovaMateria({ focar:false });
        const distribuicao = await drenarFilaInterna(resultado.ids);
        mostrarEstado(`${resultado.novas} matéria(s) identificada(s); ${distribuicao.distribuidas} distribuída(s) agora e ${distribuicao.aguardando} aguardando na fila.`, 'concluido');
        return;
      }
      const resultado = window.IdentificadorMateria.identificarMateria(bruto.value);
      materiaAtual = { id: crypto.randomUUID(), texto: bruto.value, textoIdentificado: bruto.value, ...resultado }; abrirRevisao();
      definirEstado('Matéria identificada', 'identificada');
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
      definirEstado('Matéria identificada', 'identificada');
    } catch (erro) {
      recado.textContent = erro.message || 'Não foi possível analisar. O texto foi preservado.';
      mostrarEstado(recado.textContent, 'erro');
    } finally {
      clearInterval(relogio); clearTimeout(limiteEspera);
      analisandoGemini = false; botaoGemini.textContent = 'Identificar com Gemini'; atualizarEnvio();
    }
  });
  // O preenchimento continua em segundo plano depois que o quadro é liberado;
  // o progresso aparece no recado geral para não invadir a próxima matéria.
  const exibirProgresso = texto => {
    const recado = document.querySelector('#recado-adicao');
    if (recado) recado.textContent = `Painel ${espaco}: ${String(texto)}`;
  };
  function restaurarMateria(copia) {
    materiaAtual = copia; bruto.value = copia.texto || '';
    abrirRevisao();
  }
  async function enviarAoSite() {
    if (enviando || analisandoGemini || !materiaAtual.campos) return;
    if (carregandoCategorias) await categoriasEmAndamento.catch(() => {});
    if (ocupado() || !materiaAtual.campos || !guardarEdicoes()) return;
    enviando = true; atualizarEnvio();
    const copia = structuredClone(materiaAtual);
    const titulo = copia.campos.titulo || 'sem título';
    const capturavel = Boolean(copia.capturaId && typeof window.capturaAutoXS === 'function');
    try {
      // Tira a matéria da fila antes de liberar o quadro, para ela não ser recarregada.
      if (capturavel) await window.capturaAutoXS({acao:'marcarEstado',id:copia.capturaId,status:'preenchendo',
        motivo:'Enviada ao site; preenchimento em andamento.'});
    } catch (erro) {
      enviando = false; atualizarEnvio();
      $('#recado-revisao').textContent = erro.message || 'Não foi possível registrar o envio. Tente novamente.';
      return;
    }
    // Libera o quadro imediatamente para a próxima matéria.
    enviando = false;
    iniciarNovaMateria({ focar: raiz.contains(document.activeElement) });
    definirEstado('Livre', 'livre');
    mostrarEstado(`"${titulo}" foi enviada ao site e está sendo preenchida. Este quadro já está livre.`, 'concluido');
    atualizarEnvio();
    void drenarFilaInterna();
    try {
      const resposta = await window.enviarMateriaAoSite({espaco,id:copia.id,campos:{...copia.campos},
        fotoCaminho:copia.fotoCaminho || null, capturaId:copia.capturaId || null});
      if (resposta?.ok !== true) throw new Error(resposta?.mensagem || 'O preenchimento no site não foi confirmado.');
      if (capturavel) {
        const fotoPendente = ['foto-pendente','sem-foto-automatica'].includes(resposta.foto?.estado) && Boolean(copia.campos.imagemNome || copia.fotoCaminho);
        await window.capturaAutoXS({acao:'marcarEstado',id:copia.capturaId,
          status:fotoPendente?'aguardando-fotografia':'preenchida',
          motivo:fotoPendente?'Formulário preenchido; fotografia requer revisão manual.':'Formulário preenchido; publicação continua manual.'});
      }
      exibirProgresso(`"${titulo}" ` + (resposta.reutilizada ? 'teve a aba já preenchida reaberta.' : 'foi preenchida no site.') +
        ' A publicação final continua sendo feita por você no site.' + (resposta.avisos?.length ? ' ' + resposta.avisos.join(' ') : ''));
    } catch (erro) {
      const motivo = erro.message || 'Não foi possível preencher. Confira a aba do site.';
      if (raiz.isConnected && vazio()) {
        restaurarMateria(copia);
        $('#recado-revisao').textContent = motivo;
        definirEstado('Erro', 'erro');
        if (capturavel) await window.capturaAutoXS({acao:'marcarEstado',id:copia.capturaId,status:'encaminhado',
          motivo:'Falha no preenchimento; matéria devolvida ao painel.'}).catch(() => {});
      } else if (capturavel) {
        await window.capturaAutoXS({acao:'marcarEstado',id:copia.capturaId,status:'na-fila',
          motivo:'Falha no preenchimento; matéria devolvida à fila.'}).catch(() => {});
        exibirProgresso(`"${titulo}" não foi preenchida e voltou para a fila. ${motivo}`);
      } else {
        exibirProgresso(`"${titulo}" não foi preenchida e o quadro já tinha outra matéria. Confira a aba do site. ${motivo}`);
      }
    }
    await atualizarFilaVisivel();
  }
  botaoEnvio.addEventListener('click', enviarAoSite);
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
  async function liberar() {
    if (ocupado()) return false;
    if (!vazio()) {
      const titulo = materiaAtual.campos?.titulo || 'a matéria deste painel';
      if (!confirm(`Liberar este painel? ${titulo} continuará disponível na fila quando tiver sido importada.`)) return false;
      if (materiaAtual.capturaId) {
        try { await acaoFila('marcarEstado', { id:materiaAtual.capturaId, status:'na-fila', motivo:'Painel liberado; matéria preservada na fila.' }); }
        catch (erro) { $('#recado-revisao').textContent = erro.message || 'Não foi possível preservar a matéria na fila.'; return false; }
      }
    }
    iniciarNovaMateria(); definirEstado('Livre', 'livre');
    document.querySelector('#recado-adicao').textContent = `Painel ${espaco} liberado.`;
    await atualizarFilaVisivel(); return true;
  }
  $('#nova-materia').addEventListener('click', async () => {
    if (ocupado()) return;
    if (materiaAtual.capturaId && typeof window.capturaAutoXS === 'function') {
      try { await acaoFila('marcarEstado', { id:materiaAtual.capturaId, status:'liberada', motivo:'Quadro liberado explicitamente pelo operador.' }); }
      catch (erro) { $('#recado-revisao').textContent = erro.message || 'Não foi possível liberar esta matéria da fila.'; return; }
    }
    iniciarNovaMateria();
    definirEstado('Livre', 'livre');
    await atualizarFilaVisivel();
  });
  $('#voltar-texto').addEventListener('click', () => {
    if (ocupado() || !guardarEdicoes()) return;
    revisao.hidden = true; atualizarContinuar(); entrada.hidden = false;
  });
    return { raiz, progresso: exibirProgresso, ocupado, atualizarFechar, vazio, temCaptura, capturaId, carregarCaptura, liberar, enviarAoSite };
  }
  adicionarEspaco();
  void atualizarFilaVisivel();
})();
