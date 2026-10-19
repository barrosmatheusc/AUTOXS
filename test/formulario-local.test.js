const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { abrirPesquisaImagem, localizarCampoChapeu, prepararAbaMateria, lerPendencias, enviarMateria, processarLote } = require('../autoxs');
let browser;
before(async () => { browser = await chromium.launch({ channel: 'msedge', headless: true }); });
after(async () => { await browser?.close(); });

async function paginaLocal({ rotulo = 'Chapéu (opcional)', nome = 'campo', valor = 'Política', foto = true, botao = 'Enviar', erro = false, icone = false,
  categoria = '', geral = true, titulo = '', subtitulo = '', corpoHtml = '' } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let envios = 0, ultimoPost = '';
  const svg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="blue"/></svg>');
  const html = `<html><head><meta charset="utf-8"></head><body><form method="post" action="/news/1/edit">
    <input name="chapeu_oculto" type="hidden">
    ${rotulo ? `<label for="${nome}">${rotulo}</label>` : ''}
    <input id="${nome}" name="${nome}" value="${valor}">
    ${categoria ? `<input id="inp_title" name="title" value="${titulo}"><input id="inp_subtitle" name="subtitle" value="${subtitulo}">
    <select id="inp_category_id" name="category_id"><option value="2">${categoria}</option>${geral ? '<option value="1">Geral</option>' : ''}</select>` : ''}
    <div><button type="button">+</button></div>
    ${foto ? `<div><img width="200" height="120" src="data:image/svg+xml,${svg}"></div>` : ''}
    <div><button type="button">+</button></div>
    <textarea id="inp_text" name="text" hidden></textarea>
    <a href="#" data-command="source.toggle">HTML</a>
    <div class="rx-editor" contenteditable="true"><p>Corpo de teste preservado.</p></div>
    <textarea class="rx-source" hidden></textarea>
    <button type="submit">${icone ? '<i></i> ' : ''}${botao}</button>
    </form><script>
      document.querySelector('a[data-command="source.toggle"]').addEventListener('click', event => {
        event.preventDefault();
        const visual = document.querySelector('.rx-editor');
        const fonte = document.querySelector('.rx-source');
        if (fonte.hidden) { fonte.value = visual.innerHTML; visual.hidden = true; fonte.hidden = false; }
        else { visual.innerHTML = fonte.value; document.querySelector('#inp_text').value = fonte.value;
          fonte.hidden = true; visual.hidden = false; }
      });
    </script></body></html>`;
  // Todas as requisições são atendidas em memória. Nenhum acesso ao CMS/rede.
  await context.route('**/*', async route => {
    if (route.request().method() === 'POST') {
      envios++;
      ultimoPost = route.request().postData() || '';
      await route.fulfill({ status: erro ? 422 : 200, contentType: 'text/html; charset=utf-8', body: erro
        ? '<div class="alert-danger">Falha de validação</div>'
        : '<div class="alert-success">Matéria atualizada com sucesso</div>' });
    } else await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
  await page.goto('http://manual.test/news/1/edit');
  if (corpoHtml) {
    await page.locator('.rx-editor').evaluate((elemento, conteudo) => { elemento.innerHTML = conteudo; }, corpoHtml);
    await page.locator('#inp_text').evaluate((elemento, conteudo) => { elemento.value = conteudo; }, corpoHtml);
  }
  if (foto) await page.locator('form > div > img').evaluate(img => img.decode());
  return { page, context, envios: () => envios, ultimoPost: () => ultimoPost };
}

test('Astronomia, Arqueologia e Cultura em Esportes mudam para Geral antes do envio', async () => {
  for (const titulo of [
    'Observatório registra descoberta de novo planeta',
    'Pesquisadores encontram artefatos em escavação arqueológica',
    'Festival de teatro anuncia programação cultural'
  ]) {
    const mock = await paginaLocal({ categoria:'Esportes', titulo });
    try {
      const estado = await lerPendencias(mock.page);
      assert.equal(estado.categoria, 'Geral', titulo);
      assert.equal(estado.conferenciaCategoria.revisar, false);
      assert.equal(await mock.page.locator('form').evaluate(form => new FormData(form).get('category_id')), '1');
      assert.equal(await enviarMateria(mock.page, false), true);
      assert.equal(new URLSearchParams(mock.ultimoPost()).get('category_id'), '1');
      assert.equal(mock.envios(), 1);
    } finally { await mock.context.close(); }
  }
});

test('POST local envia o corpo sem o figure do logotipo e preserva o texto', async () => {
  const logo = '<figure style="text-align:center"><a href="https://agenciabrasil.ebc.com.br/noticia"><img alt="Logo Agência Brasil" src="https://cdn.jsdelivr.net/gh/sergiosdlima/assets-ebc@1.0.0/abr/assets/images/logo-agenciabrasil.svg"></a></figure>';
  const mock = await paginaLocal({ corpoHtml:`<p><strong>Texto legítimo</strong></p>${logo}<p>Fim.</p>` });
  try {
    assert.equal(await enviarMateria(mock.page, false), true);
    const enviado = new URLSearchParams(mock.ultimoPost()).get('text');
    assert.doesNotMatch(enviado, /logo-agenciabrasil\.svg/);
    assert.match(enviado, /<strong>Texto legítimo<\/strong>/);
    assert.match(enviado, /<p>Fim\.<\/p>/);
    assert.equal(mock.envios(), 1);
  } finally { await mock.context.close(); }
});

test('simulação Fluminense x Santos com HTML descrito: serializações equivalentes preservam a reportagem e removem só o logo', async () => {
  const logo = '<figure style="text-align: center;"><a href="https://agenciabrasil.ebc.com.br/" target="_BLANK"><img alt="Logo Agência Brasil" src="https://cdn.jsdelivr.net/gh/sergiosdlima/assets-ebc@1.0.0/abr/assets/images/logo-agenciabrasil.svg" style="height: 54px;"></a></figure>';
  const foto = '<figure><img src="/fotos/fluminense-santos.jpg" alt="Jogadores durante a partida"><figcaption>Foto do jogo</figcaption></figure>';
  const visual = `<p class="noticia" style="text-align: left"><strong>Rádio Nacional</strong> transmite duelo Fluminense x Santos.</p>${logo}${foto}<p>Leia a <a href="https://exemplo.test/tabela">tabela do campeonato</a>.</p>`;
  const formulario = `<p style="text-align:left" class="noticia"><strong>Rádio Nacional</strong> transmite duelo Fluminense x Santos.</p>\n${logo}${foto}<p>Leia a <a href="https://exemplo.test/tabela">tabela do campeonato</a>.</p>`;
  const mock = await paginaLocal({ categoria:'Esportes', titulo:'Rádio Nacional transmite duelo Fluminense x Santos no Brasileirão', corpoHtml:visual });
  try {
    await mock.page.locator('#inp_text').evaluate((campo, html) => { campo.value = html; }, formulario);
    assert.equal((await lerPendencias(mock.page)).categoria, 'Esportes');
    assert.equal(await enviarMateria(mock.page, false), true);
    const enviado = new URLSearchParams(mock.ultimoPost()).get('text');
    assert.doesNotMatch(enviado, /logo-agenciabrasil\.svg/);
    assert.match(enviado, /fluminense-santos\.jpg/);
    assert.match(enviado, /Foto do jogo/);
    assert.match(enviado, /href="https:\/\/exemplo\.test\/tabela"/);
    assert.equal(new URLSearchParams(mock.ultimoPost()).get('category_id'), '2');
  } finally { await mock.context.close(); }
});

test('payload com categoria antiga é bloqueado antes de chegar ao servidor local', async () => {
  const mock = await paginaLocal({ categoria:'Esportes', titulo:'Observatório registra descoberta de novo planeta' });
  try {
    assert.equal((await lerPendencias(mock.page)).categoria, 'Geral');
    await mock.page.locator('form').evaluate(form => form.addEventListener('submit', () => {
      form.querySelector('[name="category_id"]').value = '2';
    }));
    let motivo = '';
    assert.equal(await enviarMateria(mock.page, false, aviso => { motivo = aviso; }), false);
    assert.equal(mock.envios(), 0);
    assert.match(motivo, /category_id/);
  } finally { await mock.context.close(); }
});

test('categoria ambígua ou Geral ausente mantém matéria para revisão', async () => {
  for (const opcoes of [
    { categoria:'Esportes', titulo:'Programação é anunciada', subtitulo:'Festival de teatro e torneio de atletas' },
    { categoria:'Esportes', titulo:'Observatório registra descoberta de novo planeta', geral:false }
  ]) {
    const mock = await paginaLocal(opcoes);
    try {
      const estado = await lerPendencias(mock.page);
      assert.equal(estado.conferenciaCategoria.revisar, true);
      assert.equal(await mock.page.locator('#inp_category_id').inputValue(), '2');
      assert.equal(await enviarMateria(mock.page, false), false);
      assert.equal(mock.envios(), 0);
    } finally { await mock.context.close(); }
  }
});

test('esporte legítimo fica em Esportes; chapéu ou foto ausente impedem o envio após correção', async () => {
  const esporte = await paginaLocal({ categoria:'Esportes', titulo:'Equipe de basquete conquista campeonato' });
  try {
    assert.equal((await lerPendencias(esporte.page)).categoria, 'Esportes');
    assert.equal(await enviarMateria(esporte.page, false), true);
    assert.equal(new URLSearchParams(esporte.ultimoPost()).get('category_id'), '2');
  } finally { await esporte.context.close(); }
  for (const opcoes of [{ valor:'' }, { foto:false }]) {
    const mock = await paginaLocal({ ...opcoes, categoria:'Esportes', titulo:'Observatório registra descoberta de novo planeta' });
    try {
      assert.equal((await lerPendencias(mock.page)).categoria, 'Geral');
      assert.equal(await enviarMateria(mock.page, false), false);
      assert.equal(mock.envios(), 0);
    } finally { await mock.context.close(); }
  }
});

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
      assert.deepEqual(await lerPendencias(page), { temChapeu: true, temImagem: true, categoria: '', conferenciaCategoria: { revisar: false, mensagem: '' } });
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
