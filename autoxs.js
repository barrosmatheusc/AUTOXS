const path = require('node:path');
const { extrairTermoBusca } = require('./termo-busca');
const { criarPainelManual } = require('./painel-manual');
const { criarGrupoJanelas } = require('./janelas-trabalho');
const { confirmarSalvamento, acompanharEnvioManual } = require('./acompanhar-envio');
const { conferirCategoriaEsportes, mostrarConferenciaCategoria } = require('./conferir-esportes');
const { selecionarPaginaListagem } = require('./pagina-listagem');
const { criarEnvioAoSite } = require('./preencher-materia');
const { mostrarAjudaFotos } = require('./ajuda-fotos');
const { acompanharFotosAdicao } = require('./fotos-adicao');
const { instalarBotaoLegenda } = require('./botao-legenda');
const { instalarSugestoesChapeuCMS } = require('./sugestoes-chapeu-cms');
const { validarRequisitosDaMateria, instalarProtecaoEnvioCMS } = require('./requisitos-materia');
const { lerCategoriaAtual, podeGerarImagemRJ, gerarImagemRJ, gerarImagemPorSolicitacao, imagemEmGeracao } = require('./imagem-rj');

const TITULO_LIMITE = 'Quanto foi o jogo Brasil x Japão hoje? Veja resultado dos gols';
const LIMITE_PAGINA = 25;
const URL_NEWS = 'https://redacao.tribunaweb.com.br/news';
// O CMS pode apresentar data e horário juntos: 24/09/202617:32.
// A coleta e a conferência do lote devem aceitar o mesmo formato.
const PADRAO_DATA = /\b(\d{2})\/(\d{2})\/(\d{4})(?:\s*(\d{2}):(\d{2}))?\b/;

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
  return simplificar(titulo).includes(simplificar(TITULO_LIMITE));
}

async function coletarMaterias(page, estado = {}) {
  // O lote é somente a página atualmente filtrada. A referência e tudo
  // abaixo dela ficam fora da fila, inclusive quando não têm link de edição.
  estado.limiteEncontrado = false;
  let linhas;
  for (const seletor of ['tr', '[role="row"]', '.list-group-item', '.card', '.row']) {
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
    if (!await linha.isVisible()) continue;
    const texto = await linha.innerText();
    const celulas = linha.locator('td');
    const titulo = await celulas.count() > 7
      ? (await celulas.nth(7).innerText()).trim()
      : texto.replace(/\s+/g, ' ').trim();
    if (ehMateriaLimite(titulo)) {
      estado.limiteEncontrado = true;
      break;
    }
    if (materias.length >= LIMITE_PAGINA) continue;
    const links = linha.locator('a');
    const enderecos = await links.evaluateAll(elementos => elementos
      .filter(a => /editar/i.test(`${a.textContent} ${a.title} ${a.getAttribute('aria-label') || ''}`) || /edit/i.test(a.getAttribute('href') || ''))
      .map(a => a.getAttribute('href')).filter(Boolean));
    const urls = [...new Set(enderecos.map(href => new URL(href, page.url()).href))];
    if (urls.length !== 1) continue;
    const url = urls[0];
    const destino = new URL(url);
    if (destino.origin !== new URL(URL_NEWS).origin || !destino.pathname.startsWith('/news/') || vistas.has(url)) continue;
    const dataTexto = texto.match(PADRAO_DATA)?.[0];
    vistas.add(url);
    materias.push({ url, data: dataTexto, titulo });
  }
  return materias;
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

async function lerPendencias(aba) {
  if (imagemEmGeracao(aba)) throw new Error('A geração de imagem ainda está em andamento.');
  const campo = localizarCampoChapeu(aba);
  if (await campo.count() !== 1 || !await campo.isVisible()) {
    throw new Error('Campo Chapéu não identificado.');
  }
  const chapeu = (await campo.inputValue()).trim();
  const categoria = await lerCategoriaAtual(aba);
  const campoTitulo = aba.locator('input[name="title"], #inp_title');
  const titulo = await campoTitulo.count() === 1 ? await campoTitulo.inputValue() : '';
  const conferenciaCategoria = conferirCategoriaEsportes({ categoria, titulo, chapeu });
  await mostrarConferenciaCategoria(aba, conferenciaCategoria);
  const imagem = await verificarImagemDestaque(aba);
  return { temChapeu: Boolean(chapeu), temImagem: imagem.temImagem, categoria, conferenciaCategoria };
}

async function mostrarAvisoMateriaIncompleta(aba, {temChapeu,temImagem}) {
  const mensagem = !temChapeu && !temImagem
    ? '⚠️ CHAPÉU E FOTO FALTANDO'
    : !temChapeu ? '⚠️ CHAPÉU FALTANDO' : '⚠️ FOTO FALTANDO';
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

async function validarChapeuEFotoAntesDoEnvio(aba) {
  const campo = localizarCampoChapeu(aba);
  const formulario = campo.locator('xpath=ancestor::form[1]');
  const resultado = await formulario.count() === 1
    ? await formulario.evaluate(validarRequisitosDaMateria)
    : { valido: false, temChapeu: false, temFoto: false };
  if (resultado.valido) return true;
  await mostrarAvisoMateriaIncompleta(aba, { temChapeu: resultado.temChapeu, temImagem: resultado.temFoto });
  return false;
}

async function enviarMateria(aba) {
  // Usa o formulário do chapéu, evitando o Enviar do login ou de um modal.
  const campo = localizarCampoChapeu(aba);
  const formulario = campo.locator('xpath=ancestor::form[1]');
  if (await formulario.count() !== 1) throw new Error('Formulário da matéria não identificado pelo campo Chapéu.');
  // O ícone de avião do CMS faz parte do nome acessível do botão Enviar.
  const enviar = formulario.getByRole('button', { name: /^[^\p{L}\p{N}]*(?:enviar|salvar|atualizar)(?:\s+mat[eé]ria)?[^\p{L}\p{N}]*$/iu }).filter({ visible: true });
  if (await enviar.count() !== 1) throw new Error('Botão Enviar/Salvar/Atualizar ausente ou ambíguo no formulário da matéria.');
  // Última proteção antes do envio real: mantém a matéria aberta quando faltar chapéu ou foto.
  if (!await validarChapeuEFotoAntesDoEnvio(aba)) return false;
  if (!await enviar.isEnabled()) return false;
  if (!await formulario.evaluate(form => form.checkValidity())) return false;
  const urlInicial = aba.url();
  const action = await formulario.evaluate(form => form.action);
  const mensagensAntes = await aba.locator('.alert-success, .toast-success, [role="status"]').allTextContents();
  const respostaPendente = aba.waitForResponse(resposta => {
    const requisicao = resposta.request();
    const destino = new URL(resposta.url());
    return ['POST', 'PUT', 'PATCH'].includes(requisicao.method()) &&
      destino.origin === new URL(urlInicial).origin &&
      [new URL(action).pathname, new URL(urlInicial).pathname].includes(destino.pathname);
  }, { timeout: 15000 }).catch(() => null);
  await enviar.click();
  const resposta = await respostaPendente;
  if (!resposta || resposta.status() < 200 || resposta.status() >= 400) return false;
  // Um clique ou resposta HTTP isolada não confirma que a matéria foi salva.
  return confirmarSalvamento(aba, mensagensAntes);
}

async function processarLote(materias, operacoes) {
  const abertas = [];
  const geracoesPendentes = [];
  const resumo = { abertas: 0, enviadas: 0, pendentes: 0, erros: 0 };
  const tituloCurto = materia => {
    const texto = String(materia.titulo || 'Sem título').replace(/\s+/g, ' ').trim();
    return texto.length > 70 ? `${texto.slice(0, 67)}...` : texto;
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
    catch { await operacoes.log('  Fechamento automático indisponível nesta aba. Você pode enviá-la e fechá-la manualmente.'); }
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
        etapa = 'conferir novamente chapéu e foto';
        const estado = await operacoes.ler(aba);
        if (estado.conferenciaCategoria?.revisar) {
          await operacoes.log('  ' + estado.conferenciaCategoria.mensagem);
          continue;
        }
        if (estado.temChapeu !== true || estado.temImagem !== true) {
          await operacoes.log(estado.temChapeu !== true ? '  Falta chapéu. Aba mantida para preenchimento manual.' : '  Foto não confirmada. Confira a aba manualmente.');
          continue;
        }
        if (interrompido()) return;
        etapa = 'enviar a matéria após a geração';
        if (!await operacoes.enviar(aba)) {
          await operacoes.log('  Envio não confirmado. Confira a matéria na aba aberta.');
          continue;
        }
        resumo.enviadas++;
        resumo.pendentes--;
        // Um erro ao fechar a aba não transforma um envio confirmado em pendência.
        try { await aba.close(); }
        catch {
          resumo.erros++;
          await operacoes.log('  Matéria enviada. Não foi possível fechar a aba.');
          continue;
        }
        await operacoes.log('  Foto e legenda conferidas. Matéria enviada. Aba fechada.');
      } catch {
        if (interrompido()) return;
        resumo.erros++;
        await operacoes.log(`  Não foi possível ${etapa}. Aba mantida para conferência manual.`);
      } finally {
        await acompanharPendente(aba, materia);
      }
    }
  }
  // Duas etapas: todas as abas são abertas antes de qualquer verificação/envio.
  for (const materia of materias.slice(0, LIMITE_PAGINA)) {
    if (interrompido()) break;
    if (ehMateriaLimite(materia.titulo)) break;
    try {
      const aba = await operacoes.abrir(materia);
      abertas.push({ materia, aba });
      resumo.abertas++;
    } catch {
      if (interrompido()) break;
      resumo.erros++;
      await operacoes.log(`Não foi possível abrir: ${tituloCurto(materia)}.`);
    }
  }
  for (const [indice, { materia, aba }] of abertas.entries()) {
    if (interrompido()) break;
    // Retoma apenas entre matérias, sem disputar o foco com a conferência atual.
    await retomarGeracoesProntas();
    if (interrompido()) break;
    await operacoes.log(`\nMatéria ${indice + 1}/${abertas.length} — ${tituloCurto(materia)}`);
    let etapa = 'conferir chapéu e foto';
    try {
      if (operacoes.preparar) await operacoes.preparar(aba);
      const estado = await operacoes.ler(aba);
      await operacoes.log(estado.temChapeu ? '  Chapéu conferido.' : '  Falta chapéu. Preencha manualmente.');
      await operacoes.log(estado.temImagem === true ? '  Foto conferida.' : estado.temImagem === false
        ? '  Falta foto.' : '  Não foi possível confirmar a foto.');
      if (estado.conferenciaCategoria?.mensagem) await operacoes.log('  ' + estado.conferenciaCategoria.mensagem);
      if (estado.temChapeu === true && estado.temImagem === true && !estado.conferenciaCategoria?.revisar) {
        etapa = 'enviar a matéria';
        if (await operacoes.enviar(aba)) {
          resumo.enviadas++;
          etapa = 'fechar a aba';
          await aba.close();
          await operacoes.log('  Matéria enviada. Aba fechada.');
          continue;
        }
        await operacoes.log('  Envio não confirmado. Confira a matéria na aba aberta.');
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
    } catch {
      if (interrompido()) break;
      resumo.erros++;
      resumo.pendentes++;
      await operacoes.log(`  Não foi possível ${etapa}. Confira a aba manualmente.`);
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
async function abrirMateriaEmSegundoPlano(context, listagem, materia, carregamentos) {
  const aba = await context.newPage();
  const carregamento = aba.goto(materia.url, { waitUntil: 'domcontentloaded' })
    .then(() => ({ erro: null }), erro => ({ erro }));
  // Captura falhas imediatamente, inclusive enquanto outras abas estão abrindo.
  carregamentos.set(aba, carregamento);
  await listagem.bringToFront();
  return aba;
}

async function obterOuAbrirMateria(context, listagem, materia, carregamentos) {
  const existente = context.pages().find(aba => aba !== listagem && !aba.isClosed() && aba.url() === materia.url);
  if (existente) {
    if (!carregamentos.has(existente)) carregamentos.set(existente, Promise.resolve({ erro: null }));
    return existente;
  }
  return abrirMateriaEmSegundoPlano(context, listagem, materia, carregamentos);
}
async function prepararAbaMateria(aba, carregamentos) {
  await aba.bringToFront();
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
  let encerramentoAutoXS = null;
  const encerrarAutoXS = () => {
    if (encerramentoAutoXS) return encerramentoAutoXS;
    encerramentoAutoXS = (async () => {
      await context.close().catch(() => {});
    })();
    return encerramentoAutoXS;
  };
  process.once('SIGINT', () => { void encerrarAutoXS(); });
  process.once('SIGTERM', () => { void encerrarAutoXS(); });
  // Preserva eventuais abas de matérias abertas em uma execução anterior.
  const janelaAtualizacao = criarGrupoJanelas(context);
  const janelaAdicao = criarGrupoJanelas(context);
  let page = null;
  console.log(`FLUXO MANUAL — até 25 matérias da página filtrada, antes de: ${TITULO_LIMITE}.`);
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
  async function abrirListagem() {

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
  async function aplicarFiltro() {

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
  // As abas pendentes continuam editáveis entre cliques no painel.
  await criarPainelManual(context, async (progresso, paginaEscolhida) => {
    if (paginaEscolhida !== 1 && paginaEscolhida !== 2) throw new Error('Escolha Página 1 ou Página 2 antes de atualizar.');
    if (!page || page.isClosed()) page = await janelaAtualizacao.newPage();
    await progresso('Atualizando a fila…');
    if (!await abrirListagem() || !await aplicarFiltro()) throw new Error('Não foi possível preparar a fila.');
    // Antes de ir à página 2, confere se o ponto de parada já está na página 1.
    await selecionarPaginaListagem(page, 1);
    const estadoPrimeira = {};
    let candidatas = await coletarMaterias(page, estadoPrimeira);
    if (paginaEscolhida === 2) {
      if (estadoPrimeira.limiteEncontrado) {
        candidatas = [];
        await progresso('A matéria do jogo do Brasil já está na página 1. A página 2 fica abaixo do limite.');
      } else {
        await progresso('Selecionando a página 2…');
        await selecionarPaginaListagem(page, 2);
        candidatas = await coletarMaterias(page);
      }
    }
    const materias = candidatas.filter(m => !enviadas.has(m.url));
    await progresso(`${materias.length} matérias elegíveis na página ${paginaEscolhida}.`);
    const resumo = await processarLote(materias, {
      abrir: materia => obterOuAbrirMateria(janelaAtualizacao, page, materia, carregamentos),
      preparar: async aba => {
        // Ao conferir novamente uma pendência, devolve o controle ao lote.
        acompanhamentos.get(aba)?.();
        acompanhamentos.delete(aba);
        await prepararAbaMateria(aba, carregamentos);
        await instalarFerramentasEditorais(aba);
      },
      acompanhar: async (aba, materia) => {
        if (acompanhamentos.has(aba) || enviadas.has(materia.url)) return;
        const formulario = localizarCampoChapeu(aba).locator('xpath=ancestor::form[1]');
        const parar = await acompanharEnvioManual(aba, formulario, () => {
          enviadas.add(materia.url);
          acompanhamentos.delete(aba);
        });
        if (parar) acompanhamentos.set(aba, parar);
      },
      ler: lerPendencias,
      enviar: async aba => {
        const url = aba.url();
        const confirmado = await enviarMateria(aba);
        if (confirmado) enviadas.add(url);
        return confirmado;
      },
      pesquisar: abrirPesquisaImagem,
      gerarImagem: (aba, log = progresso) => gerarImagemRJ(aba, verificarImagemDestaque, log),
      ativo: () => context.pages().length > 0,
      log: async mensagem => { console.log(mensagem); await progresso(mensagem); }
    });
    console.log(`\nConferência concluída: ${resumo.enviadas} enviadas; ${resumo.pendentes} para conferir manualmente.`);
    return resumo;
  }, criarEnvioAoSite(context, garantirLogin, async () => {}, () => janelaAdicao.newPage()), janelaAdicao);
  console.log('Clique em Atualizar no painel para iniciar uma rodada.');
}

if (require.main === module) {
  executar().catch(erro => {
    console.error('Não foi possível continuar. Confira se o navegador está aberto e se o sistema está acessível.');
    process.exitCode = 1;
  });
}

module.exports = { verificarImagemDestaque, obterOuAbrirMateria, localizarCampoChapeu, abrirMateriaEmSegundoPlano, prepararAbaMateria, converterData, coletarMaterias, processarLote, lerPendencias, enviarMateria, abrirPesquisaImagem };
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
  async function verificarImagemDestaque(aba) {
    const formulario = localizarCampoChapeu(aba).locator('xpath=ancestor::form[1]');
    if (await formulario.count() !== 1) return { temImagem: null, quantidade: 0 };
    try {
      const resultado = await formulario.evaluate(validarRequisitosDaMateria);
      return {
        temImagem: resultado.fotoIdentificavel ? resultado.temFoto : null,
        quantidade: resultado.quantidadeFotos
      };
    } catch {
      return { temImagem: null, quantidade: 0 };
    }
  }
