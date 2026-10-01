const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { abrirPesquisaImagem, localizarCampoChapeu, prepararAbaMateria, lerPendencias, enviarMateria, processarLote } = require('../autoxs');
let browser;
before(async () => { browser = await chromium.launch({ channel: 'msedge', headless: true }); });
after(async () => { await browser?.close(); });

async function paginaLocal({ rotulo = 'Chapéu (opcional)', nome = 'campo', valor = 'Política', foto = true, botao = 'Enviar', erro = false, icone = false } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let envios = 0;
  const svg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="blue"/></svg>');
  const html = `<html><head><meta charset="utf-8"></head><body><form method="post" action="/news/1/edit">
    <input name="chapeu_oculto" type="hidden">
    ${rotulo ? `<label for="${nome}">${rotulo}</label>` : ''}
    <input id="${nome}" name="${nome}" value="${valor}">
    <div><button type="button">+</button></div>
    ${foto ? `<div><img width="200" height="120" src="data:image/svg+xml,${svg}"></div>` : ''}
    <div><button type="button">+</button></div>
    <button type="submit">${icone ? '<i></i> ' : ''}${botao}</button>
    </form></body></html>`;
  // Todas as requisições são atendidas em memória. Nenhum acesso ao CMS/rede.
  await context.route('**/*', async route => {
    if (route.request().method() === 'POST') {
      envios++;
      await route.fulfill({ status: erro ? 422 : 200, contentType: 'text/html; charset=utf-8', body: erro
        ? '<div class="alert-danger">Falha de validação</div>'
        : '<div class="alert-success">Matéria atualizada com sucesso</div>' });
    } else await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
  await page.goto('http://manual.test/news/1/edit');
  if (foto) await page.locator('img').evaluate(img => img.decode());
  return { page, context, envios: () => envios };
}

test('campo real: reconhece rótulos variados e nome/id, ignorando campo oculto', async () => {
  for (const opcao of [
    { rotulo: 'Chapéu' }, { rotulo: 'Chapéu (opcional)' }, { rotulo: 'Chapéu *' },
    { rotulo: 'CHAPEU:' }, { rotulo: '', nome: 'news_chapeu' },
    { rotulo: '', nome: 'hat' }, { rotulo: '', nome: 'inp_hat' }
  ]) {
    const { page, context } = await paginaLocal(opcao);
    try {
      const cargas = new WeakMap([[page, Promise.resolve({ erro: null })]]);
      await prepararAbaMateria(page, cargas);
      assert.equal(await localizarCampoChapeu(page).inputValue(), 'Política');
      assert.deepEqual(await lerPendencias(page), { temChapeu: true, temImagem: true, categoria: '' });
    } finally { await context.close(); }
  }
});

test('matéria completa é enviada e fechada com Enviar, Salvar ou Atualizar', async () => {
  for (const opcao of [{ botao: 'Enviar' }, { botao: 'Salvar' }, { botao: 'Atualizar' }, { botao: 'Enviar', icone: true }]) {
    const mock = await paginaLocal(opcao);
    try {
      const resumo = await processarLote([{ titulo: 'Teste local', data: '01/01/2026', url: mock.page.url() }], {
        abrir: async () => mock.page,
        ler: lerPendencias,
        enviar: enviarMateria,
        log: () => {}
      });
      assert.equal(mock.envios(), 1);
      assert.equal(resumo.enviadas, 1);
      assert.equal(mock.page.isClosed(), true);
    } finally { await mock.context.close(); }
  }
});

test('chapéu vazio e foto ausente permanecem pendentes no formulário real', async () => {
  for (const opcao of [{ valor: '' }, { foto: false }, { valor: '', foto: false }]) {
    const mock = await paginaLocal(opcao);
    let pesquisas = 0;
    try {
      const resumo = await processarLote([{ titulo: 'Pendente', data: '01/01/2026' }], {
        abrir: async () => mock.page,
        ler: lerPendencias,
        enviar: enviarMateria,
        pesquisar: async () => { pesquisas++; },
        log: () => {}
      });
      assert.equal(mock.envios(), 0);
      assert.equal(resumo.pendentes, 1);
      assert.equal(mock.page.isClosed(), false);
      assert.equal(pesquisas, opcao.foto === false ? 1 : 0);
    } finally { await mock.context.close(); }
  }
});

test('erro HTTP no envio real não fecha a aba', async () => {
  const mock = await paginaLocal({ erro: true });
  try {
    const resumo = await processarLote([{ titulo: 'Erro', data: '01/01/2026' }], {
      abrir: async () => mock.page, ler: lerPendencias, enviar: enviarMateria, log: () => {}
    });
    assert.equal(mock.envios(), 1);
    assert.equal(resumo.enviadas, 0);
    assert.equal(mock.page.isClosed(), false);
  } finally { await mock.context.close(); }
});
test('pesquisa o nome do título atual e mantém a escolha de foto manual', async () => {
  const context = await browser.newContext();
  let requisicoes = 0;
  await context.route('**/*', async route => { requisicoes++; await route.abort(); });
  const page = await context.newPage();
  try {
    await page.setContent(`<html><body>
      <input name="title" value="Bernie Ecclestone é detido em aeroporto"><input id="inp_subtitle" name="subtitle" value="Ex-chefão da F1 prestou esclarecimentos às autoridades">
<label>Exibir <select id="quantidade-materias"><option>25</option><option>100</option></select></label>
      <button type="button" onclick="document.querySelector('dialog').showModal()">+</button>
      <button type="button">+</button>
      <dialog aria-label="Imagem de Destaque">
        <label>Exibir <select name="fotos_length" onchange="window.quantidadeFotos = this.value">
          <option>10</option><option>25</option><option>50</option><option>100</option>
        </select> fotos</label>
        <form onsubmit="event.preventDefault(); document.querySelector('#resultado').textContent = document.querySelector('#pesquisa').value; window.quantidadeAoPesquisar = window.quantidadeFotos;">
          <label for="pesquisa">Pesquisar:</label><input id="pesquisa" type="search">
          <button>Pesquisar</button>
        </form>
        <div id="resultado"></div>
        <button type="button" onclick="window.selecionou = true">Selecionar foto</button>
      </dialog>
    </body></html>`);
    const termo = await abrirPesquisaImagem(page, 'Título anterior da listagem');
    assert.equal(termo, 'Bernie Ecclestone');
    assert.equal(await page.locator('#manual-ajuda-fotos').locator('#subtitulo').textContent(), 'Ex-chefão da F1 prestou esclarecimentos às autoridades');
    assert.equal(await page.locator('select[name="fotos_length"]').inputValue(), '100');
    assert.equal(await page.locator('#quantidade-materias').inputValue(), '25');
    assert.equal(await page.evaluate(() => window.quantidadeAoPesquisar), '100');
    assert.equal(await page.locator('#pesquisa').inputValue(), termo);
    assert.equal(await page.locator('#resultado').textContent(), termo);
    assert.equal(await page.getByRole('dialog').isVisible(), true);
    assert.equal(await page.evaluate(() => Boolean(window.selecionou)), false);
    assert.equal(requisicoes, 0);
    await page.locator('#pesquisa').fill('outro termo');
    assert.equal(await page.locator('#pesquisa').inputValue(), 'outro termo');
    await page.locator('#inp_subtitle').evaluate(el=>{el.value='Bigode atualizado';});
    const preservado = await abrirPesquisaImagem(page, 'Título novo');
    assert.equal(preservado, 'outro termo');
    assert.equal(await page.locator('#manual-ajuda-fotos').locator('#subtitulo').textContent(), 'Bigode atualizado');
    assert.equal(await page.locator('#pesquisa').inputValue(), 'outro termo');
  } finally { await context.close(); }
});