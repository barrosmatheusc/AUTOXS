const geracoes = new WeakMap();
const emAndamento = new WeakSet();

async function lerCategoriaAtual(aba) {
  const campo = aba.locator('#inp_category_id, select[name="category_id"]');
  if (await campo.count() !== 1) return '';
  const selecionadas = await campo.locator('option:checked').allTextContents();
  return selecionadas.length === 1 ? selecionadas[0].trim() : '';
}

function podeGerarImagemRJ(categoria, temImagem) {
  return String(categoria || '').trim().toLowerCase() === 'rj em foco' && temImagem === false;
}

async function gerarImagemRJ(aba, conferirFoto, log = async () => {}) {
  return gerarImagemNanoBanana(aba, conferirFoto, log, false);
}

async function gerarImagemPorSolicitacao(aba, conferirFoto, log = async () => {}) {
  return gerarImagemNanoBanana(aba, conferirFoto, log, true);
}

function imagemEmGeracao(aba) { return emAndamento.has(aba); }


async function abrirEdicaoLegendaDestaque(aba) {
  // O cartão entre os dois botões + pertence à imagem de destaque, antes da galeria.
  const mais = aba.getByRole('button', { name: '+', exact: true });
  // Mede todos os cartões em uma única consulta ao navegador. Não guarda
  // a foto em cache: uma troca manual de imagem precisa ser respeitada.
  const localizacao = await mais.evaluateAll(botoes => {
    const visivel = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    if (botoes.length < 2 || !visivel(botoes[0]) || !visivel(botoes[1])) return null;
    const inicio = botoes[0].getBoundingClientRect(), fim = botoes[1].getBoundingClientRect();
    return [...document.querySelectorAll('.card')].flatMap((card, indice) => {
      const box = card.getBoundingClientRect();
      return visivel(card) && !card.closest('.modal, [role="dialog"], dialog') &&
        box.y > inicio.y && box.y < fim.y && box.width >= 100 && card.querySelector('img') ? [indice] : [];
    });
  });
  if (!localizacao) throw new Error('Não encontrei a imagem de destaque para preencher a legenda.');
  if (localizacao.length !== 1) throw new Error('Não foi possível identificar com segurança a foto de destaque para legendar.');
  await aba.locator('.card').nth(localizacao[0]).locator('button:not([data-autoxs-legenda])').first().click();
  const legenda = aba.getByRole('textbox', { name: /^Legenda\s*[:*]?$/i }).filter({ visible: true });
  await legenda.waitFor({ state: 'visible', timeout: 15000 });
  const modal = aba.locator('.modal, [role="dialog"], dialog').filter({ has: legenda }).filter({ visible: true });
  if (await modal.count() !== 1) throw new Error('Janela de legenda não identificada.');
  return { modal, legenda };
}

async function salvarLegenda(aba, modal, definirPadrao) {
  const tornarPadrao = modal.getByLabel(/Tornar\s+legenda\s+e\s+cr[eé]ditos\s+padr[aã]o\s+da\s+imagem/i);
  // setChecked já confirma o estado final e retorna imediatamente se estiver correto.
  await tornarPadrao.setChecked(definirPadrao, { timeout: 10000 });
  const salvar = modal.getByRole('button', { name: /^[^\p{L}\p{N}]*Salvar[^\p{L}\p{N}]*$/iu });
  const respostaSalva = aba.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/images/save', { timeout: 15000 });
  // Captura eventual rejeição também se o clique falhar, sem deixar uma promessa solta.
  respostaSalva.catch(() => {});
  await salvar.click();
  const resposta = await respostaSalva;
  if (!resposta.ok()) throw new Error('O site não confirmou o salvamento da legenda.');
  await modal.waitFor({ state: 'hidden', timeout: 15000 });
}

async function preencherLegendaGerada(aba, titulo, definirPadrao = true) {
  const { modal, legenda } = await abrirEdicaoLegendaDestaque(aba);
  await legenda.fill(titulo);
  // Dispara a saída do campo sem navegar para outro controle pelo teclado.
  await legenda.blur();
  if (await legenda.inputValue() !== titulo) throw new Error('O site não aceitou o título completo na legenda.');
  await salvarLegenda(aba, modal, definirPadrao);
}

async function definirLegendaCreditosPadrao(aba) {
  // O segundo botão aplica o título atual e marca legenda/créditos como padrão
  // na mesma edição, com um único salvamento da imagem.
  return substituirTituloNaLegenda(aba, true);
}

async function substituirTituloNaLegenda(aba, definirPadrao = false) {
  if (emAndamento.has(aba)) throw new Error('Aguarde a operação da imagem terminar.');
  emAndamento.add(aba);
  try {
    const campo = aba.locator('input[name="title"], #inp_title');
    if (await campo.count() !== 1) throw new Error('Título da matéria não identificado.');
    const titulo = await campo.inputValue();
    if (!titulo.trim()) throw new Error('Preencha o título da matéria antes de copiar para a legenda.');
    await preencherLegendaGerada(aba, titulo, definirPadrao);
  } finally {
    emAndamento.delete(aba);
  }
}

async function gerarImagemNanoBanana(aba, conferirFoto, log, solicitacaoManual) {
  // O caminho manual é acionado pelo botão; a geração automática segue restrita a RJ.
  if (geracoes.has(aba)) return geracoes.get(aba);
  if (emAndamento.has(aba)) throw new Error('Aguarde a operação da legenda terminar.');
  let disparada = false;
  emAndamento.add(aba);
  const tarefa = (async () => {
    if (!solicitacaoManual && !podeGerarImagemRJ(await lerCategoriaAtual(aba), false)) return false;
    const acervo = aba.getByRole('dialog', { name: /Imagem de Destaque/i });
    if (await acervo.isVisible()) {
      const fechar = acervo.getByRole('button', { name: /^[^\p{L}\p{N}]*(?:fechar|close)[^\p{L}\p{N}]*$/iu })
        .or(acervo.locator('button[data-bs-dismiss="modal"], button[data-dismiss="modal"], button.close, button.btn-close'))
        .filter({ visible: true });
      if (await fechar.count() === 0) throw new Error('Não foi possível fechar o banco de fotos.');
      await fechar.first().click();
      await acervo.waitFor({ state: 'hidden', timeout: 10000 });
    }
    // Confere depois de fechar o acervo para não confundir seus resultados com a foto da matéria.
    const foto = await conferirFoto(aba);
    if (foto.temImagem !== false) return false;
    const campoTitulo = aba.locator('input[name="title"], #inp_title');
    const titulo = await campoTitulo.count() === 1 ? await campoTitulo.inputValue() : '';
    if (!titulo.trim()) throw new Error('Título não encontrado para preencher a legenda da imagem.');
    await log('  Abrindo a geração de foto com Nano Banana.');
    const prompt = aba.locator('#nanobananaFormPrompts');
    if (!await prompt.isVisible()) await aba.getByRole('link', { name: /IMAGEM (?:IA|AI)/i }).click();
    await prompt.waitFor({ state: 'visible', timeout: 15000 });
    const opcoes = await prompt.locator('option').evaluateAll(os => os.map(o => ({ texto: o.textContent.trim(), valor: o.value })));
    const nano = opcoes.filter(o => /nano\s*banana/i.test(o.texto));
    if (nano.length !== 1) throw new Error('Prompt Nano Banana ausente ou ambíguo.');
    await prompt.selectOption(nano[0].valor);
    await log('  Nano Banana selecionado. Gerando foto…');
    const gerar = aba.getByRole('button', { name: /Gerar Imagem/i }).filter({ visible: true });
    if (await gerar.count() !== 1) throw new Error('Botão Gerar Imagem não identificado.');
    disparada = true;
    await gerar.click();
    const resultado = aba.locator('.modal, [role="dialog"], dialog')
      .filter({ hasText: /Geração de Imagem com IA/i }).filter({ visible: true });
    await resultado.waitFor({ state: 'visible', timeout: 120000 });
    const usar = resultado.getByRole('button', { name: /Usar esta Imagem/i });
    await usar.waitFor({ state: 'visible', timeout: 180000 });
    await log('  Foto gerada. Adicionando à edição da matéria.');
    await usar.click();
    await resultado.waitFor({ state: 'hidden', timeout: 15000 });
    // A imagem pode levar um momento para aparecer na edição.
    for (let i = 0; i < 10; i++) {
      const atual = await conferirFoto(aba);
      if (atual.temImagem === true) {
        await log('  Preenchendo a legenda com o título completo.');
        // O título pode ter sido ajustado enquanto a geração estava em andamento.
        const tituloAtual = await campoTitulo.inputValue();
        if (!tituloAtual.trim()) throw new Error('Título não encontrado para preencher a legenda da imagem.');
        await preencherLegendaGerada(aba, tituloAtual);
        await log('  Foto e legenda conferidas.');
        return true;
      }
      await aba.waitForTimeout(1000);
    }
    throw new Error('A foto gerada ainda não foi confirmada na edição.');
  })();
  const protegida = tarefa.then(resultado => {
    if (!disparada) geracoes.delete(aba);
    return resultado;
  }).catch(erro => {
    if (!disparada) geracoes.delete(aba);
    throw erro;
  }).finally(() => emAndamento.delete(aba));
  geracoes.set(aba, protegida);
  return protegida;
}

module.exports = { lerCategoriaAtual, podeGerarImagemRJ, gerarImagemRJ, gerarImagemPorSolicitacao, imagemEmGeracao, substituirTituloNaLegenda, definirLegendaCreditosPadrao };
