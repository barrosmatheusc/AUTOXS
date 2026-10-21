const path = require('node:path');
const { extrairTermoBusca } = require('./termo-busca');
const { criarPainelManual } = require('./painel-manual');
const { criarSessaoAtualizacaoDiscreta } = require('./sessao-atualizacao-discreta');
const { criarGrupoJanelas } = require('./janelas-trabalho');
const { confirmarSalvamento, acompanharEnvioManual } = require('./acompanhar-envio');
const { conferirCategoriaEsportes, mostrarConferenciaCategoria, ehCategoriaEsportiva } = require('./conferir-esportes');
const { selecionarPaginaListagem, avancarPaginaListagem, aguardarTabelaListagem } = require('./pagina-listagem');
const { criarEnvioAoSite } = require('./preencher-materia');
const { criarHistoricoProducao } = require('./historico-producao');
const { criarCompartilhamento } = require('./compartilhar-materias');
const { criarBuscadorLinks } = require('./painel-producao');
const { mostrarAjudaFotos } = require('./ajuda-fotos');
const { acompanharFotosAdicao } = require('./fotos-adicao');
const { instalarBotaoLegenda } = require('./botao-legenda');
const { instalarSugestoesChapeuCMS } = require('./sugestoes-chapeu-cms');
const { validarRequisitosDaMateria, instalarProtecaoEnvioCMS } = require('./requisitos-materia');
const { prepararImagensAgenciaBrasil, analisarImagensAgenciaBrasil, extrairHtmlRequisicao } = require('./agencia-brasil-imagens');
const { lerCategoriaAtual, podeGerarImagemRJ, gerarImagemRJ, gerarImagemPorSolicitacao, imagemEmGeracao } = require('./imagem-rj');

const TITULO_LIMITE = 'Quanto foi o jogo Brasil x Japão hoje? Veja resultado dos gols';
const MAX_ABAS_ATUALIZACAO = 3;
const URL_NEWS = 'https://redacao.tribunaweb.com.br/news';
// O CMS pode apresentar data e horário juntos: 24/09/202617:32.
// A coleta e a conferência do lote devem aceitar o mesmo formato.
const PADRAO_DATA = /\b(\d{2})\/(\d{2})\/(\d{4})(?:\s*(\d{2}):(\d{2}))?\b/;
const categoriasCorrigidas = new WeakMap();
const logosRemovidos = new WeakSet();

// A data é apenas informativa; o limite da fila é a matéria de referência.
function converterData(texto) {
  const partes = String(texto).match(PADRAO_DATA);
  if (!partes) return null;
  const [, dia, mes, ano, hora = '0', minuto = '0'] = partes;
  const data = new Date(+ano, +mes - 1, +dia, +hora, +minuto);
  if (data.getFullYear() !== +ano || data.getMonth() !== +mes - 1 ||
      data.getDate() !== +dia || data.getHours() !== +hora || data.getMinutes() !== +minuto) return null;
  return data;
}

function ehMateriaLimite(titulo) {
  const simplificar = valor => normalizar(valor).replace(/×/g, 'x')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return simplificar(titulo) === simplificar(TITULO_LIMITE);
}

async function coletarMaterias(page, estado = {}) {
  // A referência e tudo abaixo dela ficam fora da fila, inclusive quando não
  // têm link de edição. O número de linhas da página nunca limita a busca.
  estado.limiteEncontrado = false;
  estado.registros = 0;
  estado.ignoradas = [];
  estado.ultimaMateria = '';
  let linhas;
  for (const seletor of ['table tbody tr', 'tr', '[role="row"]', '.list-group-item', '.card', '.row']) {
    const candidatos = page.locator(seletor);
    if (await candidatos.count() > 0) {
      linhas = candidatos;
      break;
    }
  }
  if (!linhas) return [];
  const materias = [];
  const vistas = new Set();
  const quantidade = await linhas.count();
  for (let i = 0; i < quantidade; i++) {
    const linha = linhas.nth(i);
    if (!await linha.isVisible()) { estado.ignoradas.push({ linha:i + 1, motivo:'linha oculta' }); continue; }
    const texto = await linha.innerText();
    const celulas = linha.locator('td');
    const quantidadeCelulas = await celulas.count();
    if (!quantidadeCelulas) continue; // Cabeçalho da tabela, não é registro.
    estado.registros++;
    const titulo = quantidadeCelulas > 7
      ? (await celulas.nth(7).innerText()).trim()
      : texto.replace(/\s+/g, ' ').trim();
    estado.ultimaMateria = titulo || texto.replace(/\s+/g, ' ').trim();
    if (ehMateriaLimite(titulo)) {
      estado.limiteEncontrado = true;
      break;
    }
    if (!titulo) { estado.ignoradas.push({ linha:i + 1, motivo:'título ausente' }); continue; }
    const links = linha.locator('a');
    const enderecos = await links.evaluateAll(elementos => elementos
      .filter(a => /editar/i.test(`${a.textContent} ${a.title} ${a.getAttribute('aria-label') || ''}`) || /edit/i.test(a.getAttribute('href') || ''))
      .map(a => a.getAttribute('href')).filter(Boolean));
    const urls = [];
    let linkMalformado = false;
    for (const href of enderecos) {
      try { urls.push(new URL(href, page.url()).href); }
      catch { linkMalformado = true; }
    }
    const unicas = [...new Set(urls)];
    if (linkMalformado || unicas.length !== 1) {
      estado.ignoradas.push({ linha:i + 1, titulo, motivo:linkMalformado ? 'link de edição malformado' :
        unicas.length ? 'links de edição ambíguos' : 'link de edição ausente' });
      continue;
    }
    const url = unicas[0];
    const destino = new URL(url);
    if (destino.origin !== new URL(URL_NEWS).origin ||
        !/^\/news\/(?:edit\/\d+|\d+\/edit)\/?$/.test(destino.pathname)) {
      estado.ignoradas.push({ linha:i + 1, titulo, motivo:'endereço de edição inválido' });
      continue;
    }
    if (vistas.has(url)) { estado.ignoradas.push({ linha:i + 1, titulo, motivo:'registro duplicado na página' }); continue; }
    const dataTexto = texto.match(PADRAO_DATA)?.[0];
    vistas.add(url);
    materias.push({ url, data: dataTexto, titulo });
  }
  estado.elegiveis = materias.length;
  return materias;
}

async function percorrerFilaAteReferencia({ paginaInicial = 1, lerPagina, avancar, progresso = async () => {}, ativo = () => true }) {
  const resultado = { materias:[], paginas:0, registros:0, elegiveis:0, ignoradas:0,
    duplicadas:0, ultimaMateria:'', limiteEncontrado:false, interrompido:false, erroBusca:'' };
  const vistas = new Set();
  let numero = paginaInicial;
  while (ativo()) {
    let leitura;
    try { leitura = await lerPagina(numero); }
    catch (erro) { resultado.erroBusca = `Página ${numero}: ${erro.message}`; break; }
    const { materias, estado } = leitura;
    resultado.paginas++;
    resultado.registros += estado.registros;
    resultado.ultimaMateria = estado.ultimaMateria || resultado.ultimaMateria;
    await progresso(`[BUSCA] Página ${numero}: ${estado.registros} registros identificados.`);
    for (const ignorada of estado.ignoradas) {
      resultado.ignoradas++;
      await progresso(`[FILTROS] Página ${numero}, linha ${ignorada.linha}${ignorada.titulo ? ` — ${ignorada.titulo}` : ''}: ${ignorada.motivo}.`);
    }
    for (const materia of materias) {
      if (vistas.has(materia.url)) {
        resultado.duplicadas++;
        await progresso(`[FILTROS] ${materia.titulo}: registro duplicado entre páginas.`);
        continue;
      }
      vistas.add(materia.url);
      resultado.materias.push(materia);
      resultado.elegiveis++;
    }
    await progresso(`[BUSCA] Total acumulado: ${resultado.registros} registros; ${resultado.elegiveis} elegíveis; ${resultado.ignoradas + resultado.duplicadas} ignorados.`);
    if (estado.limiteEncontrado) { resultado.limiteEncontrado = true; break; }
    if (!ativo()) break;
    try { if (!await avancar(numero)) break; }
    catch (erro) { resultado.erroBusca = `Após a página ${numero}: ${erro.message}`; break; }
    numero++;
  }
  resultado.interrompido = !ativo();
  if (!resultado.limiteEncontrado) await progresso(`[LIMITE] Referência Brasil x Japão não encontrada. ${resultado.paginas} página(s) verificadas; última matéria: ${resultado.ultimaMateria || 'nenhuma'}.${resultado.erroBusca ? ` Erro: ${resultado.erroBusca}` : ''}`);
  return resultado;
}

async function processarFilaEmGrupos(materias, operacoes, aguardarVagas, progresso = async () => {}) {
  const total = { abertas:0, enviadas:0, pendentes:0, erros:0 };
  let processadas = 0;
  for (let inicio = 0; inicio < materias.length;) {
    if (operacoes.ativo?.() === false) { total.interrompido = true; break; }
    const vagas = await aguardarVagas();
    if (!vagas || operacoes.ativo?.() === false) { total.interrompido = true; break; }
    const grupo = materias.slice(inicio, inicio + Math.min(MAX_ABAS_ATUALIZACAO, vagas))
      .map((materia, indice) => ({ ...materia, numeroExecucao:inicio + indice + 1 }));
    await progresso(`[ABAS] Até ${grupo.length} matéria(s) em processamento; ${materias.length - inicio - grupo.length} aguardando vaga.`);
    const parcial = await processarLote(grupo, { ...operacoes,
      registrarProcessada:materia => { processadas++; operacoes.registrarProcessada?.(materia); } });
    for (const chave of ['abertas', 'enviadas', 'pendentes', 'erros']) total[chave] += parcial[chave];
    inicio += grupo.length;
    if (parcial.interrompido) { total.interrompido = true; break; }
  }
  total.processadas = processadas;
  return total;
}

async function aguardarVagasAtualizacao({ listarAbertas, ativo, progresso = async () => {}, esperar = () => new Promise(resolve => setTimeout(resolve, 1000)) }) {
  while (ativo()) {
    const abertas = listarAbertas();
    if (abertas < MAX_ABAS_ATUALIZACAO) return MAX_ABAS_ATUALIZACAO - abertas;
    await progresso(`[CONTINUIDADE] ${abertas} abas aguardam revisão. Conclua ou feche uma para continuar a fila.`);
    await esperar();
  }
  return 0;
}

async function abrirPesquisaImagem(aba, titulo = '', opcoes = {}) {
  // Prefere o título atual da edição; o título da listagem é a alternativa.
  const campoTitulo = aba.locator('input[name="title"], #inp_title').filter({ visible: true });
  if (await campoTitulo.count() === 1) titulo = (await campoTitulo.inputValue()).trim() || titulo;
  const campoSubtitulo = aba.locator('input[name="subtitle"], textarea[name="subtitle"], #inp_subtitle');
  const subtitulo = await campoSubtitulo.count() === 1 ? await campoSubtitulo.inputValue() : '';
  const dialogExistente = aba.getByRole('dialog', { name: /Imagem de Destaque/i });
  const jaAberto = await dialogExistente.isVisible();
  if (jaAberto && !opcoes.iniciarPesquisa) {
    await mostrarAjudaFotos(aba, dialogExistente, titulo, { subtitulo, gerarImagem: log => gerarImagemPorSolicitacao(aba, verificarImagemDestaque, log) });
    const pesquisaAtual = dialogExistente.getByRole('searchbox', { name: 'Pesquisar:' });
    return await pesquisaAtual.inputValue();
  }
  const termo = extrairTermoBusca(titulo);
  if (!jaAberto) {
    const mais = aba.getByRole('button', { name: '+', exact: true });
    if (await mais.count() < 2) throw new Error('Não foi possível identificar o botão da imagem destaque.');
    await mais.first().click();
  }
  const dialog = aba.getByRole('dialog', { name: /Imagem de Destaque/i });
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  // Ajusta somente a quantidade de fotos no modal, preservando a listagem de matérias.
  const exibir = dialog.getByRole('combobox', { name: /exibir/i })
    .or(dialog.locator('select[name$="_length"], .dataTables_length select, .dt-length select'))
    .filter({ visible: true });
  await exibir.waitFor({ state: 'visible', timeout: 10000 });
  await exibir.selectOption({ label: '100' });
  const pesquisar = dialog.getByRole('searchbox', { name: 'Pesquisar:' });
  await pesquisar.waitFor({ state: 'visible', timeout: 10000 });
  if (termo && !(await pesquisar.inputValue()).trim()) {
    await pesquisar.fill(termo);
    await pesquisar.press('Enter');
  }
  await pesquisar.focus();
  await mostrarAjudaFotos(aba, dialog, titulo, { subtitulo, gerarImagem: log => gerarImagemPorSolicitacao(aba, verificarImagemDestaque, log) });
  // Não seleciona fotos nem envia a matéria: o usuário revisa os resultados.
  return termo;
}

function localizarCampoChapeu(aba) {
  // O rótulo pode incluir asterisco, dois-pontos ou uma indicação de opcional.
  // Alguns formulários identificam o campo somente pelo nome ou id do input.
  return aba.getByRole('textbox', { name: /chap[eé]u/i })
    .or(aba.locator([
      'input[name="hat"]', 'input[id="inp_hat"]',
      'input[name*="chapeu" i]', 'input[id*="chapeu" i]',
      'textarea[name*="chapeu" i]', 'textarea[id*="chapeu" i]',
      'input[placeholder*="Chapéu" i]', 'input[placeholder*="Chapeu" i]'
    ].join(', ')))
    .filter({ visible: true });
}

async function lerConferenciaCategoria(aba, chapeu) {
  const categoria = await lerCategoriaAtual(aba);
  const campoTitulo = aba.locator('input[name="title"], #inp_title');
  const titulo = await campoTitulo.count() === 1 ? await campoTitulo.inputValue() : '';
  let subtitulo = '';
  let conteudo = '';
  if (ehCategoriaEsportiva(categoria)) {
    const campoSubtitulo = aba.locator('input[name="subtitle"], textarea[name="subtitle"], #inp_subtitle');
    if (await campoSubtitulo.count() === 1) subtitulo = await campoSubtitulo.inputValue();
    const fonte = aba.locator('.rx-source');
    const editor = aba.locator('.rx-editor');
    const campoTexto = aba.locator('#inp_text, textarea[name="text"]');
    if (await fonte.count() === 1 && await fonte.isVisible()) conteudo = await fonte.inputValue();
    else if (await editor.count() === 1) conteudo = await editor.textContent() || '';
    else if (await campoTexto.count() === 1) conteudo = await campoTexto.inputValue();
  }
  const conferenciaCategoria = conferirCategoriaEsportes({ categoria, titulo, chapeu, subtitulo, conteudo });
  return { categoria, conferenciaCategoria };
}

async function corrigirCategoriaGeral(aba) {
  const campo = aba.locator('#inp_category_id, select[name="category_id"]');
  if (await campo.count() !== 1) return { ok:false, motivo:'Controle de categoria ausente ou ambíguo.' };
  const opcao = await campo.evaluate(select => {
    if (select.tagName !== 'SELECT' || select.name !== 'category_id' || !select.closest('form') || select.multiple) return null;
    const geral = [...select.options].filter(item => item.textContent.trim().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'geral' && !item.disabled);
    return geral.length === 1 && geral[0].value ? geral[0].value : null;
  });
  if (!opcao) return { ok:false, motivo:'Opção Geral única e ativa não encontrada no formulário.' };
  await campo.selectOption(opcao);
  const confirmado = await campo.evaluate((select, valor) => {
    const formulario = select.closest('form');
    return select.value === valor && select.selectedOptions.length === 1 &&
      select.selectedOptions[0].textContent.trim().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'geral' &&
      new FormData(formulario).getAll(select.name).length === 1 &&
      new FormData(formulario).get(select.name) === valor;
  }, opcao);
  return confirmado ? { ok:true, valor:opcao } :
    { ok:false, motivo:'O controle mudou visualmente, mas o valor category_id do formulário não confirmou Geral.' };
}

async function lerPendencias(aba) {
  if (imagemEmGeracao(aba)) throw new Error('A geração de imagem ainda está em andamento.');
  const campo = localizarCampoChapeu(aba);
  if (await campo.count() !== 1 || !await campo.isVisible()) {
    throw new Error('Campo Chapéu não identificado.');
  }
  const chapeu = (await campo.inputValue()).trim();
  let { categoria, conferenciaCategoria } = await lerConferenciaCategoria(aba, chapeu);
  if (conferenciaCategoria.categoriaDestino === 'Geral') {
    const assunto = conferenciaCategoria.assunto;
    let corrigida;
    try { corrigida = await corrigirCategoriaGeral(aba); }
    catch (erro) { corrigida = { ok:false, motivo:`Falha ao selecionar Geral: ${erro.message}` }; }
    if (corrigida.ok && (await lerCategoriaAtual(aba)).trim().toLowerCase() === 'geral') {
      categoriasCorrigidas.set(aba, { valor:corrigida.valor, assunto });
      categoria = 'Geral';
      conferenciaCategoria = { revisar:false,
        mensagem:`Categoria corrigida de Esportes para Geral (${assunto}); demais requisitos continuam obrigatórios.` };
      console.log(`[AUTOXS][CATEGORIA] Esportes → Geral (${assunto}); valor category_id confirmado no formulário.`);
    } else {
      conferenciaCategoria = { revisar:true,
        mensagem:`Categoria Esportes indica ${assunto}, mas a mudança para Geral não foi confirmada no formulário: ${corrigida.motivo || 'leitura final da categoria diferente de Geral'}. Revisão manual necessária.` };
    }
  }
  await mostrarConferenciaCategoria(aba, conferenciaCategoria);
  const imagem = await verificarImagemDestaque(aba);
  return { temChapeu: Boolean(chapeu), temImagem: imagem.temImagem, categoria, conferenciaCategoria };
}

async function mostrarAvisoMateriaIncompleta(aba) {
  const mensagem = '⚠️ CHAPÉU FALTANDO';
  await aba.bringToFront();
  await aba.evaluate(texto => {
    document.getElementById('autoxs-aviso-materia-incompleta')?.remove();
    const aviso = document.createElement('div');
    aviso.id = 'autoxs-aviso-materia-incompleta';
    aviso.textContent = texto;
    Object.assign(aviso.style, {
      position:'fixed', top:'24px', left:'50%', transform:'translateX(-50%)',
      zIndex:'2147483647', padding:'18px 28px', borderRadius:'10px',
      background:'#b42318', color:'#fff', font:'700 22px/1.2 Arial, sans-serif',
      boxShadow:'0 10px 30px rgba(0,0,0,.45)', textAlign:'center',
      pointerEvents:'none'
    });
    document.body.appendChild(aviso);
    setTimeout(() => aviso.remove(), 1000);
  }, mensagem);
  await aba.waitForTimeout(1050);
}

async function validarChapeuEFotoAntesDoEnvio(aba, mostrarAviso = true) {
  const campo = localizarCampoChapeu(aba);
  if (await campo.count() !== 1 || !(await campo.inputValue()).trim()) {
    if (mostrarAviso) await mostrarAvisoMateriaIncompleta(aba);
    return false;
  }
  const imagem = await verificarImagemDestaque(aba);
  return imagem.temImagem === true;
}

function extrairCategoriaRequisicao(requisicao) {
  const tipo = String(requisicao.headers()['content-type'] || '').toLowerCase();
  const corpo = requisicao.postData();
  if (typeof corpo !== 'string') return null;
  if (tipo.includes('application/x-www-form-urlencoded')) {
    const valores = new URLSearchParams(corpo).getAll('category_id');
    return valores.length === 1 ? valores[0] : null;
  }
  if (tipo.includes('application/json')) {
    try {
      const valor = JSON.parse(corpo).category_id;
      return typeof valor === 'string' || typeof valor === 'number' ? String(valor) : null;
    } catch { return null; }
  }
  if (tipo.includes('multipart/form-data')) {
    const limite = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(requisicao.headers()['content-type'] || '')?.slice(1).find(Boolean);
    if (!limite) return null;
    const valores = [];
    for (const parte of corpo.split(`--${limite}`)) {
      const separador = parte.indexOf('\r\n\r\n');
      if (separador < 0 || !/^content-disposition:[^\r\n]*\bname="category_id"/im.test(parte.slice(0, separador))) continue;
      valores.push(parte.slice(separador + 4).replace(/\r\n$/, ''));
    }
    return valores.length === 1 ? valores[0] : null;
  }
  return null;
}

async function enviarMateria(aba, mostrarAviso = true, informarPendencia = () => {}) {
  // Usa o formulário do chapéu, evitando o Enviar do login ou de um modal.
  const campo = localizarCampoChapeu(aba);
  const formulario = campo.locator('xpath=ancestor::form[1]');
  if (await formulario.count() !== 1) throw new Error('Formulário da matéria não identificado pelo campo Chapéu.');
  // O ícone de avião do CMS faz parte do nome acessível do botão Enviar.
  const enviar = formulario.getByRole('button', { name: /^[^\p{L}\p{N}]*(?:enviar|salvar|atualizar)(?:\s+mat[eé]ria)?[^\p{L}\p{N}]*$/iu }).filter({ visible: true });
  if (await enviar.count() !== 1) throw new Error('Botão Enviar/Salvar/Atualizar ausente ou ambíguo no formulário da matéria.');
  // Última proteção antes do envio real: exige chapéu e foto, sem popup para foto ausente.
  if (!await validarChapeuEFotoAntesDoEnvio(aba, mostrarAviso)) return false;
  if (!await enviar.isEnabled()) return false;
  if (!await formulario.evaluate(form => form.checkValidity())) return false;
  const categoriaAntesEnvio = await lerConferenciaCategoria(aba, (await campo.inputValue()).trim());
  if (categoriaAntesEnvio.conferenciaCategoria.revisar || categoriaAntesEnvio.conferenciaCategoria.categoriaDestino) {
    const motivo = categoriaAntesEnvio.conferenciaCategoria.categoriaDestino
      ? 'Categoria Esportes ainda precisa ser confirmada como Geral antes do envio automático.'
      : categoriaAntesEnvio.conferenciaCategoria.mensagem;
    informarPendencia(motivo);
    console.warn(`[AUTOXS] ${motivo}`);
    return false;
  }
  const categoriaCorrigida = categoriasCorrigidas.get(aba);
  if (categoriaCorrigida) {
    const seletorCategoria = aba.locator('#inp_category_id, select[name="category_id"]');
    const formularioReal = await formulario.elementHandle();
    const confirmada = await seletorCategoria.count() === 1 && await seletorCategoria.evaluate((select, { formulario, valor }) =>
      select.tagName === 'SELECT' && select.name === 'category_id' &&
      select.closest('form') === formulario && select.value === valor &&
      select.selectedOptions.length === 1 &&
      select.selectedOptions[0].textContent.trim().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'geral' &&
      new FormData(formulario).getAll('category_id').length === 1 &&
      new FormData(formulario).get('category_id') === valor,
    { formulario:formularioReal, valor:categoriaCorrigida.valor });
    if (!confirmada) {
      const motivo = 'Categoria Geral deixou de corresponder ao valor category_id do formulário antes do envio; revisão manual necessária.';
      console.warn(`[AUTOXS][CATEGORIA] ${motivo}`);
      informarPendencia(motivo);
      return false;
    }
  }
  // Altera somente imagens de identificação inequívocas no corpo, após a
  // conferência independente de chapéu e imagem destacada.
  let limpeza;
  try {
    limpeza = await prepararImagensAgenciaBrasil(aba);
  } catch (erro) {
    const motivo = `Agência Brasil: não foi possível conferir o corpo; revisão manual necessária. ${erro.message}`;
    console.warn(`[AUTOXS] ${motivo}`);
    informarPendencia(motivo);
    return false;
  }
  if (!limpeza.ok) {
    const motivo = `Agência Brasil: ${limpeza.aviso}`;
    console.warn(`[AUTOXS] ${motivo}`);
    informarPendencia(motivo);
    return false;
  }
  if (limpeza.removidas) logosRemovidos.add(aba);
  const conferirLogoNaRequisicao = Boolean(limpeza.removidas || logosRemovidos.has(aba));
  if (limpeza.removidas) console.log(`[AGÊNCIA BRASIL] ${limpeza.removidas} logotipo(s) removido(s); editor e formulário conferidos.`);
  const corpoEsperado = conferirLogoNaRequisicao ? await aba.locator('#inp_text, textarea[name="text"]').inputValue() : null;
  if (conferirLogoNaRequisicao) {
    const conferenciaCorpo = await aba.evaluate(analisarImagensAgenciaBrasil, corpoEsperado);
    if (conferenciaCorpo.removidas || conferenciaCorpo.ambiguas.length) {
      const motivo = 'Agência Brasil: logotipo voltou ao campo enviado; revisão manual necessária.';
      informarPendencia(motivo);
      console.warn(`[AUTOXS] ${motivo}`);
      return false;
    }
  }
  const urlInicial = aba.url();
  const action = await formulario.evaluate(form => form.action);
  const mensagensAntes = await aba.locator('.alert-success, .toast-success, [role="status"]').allTextContents();
  let motivoRequisicao = '';
  let avisarBloqueio;
  const bloqueio = new Promise(resolve => { avisarBloqueio = resolve; });
  const conferirRequisicao = async rota => {
    const requisicao = rota.request();
    const destino = new URL(requisicao.url());
    if (!['POST', 'PUT', 'PATCH'].includes(requisicao.method()) ||
        destino.origin !== new URL(urlInicial).origin ||
        ![new URL(action).pathname, new URL(urlInicial).pathname].includes(destino.pathname)) {
      await rota.fallback();
      return;
    }
    try {
      const html = extrairHtmlRequisicao(requisicao);
      // O corpo esperado já foi analisado no editor/formulário. Conferir os
      // bytes da requisição evita consultar a Page durante uma navegação POST.
      const htmlCorreto = !conferirLogoNaRequisicao || (html !== null && html === corpoEsperado);
      const categoriaCorreta = !categoriaCorrigida || extrairCategoriaRequisicao(requisicao) === categoriaCorrigida.valor;
      if (htmlCorreto && categoriaCorreta) {
        if (conferirLogoNaRequisicao) console.log('[AGÊNCIA BRASIL] Requisição conferida: HTML do corpo sem o logotipo.');
        if (categoriaCorrigida) console.log('[AUTOXS][CATEGORIA] Requisição conferida: category_id corresponde a Geral.');
        await rota.fallback();
        return;
      }
      motivoRequisicao = !htmlCorreto
        ? 'Agência Brasil: logotipo ou HTML do corpo não verificável na requisição; revisão manual necessária.'
        : 'Categoria Geral não confirmada no campo category_id da requisição; revisão manual necessária.';
    } catch {
      motivoRequisicao = categoriaCorrigida && !conferirLogoNaRequisicao
        ? 'Categoria Geral: falha ao verificar category_id na requisição; revisão manual necessária.'
        : 'Agência Brasil: falha ao verificar o HTML da requisição; revisão manual necessária.';
    }
    await rota.abort('blockedbyclient');
    avisarBloqueio(null);
  };
  if (conferirLogoNaRequisicao || categoriaCorrigida) await aba.route('**/*', conferirRequisicao);
  const respostaPendente = aba.waitForResponse(resposta => {
    const requisicao = resposta.request();
    const destino = new URL(resposta.url());
    return ['POST', 'PUT', 'PATCH'].includes(requisicao.method()) &&
      destino.origin === new URL(urlInicial).origin &&
      [new URL(action).pathname, new URL(urlInicial).pathname].includes(destino.pathname);
  }, { timeout: 15000 }).catch(() => null);
  let resposta;
  try {
    await enviar.click();
    resposta = conferirLogoNaRequisicao || categoriaCorrigida ? await Promise.race([respostaPendente, bloqueio]) : await respostaPendente;
  } finally {
    if (conferirLogoNaRequisicao || categoriaCorrigida) await aba.unroute('**/*', conferirRequisicao);
  }
  if (motivoRequisicao) {
    console.warn(`[AUTOXS] ${motivoRequisicao}`);
    informarPendencia(motivoRequisicao);
    return false;
  }
  if (!resposta || resposta.status() < 200 || resposta.status() >= 400) return false;
  // Um clique ou resposta HTTP isolada não confirma que a matéria foi salva.
  return confirmarSalvamento(aba, mensagensAntes);
}

async function processarLote(materias, operacoes) {
  const abertas = [];
  const geracoesPendentes = [];
  const problemasRegistrados = new Map();
  const resumo = { abertas: 0, enviadas: 0, pendentes: 0, erros: 0 };
  const tituloCurto = materia => {
    const texto = String(materia.titulo || 'Sem título').replace(/\s+/g, ' ').trim();
    return texto.length > 70 ? `${texto.slice(0, 67)}...` : texto;
  };
  const problema = async (materia, codigo, descricao, situacao = 'Revisão necessária', indice = materias.indexOf(materia)) => {
    if (!problemasRegistrados.has(materia.url)) problemasRegistrados.set(materia.url, new Set());
    problemasRegistrados.get(materia.url).add(codigo);
    await operacoes.registrarProblema?.({ materia, numero:materia.numeroExecucao || indice + 1,
      codigo, descricao, situacao });
  };
  const corrigido = async (materia, codigo) => {
    const registrados = problemasRegistrados.get(materia.url);
    if (!registrados?.size || (codigo && !registrados.has(codigo))) return;
    await operacoes.registrarProblema?.({ materia, codigo, situacao:'Corrigido' });
  };
  const interrompido = () => {
    if (operacoes.ativo?.() !== false) return false;
    if (!resumo.interrompido) void operacoes.log('\nNavegador fechado. Conferência interrompida.');
    resumo.interrompido = true;
    return true;
  };
  async function acompanharPendente(aba, materia) {
    if (!operacoes.acompanhar || aba.isClosed?.() || interrompido()) return;
    try { await operacoes.acompanhar(aba, materia); }
    catch (erro) {
      await operacoes.log('  Fechamento automático indisponível nesta aba. Você pode enviá-la e fechá-la manualmente.');
      await problema(materia, 'acompanhar-envio', `Não foi possível acompanhar o envio manual: ${erro.message || 'erro não identificado'}.`, 'Erro técnico');
    }
  }
  async function retomarGeracoesProntas() {
    for (const tarefa of geracoesPendentes) {
      if (!tarefa.concluida || tarefa.retomada) continue;
      if (interrompido()) return;
      tarefa.retomada = true;
      const { materia, aba } = tarefa;
      let etapa = 'concluir a foto e a legenda';
      await operacoes.log(`\nMatéria ${tarefa.indice + 1}/${abertas.length} — retomando ${tituloCurto(materia)}`);
      try {
        if (tarefa.erro) throw tarefa.erro;
        if (tarefa.gerada !== true) {
          await operacoes.log('  Geração não confirmada. Aba mantida para conferência manual.');
          continue;
        }
        // Uma aba fechada ou navegada manualmente não deve levar ao envio de outra matéria.
        if (aba.isClosed?.() || (tarefa.url && aba.url() !== tarefa.url)) {
          throw new Error('A aba da matéria não está mais disponível.');
        }
        if (operacoes.preparar) await operacoes.preparar(aba);
        if (operacoes.limparLogo) {
          const logo = await operacoes.limparLogo(aba);
          if (!logo.ok) {
            await operacoes.log('Agência Brasil: ' + logo.aviso);
            await problema(materia, 'agencia-brasil', 'Agência Brasil: ' + logo.aviso, 'Revisão necessária', tarefa.indice);
            continue;
          }
          await corrigido(materia, 'agencia-brasil');
        }
        etapa = 'conferir novamente chapéu e foto';
        const estado = await operacoes.ler(aba);
        if (estado.temChapeu === true) await corrigido(materia, 'chapeu');
        if (estado.conferenciaCategoria?.revisar) {
          await operacoes.log('  ' + estado.conferenciaCategoria.mensagem);
          await problema(materia, 'categoria', estado.conferenciaCategoria.mensagem, 'Revisão necessária', tarefa.indice);
          continue;
        }
        await corrigido(materia, 'categoria');
        if (estado.temChapeu !== true || estado.temImagem !== true) {
          await operacoes.log(estado.temChapeu !== true ? '  Falta chapéu. Aba mantida para preenchimento manual.' : '  Foto não confirmada. Confira a aba manualmente.');
          if (estado.temChapeu !== true) await problema(materia, 'chapeu', 'Chapéu não confirmado; preencha e revise a matéria.', 'Revisão necessária', tarefa.indice);
          continue;
        }
        if (interrompido()) return;
        etapa = 'enviar a matéria após a geração';
        if (!await operacoes.enviar(aba)) {
          const motivo = operacoes.motivoPendencia?.(aba) || 'Envio não confirmado. Confira a matéria na aba aberta.';
          await operacoes.log('  ' + motivo);
          await problema(materia, 'envio', motivo, 'Revisão necessária', tarefa.indice);
          continue;
        }
        resumo.enviadas++;
        resumo.pendentes--;
        await corrigido(materia);
        // Um erro ao fechar a aba não transforma um envio confirmado em pendência.
        try { await aba.close(); }
        catch {
          resumo.erros++;
          await operacoes.log('  Matéria enviada. Não foi possível fechar a aba.');
          await problema(materia, 'fechar-aba', 'Matéria enviada, mas não foi possível fechar a aba.', 'Erro técnico', tarefa.indice);
          continue;
        }
        await operacoes.log('  Foto e legenda conferidas. Matéria enviada. Aba fechada.');
      } catch (erro) {
        if (interrompido()) return;
        resumo.erros++;
        await operacoes.log(`  Não foi possível ${etapa}. Aba mantida para conferência manual.`);
        await problema(materia, `erro-${etapa}`, `Não foi possível ${etapa}: ${erro.message || 'erro não identificado'}.`, 'Erro técnico', tarefa.indice);
      } finally {
        await acompanharPendente(aba, materia);
      }
    }
  }
  // O controlador entrega grupos de até três matérias. Dentro do grupo,
  // as abas são abertas antes da verificação editorial já existente.
  for (const [indice, materia] of materias.entries()) {
    if (interrompido()) break;
    if (ehMateriaLimite(materia.titulo)) break;
    try {
      const aba = await operacoes.abrir(materia);
      abertas.push({ materia, aba });
      resumo.abertas++;
    } catch (erro) {
      if (interrompido()) break;
      resumo.erros++;
      await operacoes.log(`Não foi possível abrir: ${tituloCurto(materia)}.`);
      await problema(materia, 'abrir', `Não foi possível abrir a matéria: ${erro.message || 'erro não identificado'}.`, 'Erro técnico', indice);
    }
  }
  for (const [indice, { materia, aba }] of abertas.entries()) {
    if (interrompido()) break;
    operacoes.registrarProcessada?.(materia);
    // Retoma apenas entre matérias, sem disputar o foco com a conferência atual.
    await retomarGeracoesProntas();
    if (interrompido()) break;
    await operacoes.log(`\nMatéria ${indice + 1}/${abertas.length} — ${tituloCurto(materia)}`);
    let etapa = 'conferir chapéu e foto';
    try {
      if (operacoes.preparar) await operacoes.preparar(aba);
      if (operacoes.limparLogo) {
        const logo = await operacoes.limparLogo(aba);
        if (!logo.ok) {
          resumo.pendentes++;
          await operacoes.log('Agência Brasil: ' + logo.aviso);
          await problema(materia, 'agencia-brasil', 'Agência Brasil: ' + logo.aviso, 'Revisão necessária', indice);
          continue;
        }
        await corrigido(materia, 'agencia-brasil');
      }
      const estado = await operacoes.ler(aba);
      if (estado.temChapeu === true) await corrigido(materia, 'chapeu');
      if (!estado.conferenciaCategoria?.revisar) await corrigido(materia, 'categoria');
      await operacoes.log(estado.temChapeu ? '  Chapéu conferido.' : '  Falta chapéu. Preencha manualmente.');
      await operacoes.log(estado.temImagem === true ? '  Foto conferida.' : estado.temImagem === false
        ? '  Falta foto.' : '  Não foi possível confirmar a foto.');
      if (estado.conferenciaCategoria?.mensagem) await operacoes.log('  ' + estado.conferenciaCategoria.mensagem);
      if (estado.temChapeu !== true) await problema(materia, 'chapeu', 'Chapéu não confirmado; preencha e revise a matéria.', 'Revisão necessária', indice);
      if (estado.conferenciaCategoria?.revisar) await problema(materia, 'categoria', estado.conferenciaCategoria.mensagem || 'Categoria exige revisão editorial.', 'Revisão necessária', indice);
      if (estado.temChapeu === true && estado.temImagem === true && !estado.conferenciaCategoria?.revisar) {
        etapa = 'enviar a matéria';
        if (await operacoes.enviar(aba)) {
          resumo.enviadas++;
          await corrigido(materia);
          etapa = 'fechar a aba';
          await aba.close();
          await operacoes.log('  Matéria enviada. Aba fechada.');
          continue;
        }
        const motivo = operacoes.motivoPendencia?.(aba) || 'Envio não confirmado. Confira a matéria na aba aberta.';
        await operacoes.log('  ' + motivo);
        await problema(materia, 'envio', motivo, 'Revisão necessária', indice);
      } else {
        if (estado.temImagem === false) {
          if (podeGerarImagemRJ(estado.categoria, estado.temImagem)) {
            etapa = 'gerar a foto com Nano Banana';
            await operacoes.log('  Categoria: RJ em Foco.');
            const tarefa = { materia, aba, indice, url:aba.url?.(), concluida:false, retomada:false };
            // A promessa só termina depois da imagem e do salvamento da legenda.
            // Captura a rejeição desde o início, mesmo enquanto outras abas são lidas.
            tarefa.promessa = Promise.resolve().then(() => operacoes.gerarImagem(aba,
              mensagem => operacoes.log(`  IA — ${tituloCurto(materia)}: ${String(mensagem).trim()}`)))
              .then(gerada => { tarefa.gerada = gerada; }, erro => { tarefa.erro = erro; })
              .finally(() => { tarefa.concluida = true; });
            geracoesPendentes.push(tarefa);
            resumo.pendentes++;
            await operacoes.log('  Foto e legenda em andamento. Continuando nas próximas matérias…');
            continue;
          } else {
            etapa = 'abrir a pesquisa de foto';
            const termo = await operacoes.pesquisar(aba, materia.titulo);
            await operacoes.log(termo ? `  Pesquisando foto: ${termo}.` : '  Pesquisa de foto aberta. Digite um termo.');
          }
        }
        await operacoes.log('  Aba aberta para preenchimento manual.');
      }
      resumo.pendentes++;
    } catch (erro) {
      if (interrompido()) break;
      resumo.erros++;
      resumo.pendentes++;
      await operacoes.log(`  Não foi possível ${etapa}. Confira a aba manualmente.`);
      await problema(materia, `erro-${etapa}`, `Não foi possível ${etapa}: ${erro.message || 'erro não identificado'}.`, 'Erro técnico', indice);
    } finally {
      // A geração ainda controla esta aba; acompanha o envio manual após retomá-la.
      if (!geracoesPendentes.some(tarefa => tarefa.aba === aba && !tarefa.retomada)) {
        await acompanharPendente(aba, materia);
      }
    }
  }
  // A rodada só termina quando todas as gerações forem retomadas ou houver interrupção.
  // Promise.race permite enviar as que terminarem primeiro, sem esperar a mais lenta.
  while (geracoesPendentes.some(tarefa => !tarefa.retomada) && !interrompido()) {
    await retomarGeracoesProntas();
    const aguardando = geracoesPendentes.filter(tarefa => !tarefa.retomada);
    if (!aguardando.length || interrompido()) break;
    await operacoes.log(`Aguardando foto e legenda de ${aguardando.length} matéria(s)…`);
    await Promise.race(aguardando.map(tarefa => tarefa.promessa));
  }
  return resumo;
}
// Dispara a navegação e mantém a listagem em primeiro plano, como Ctrl+clique.
// O carregamento de uma matéria nunca bloqueia a abertura da próxima aba.
async function abrirMateriaEmSegundoPlano(context, listagem, materia, carregamentos, trazerParaFrente = true) {
  const aba = await context.newPage();
  const carregamento = aba.goto(materia.url, { waitUntil: 'domcontentloaded' })
    .then(() => ({ erro: null }), erro => ({ erro }));
  // Captura falhas imediatamente, inclusive enquanto outras abas estão abrindo.
  carregamentos.set(aba, carregamento);
  if (trazerParaFrente) await listagem.bringToFront();
  return aba;
}

async function obterOuAbrirMateria(context, listagem, materia, carregamentos, trazerParaFrente = true) {
  const existente = context.pages().find(aba => aba !== listagem && !aba.isClosed() && aba.url() === materia.url);
  if (existente) {
    if (!carregamentos.has(existente)) carregamentos.set(existente, Promise.resolve({ erro: null }));
    return existente;
  }
  return abrirMateriaEmSegundoPlano(context, listagem, materia, carregamentos, trazerParaFrente);
}
async function prepararAbaMateria(aba, carregamentos, trazerParaFrente = true) {
  if (trazerParaFrente) await aba.bringToFront();
  const carregamento = carregamentos.get(aba);
  if (!carregamento) throw new Error('Carregamento da matéria não identificado.');
  const { erro } = await carregamento;
  if (erro) throw erro;
  if (new URL(aba.url()).pathname.includes('/login')) throw new Error('Sessão expirada.');
  try {
    await localizarCampoChapeu(aba).waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    // Diagnóstico sem valores dos campos, texto da matéria ou credenciais.
    const campos = await aba.locator('input:visible, textarea:visible').evaluateAll(elementos =>
      elementos.map(el => ({ id: el.id, name: el.name, tipo: el.type }))
    ).catch(() => []);
    throw new Error(`Campo Chapéu não identificado em ${aba.url()}. Campos disponíveis: ${JSON.stringify(campos)}`);
  }
}

function acompanharFerramentasEditorais(context) {
  const paginasObservadas = new WeakSet();
  const instalacoes = new WeakMap();
  const ehFormularioMateria = pagina => {
    try {
      const url = new URL(pagina.url());
      return url.origin === new URL(URL_NEWS).origin && /^\/news\/(?:add|edit\/[^/]+)\/?$/.test(url.pathname);
    } catch { return false; }
  };
  function instalar(pagina) {
    if (pagina.isClosed() || !ehFormularioMateria(pagina)) return Promise.resolve();
    if (instalacoes.has(pagina)) return instalacoes.get(pagina);
    const tarefa = (async () => {
      await pagina.locator('#inp_title, input[name="title"]').first().waitFor({ state: 'attached', timeout: 10000 });
      if (!ehFormularioMateria(pagina)) return;
      const ferramentas = [
        ['legendas', () => instalarBotaoLegenda(pagina)],
        ['fotos', () => acompanharFotosAdicao(pagina, () => abrirPesquisaImagem(pagina, '', { iniciarPesquisa: true }))],
        ['chapéu', () => instalarSugestoesChapeuCMS(pagina)],
        ['proteção de envio', () => instalarProtecaoEnvioCMS(pagina)]
      ];
      for (const [nome, preparar] of ferramentas) {
        try { await preparar(); }
        catch (erro) { console.warn(`[AUTOXS] Ferramenta ${nome}:`, erro.message); }
      }
    })().catch(erro => {
      if (!pagina.isClosed()) console.warn('[AUTOXS] Ferramentas editoriais:', erro.message);
    }).finally(() => instalacoes.delete(pagina));
    instalacoes.set(pagina, tarefa);
    return tarefa;
  }
  function observar(pagina) {
    if (paginasObservadas.has(pagina)) return;
    paginasObservadas.add(pagina);
    pagina.on('domcontentloaded', () => { void instalar(pagina); });
    pagina.on('framenavigated', frame => { if (frame === pagina.mainFrame()) void instalar(pagina); });
    void instalar(pagina);
  }
  context.on('page', observar);
  context.pages().forEach(observar);
  return instalar;
}

async function executar() {
  // Os caminhos são relativos a este arquivo, mesmo quando iniciado de outra pasta.
  require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
  const { chromium } = require('playwright');
  const EMAIL = process.env.TRIBUNA_EMAIL;
  const SENHA = process.env.TRIBUNA_SENHA;
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'perfil-playwright'), {
    headless: false, viewport: null
  });
  const instalarFerramentasEditorais = acompanharFerramentasEditorais(context);
  const sessaoDiscreta = criarSessaoAtualizacaoDiscreta(chromium, path.join(__dirname, 'perfil-atualizacao-discreta'));
  const instaladoresDiscretos = new WeakMap();
  const motivosEnvio = new WeakMap();
  let encerramentoAutoXS = null;
  let encerrarBuscas = async () => {};
  const encerrarAutoXS = () => {
    if (encerramentoAutoXS) return encerramentoAutoXS;
    encerramentoAutoXS = (async () => {
      await encerrarBuscas();
      await sessaoDiscreta.encerrar();
      await context.close().catch(() => {});
    })();
    return encerramentoAutoXS;
  };
  process.once('SIGINT', () => { void encerrarAutoXS(); });
  process.once('SIGTERM', () => { void encerrarAutoXS(); });
  context.on('close', () => {
    void encerrarBuscas();
    void sessaoDiscreta.encerrar();
  });
  // Preserva eventuais abas de matérias abertas em uma execução anterior.
  const janelaAtualizacao = criarGrupoJanelas(context);
  const janelaAdicao = criarGrupoJanelas(context);
  let page = null;
  console.log(`FLUXO MANUAL — percorrer a fila até: ${TITULO_LIMITE}.`);
  async function garantirLogin(
    pagina
  ) {

    const campoEmail =
      pagina.getByRole(
        'textbox',
        {
          name:
            'Endereço de E-mail'
        }
      );

    const precisaLogin =
      pagina.url().includes('/login') ||
      await campoEmail.count() > 0;

    if (!precisaLogin) {
      return true;
    }

    console.log('');
    console.log(
      '🔐 Login necessário.'
    );

    if (!EMAIL || !SENHA) {

      console.log(
        '❌ E-mail ou senha não encontrados no .env'
      );

      return false;
    }

    await campoEmail.waitFor({
      state: 'visible',
      timeout: 15000
    });

    await campoEmail.fill(
      EMAIL
    );

    const campoSenha =
      pagina.getByRole(
        'textbox',
        {
          name: 'Senha'
        }
      );

    await campoSenha.fill(
      SENHA
    );

    await pagina
      .getByRole(
        'button',
        {
          name: 'Enviar'
        }
      )
      .click();

    try {

      await pagina.waitForURL(
        url =>
          !String(url)
            .includes('/login'),
        {
          timeout: 20000
        }
      );

    } catch {}

    await pagina.waitForTimeout(
      2000
    );

    if (
      pagina.url()
        .includes('/login')
    ) {

      console.log(
        '❌ Login não concluído.'
      );

      return false;
    }

    console.log(
      '✅ Login realizado.'
    );

    return true;
  }
  async function abrirListagem(page) {

    console.log('');
    console.log(
      'Abrindo listagem...'
    );

    await page.goto(
      URL_NEWS,
      {
        waitUntil:
          'domcontentloaded'
      }
    );

    await page.waitForTimeout(
      1500
    );

    if (
      !(await garantirLogin(page))
    ) {
      return false;
    }

    if (
      !page.url()
        .includes('/news')
    ) {

      await page.goto(
        URL_NEWS,
        {
          waitUntil:
            'domcontentloaded'
        }
      );

      await page.waitForTimeout(
        1500
      );
    }

    const filtro =
      page.locator(
        '#filterExtra'
      );

    if (
      await filtro.count() === 0
    ) {

      console.log(
        '❌ Filtro não encontrado.'
      );

      return false;
    }

    console.log(
      '✅ Listagem encontrada.'
    );

    return true;
  }
  async function aplicarFiltro(page) {

    const filtro =
      page.locator(
        '#filterExtra'
      );

    if (
      await filtro.count() === 0
    ) {
      return false;
    }

    const opcoes =
      await filtro
        .locator('option')
        .evaluateAll(
          options =>
            options.map(
              option => ({
                texto:
                  (
                    option.textContent ||
                    ''
                  ).trim(),

                valor:
                  option.value
              })
            )
        );

    const opcao =
      opcoes.find(
        item =>
          normalizar(
            item.texto
          ) ===
          'com integracao (sem edicao)'
      );

    if (!opcao) {

      console.log(
        '❌ Opção do filtro não encontrada.'
      );

      return false;
    }

    await filtro.selectOption({
      value:
        opcao.valor
    });

    let botao =
      page.getByRole(
        'button',
        {
          name: /Filtrar/i
        }
      );

    if (
      await botao.count() === 0
    ) {

      botao =
        page.locator(
          'button:has-text("Filtrar"), ' +
          'input[type="submit"][value*="Filtrar"]'
        );
    }

    console.log('');
    console.log(
      '🔄 Aplicando filtro...'
    );

    await botao
      .first()
      .click();

    try {

      await page.waitForLoadState(
        'networkidle',
        {
          timeout: 15000
        }
      );

    } catch {}

    await page.waitForTimeout(
      5000
    );

    console.log(
      '✅ Fila atualizada.'
    );

    return true;
  }
  const carregamentos = new WeakMap();
  const enviadas = new Set();
  const acompanhamentos = new WeakMap();
  const materiasPorAba = new WeakMap();
  const historico = criarHistoricoProducao();
  await historico.limparExpirados();
  const limpezaHistorico = setInterval(() => {
    void historico.limparExpirados()
      .catch(erro => console.warn('[AUTOXS] Limpeza do histórico: ' + erro.message));
  }, 60 * 60 * 1000);
  limpezaHistorico.unref?.();
  const compartilhamento = criarCompartilhamento(context, criarGrupoJanelas(context));
  const limiteConfigurado = Number(process.env.AUTOXS_LIMITE_PAGINAS_LINKS);
  const buscadorLinks = criarBuscadorLinks(historico, compartilhamento, {
    limitePaginas:Number.isInteger(limiteConfigurado) && limiteConfigurado > 0 ? limiteConfigurado : 10
  });
  encerrarBuscas = async () => {
    buscadorLinks.cancelarTodas();
    await compartilhamento.fecharConsultas();
  };
  async function registrarAtualizacao(materia, situacao, formaConclusao = null) {
    if (!materia?.url) return;
    try {
      await historico.registrar({ operacao:'atualizar', chave:materia.url, urlCms:materia.url,
        titulo:materia.titulo || '', situacao, formaConclusao });
    } catch (erro) { console.warn('[AUTOXS] Histórico: ' + erro.message); }
  }
  async function registrarAdicao(evento) {
    const situacao = evento.tipo === 'concluido' ? 'concluido' : evento.tipo === 'naoConfirmado' ? 'naoConfirmado' : 'aguardandoRevisao';
    const registro = await historico.registrar({ operacao:'adicionar', chave:evento.id, titulo:evento.campos.titulo,
      chapeu:evento.campos.chapeu, subtitulo:evento.campos.bigode, urlOriginal:evento.urlOriginal || '',
      urlCms:evento.urlCms || '',
      situacao, formaConclusao: situacao === 'concluido' ? 'manual' : null });
    if (situacao === 'concluido' && !registro.urlOriginal) {
      void buscadorLinks.agendarAposPublicacao(registro.id)
        .catch(erro => console.warn('[AUTOXS] Busca de link público: ' + erro.message));
    }
    return registro;
  }
  // As abas pendentes continuam editáveis entre cliques no painel.
  await criarPainelManual(context, async (progresso, paginaEscolhida, modo = 'visivel', registrarProblema = async () => {}) => {
    if (paginaEscolhida !== 1 && paginaEscolhida !== 2) throw new Error('Escolha Página 1 ou Página 2 antes de atualizar.');
    const discreto = modo === 'discreto';
    const trazerParaFrente = modo === 'visivel';
    let contextoTrabalho = context;
    let paginaTrabalho;
    if (discreto) {
      contextoTrabalho = await sessaoDiscreta.obterContexto();
      if (!instaladoresDiscretos.has(contextoTrabalho)) {
        instaladoresDiscretos.set(contextoTrabalho, acompanharFerramentasEditorais(contextoTrabalho));
      }
      paginaTrabalho = await sessaoDiscreta.obterListagem();
    } else {
      if (!page || page.isClosed()) page = await janelaAtualizacao.newPage();
      paginaTrabalho = page;
    }
    const grupoTrabalho = trazerParaFrente ? janelaAtualizacao : contextoTrabalho;
    await progresso('Atualizando a fila…');
    if (!await abrirListagem(paginaTrabalho) || !await aplicarFiltro(paginaTrabalho)) {
      throw new Error(discreto
        ? 'Não foi possível acessar a fila no modo discreto. Confira a janela do Chrome pela barra de tarefas, inclusive o login do CMS.'
        : 'Não foi possível preparar a fila.');
    }
    // Página 1 ou 2 é somente o início escolhido pela equipe, não o fim da busca.
    await selecionarPaginaListagem(paginaTrabalho, 1);
    await aguardarTabelaListagem(paginaTrabalho);
    if (paginaEscolhida === 2) {
      const estadoPrimeira = {};
      await coletarMaterias(paginaTrabalho, estadoPrimeira);
      if (estadoPrimeira.limiteEncontrado) {
        await progresso('A matéria do jogo do Brasil já está na página 1. A página 2 fica abaixo do limite.');
        return { abertas:0, enviadas:0, pendentes:0, erros:0, processadas:0,
          registros:estadoPrimeira.registros, elegiveis:0, ignoradas:0, paginas:1,
          ultimaMateria:estadoPrimeira.ultimaMateria, limiteEncontrado:true };
      }
      await progresso('Selecionando a página 2…');
      await selecionarPaginaListagem(paginaTrabalho, 2);
    }
    const busca = await percorrerFilaAteReferencia({ paginaInicial:paginaEscolhida,
      ativo:() => !paginaTrabalho.isClosed() && contextoTrabalho.pages().length > 0,
      progresso:async mensagem => { console.log(mensagem); await progresso(mensagem); },
      lerPagina:async () => {
        await aguardarTabelaListagem(paginaTrabalho);
        const estado = {};
        const materias = await coletarMaterias(paginaTrabalho, estado);
        return { materias, estado };
      },
      avancar:numero => avancarPaginaListagem(paginaTrabalho, numero)
    });
    const materias = busca.materias.filter(materia => {
      if (!enviadas.has(materia.url)) return true;
      console.log(`[FILTROS] ${materia.titulo}: matéria já enviada nesta sessão.`);
      busca.ignoradas++;
      return false;
    });
    await progresso(`[FILTROS] ${materias.length} matérias elegíveis para esta rodada; ${busca.ignoradas + busca.duplicadas} ignoradas.`);
    const aguardarVagas = () => aguardarVagasAtualizacao({
      ativo:() => !paginaTrabalho.isClosed() && contextoTrabalho.pages().length > 0,
      progresso,
      listarAbertas:() => grupoTrabalho.pages().filter(aba => aba !== paginaTrabalho &&
        !aba.isClosed() && /^\/news\/(?:edit\/\d+|\d+\/edit)\/?$/.test(new URL(aba.url()).pathname)).length
    });
    const resumo = await processarFilaEmGrupos(materias, {
      abrir: async materia => {
        try {
          const aba = await obterOuAbrirMateria(grupoTrabalho, paginaTrabalho, materia, carregamentos, trazerParaFrente);
          materiasPorAba.set(aba, materia);
          await registrarAtualizacao(materia, 'aguardandoRevisao');
          return aba;
        } catch (erro) { await registrarAtualizacao(materia, 'erro'); throw erro; }
      },
      preparar: async aba => {
        try {
          // Ao conferir novamente uma pendência, devolve o controle ao lote.
          acompanhamentos.get(aba)?.();
          acompanhamentos.delete(aba);
          await prepararAbaMateria(aba, carregamentos, trazerParaFrente);
          if (discreto) await instaladoresDiscretos.get(contextoTrabalho)(aba);
          else await instalarFerramentasEditorais(aba);
        } catch (erro) { await registrarAtualizacao(materiasPorAba.get(aba), 'erro'); throw erro; }
      },
      limparLogo: async aba => {
        try {
          const resultado = await prepararImagensAgenciaBrasil(aba);
          if (resultado.ok && resultado.removidas) {
            logosRemovidos.add(aba);
            console.log(`[AGÊNCIA BRASIL] ${resultado.removidas} logotipo(s) identificado(s) e removido(s); HTML do formulário verificado.`);
          }
          return resultado;
        } catch (erro) {
          return { ok:false, aviso:`Não foi possível conferir o HTML do corpo (${erro.message}); revisão manual necessária.` };
        }
      },
      acompanhar: async (aba, materia) => {
        if (acompanhamentos.has(aba) || enviadas.has(materia.url)) return;
        const formulario = localizarCampoChapeu(aba).locator('xpath=ancestor::form[1]');
        const parar = await acompanharEnvioManual(aba, formulario, async () => {
          await registrarAtualizacao(materia, 'concluido', 'manual');
          enviadas.add(materia.url);
          acompanhamentos.delete(aba);
        });
        if (parar) acompanhamentos.set(aba, parar);
      },
      ler: async aba => {
        try { return await lerPendencias(aba); }
        catch (erro) { await registrarAtualizacao(materiasPorAba.get(aba), 'erro'); throw erro; }
      },
      enviar: async aba => {
        const url = aba.url();
        let confirmado;
        motivosEnvio.delete(aba);
        try { confirmado = await enviarMateria(aba, trazerParaFrente, motivo => motivosEnvio.set(aba, motivo)); }
        catch (erro) { await registrarAtualizacao(materiasPorAba.get(aba), 'erro'); throw erro; }
        await registrarAtualizacao(materiasPorAba.get(aba), confirmado ? 'concluido' : 'naoConfirmado', confirmado ? 'automatico' : null);
        if (confirmado) enviadas.add(url);
        return confirmado;
      },
      motivoPendencia: aba => motivosEnvio.get(aba),
      registrarProblema,
      pesquisar: abrirPesquisaImagem,
      gerarImagem: (aba, log = progresso) => gerarImagemRJ(aba, verificarImagemDestaque, log),
      ativo: () => !paginaTrabalho.isClosed() && contextoTrabalho.pages().length > 0,
      log: async mensagem => { console.log(mensagem); await progresso(mensagem); }
    }, aguardarVagas, progresso);
    Object.assign(resumo, { registros:busca.registros, elegiveis:materias.length,
      ignoradas:busca.ignoradas + busca.duplicadas, paginas:busca.paginas,
      ultimaMateria:busca.ultimaMateria, limiteEncontrado:busca.limiteEncontrado,
      erroBusca:busca.erroBusca, interrompido:resumo.interrompido || busca.interrompido });
    console.log(`\nConferência ${busca.limiteEncontrado ? 'até a referência' : 'parcial'}: ${resumo.processadas} processadas; ${resumo.enviadas} enviadas; ${resumo.pendentes} para conferir manualmente; ${resumo.ignoradas} ignoradas.`);
    return resumo;
  }, criarEnvioAoSite(context, garantirLogin, async () => {}, () => janelaAdicao.newPage(), registrarAdicao),
  janelaAdicao, historico, compartilhamento, buscadorLinks);
  console.log('Clique em Atualizar no painel para iniciar uma rodada.');
}

if (require.main === module) {
  executar().catch(erro => {
    console.error('Não foi possível continuar. Confira se o navegador está aberto e se o sistema está acessível.');
    process.exitCode = 1;
  });
}

module.exports = { verificarImagemDestaque, obterOuAbrirMateria, localizarCampoChapeu, abrirMateriaEmSegundoPlano, prepararAbaMateria, converterData, coletarMaterias, percorrerFilaAteReferencia, processarFilaEmGrupos, aguardarVagasAtualizacao, processarLote, lerPendencias, enviarMateria, abrirPesquisaImagem };
  function normalizar(texto) {

    return String(texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(
        /[\u0300-\u036f]/g,
        ''
      )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();
  }
  async function verificarImagemDestaque(
    aba
  ) {

    const botoesMais =
      aba.getByRole(
        'button',
        {
          name: '+',
          exact: true
        }
      );

    const quantidadeBotoes =
      await botoesMais.count();

    if (
      quantidadeBotoes < 2
    ) {

      return {
        temImagem: null,
        quantidade: 0
      };
    }

    const botaoImagem =
      botoesMais.nth(0);

    const botaoGaleria =
      botoesMais.nth(1);

    try {

      await botaoImagem
        .scrollIntoViewIfNeeded();

      await aba.waitForTimeout(
        300
      );

      const boxImagem =
        await botaoImagem
          .boundingBox();

      const boxGaleria =
        await botaoGaleria
          .boundingBox();

      if (
        !boxImagem ||
        !boxGaleria
      ) {

        return {
          temImagem: null,
          quantidade: 0
        };
      }

      if (boxGaleria.y <= boxImagem.y) return { temImagem: null, quantidade: 0 };

      const inicioY =
        boxImagem.y;

      const fimY =
        boxGaleria.y;

      const imagens =
        aba.locator('img');

      const totalImagens =
        await imagens.count();

      let imagensDestaque = 0;

      for (
        let i = 0;
        i < totalImagens;
        i++
      ) {

        const imagem =
          imagens.nth(i);

        try {

          if (
            !(await imagem.isVisible())
          ) {
            continue;
          }

          const box =
            await imagem
              .boundingBox();

          if (!box) {
            continue;
          }

          const dentroDaArea =
            box.y > inicioY &&
            box.y < fimY;

          const tamanhoReal =
            box.width >= 80 &&
            box.height >= 50;

          if (
            dentroDaArea &&
            tamanhoReal
          ) {

            const carregamento = await imagem.evaluate(img => ({
              completa: img.complete,
              largura: img.naturalWidth,
              src: img.currentSrc || img.src || ''
            }));
            if (!carregamento.completa || carregamento.largura === 0) {
              return { temImagem: null, quantidade: 0 };
            }
            if (/(?:placeholder|no[-_]?image|sem[-_]?imagem|default[-_]?image)/i.test(carregamento.src)) continue;
            imagensDestaque++;
          }

        } catch {}
      }

      return {

        temImagem:
          imagensDestaque > 0,

        quantidade:
          imagensDestaque
      };

    } catch {

      return {
        temImagem: null,
        quantidade: 0
      };
    }
  }
