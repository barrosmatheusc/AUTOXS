const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { criarPainelManual } = require('../painel-manual');
const { criarPainelProducao } = require('../painel-producao');
const { criarHistoricoProducao } = require('../historico-producao');

let browser;
before(async () => { browser = await chromium.launch({ channel:'msedge', headless:true }); });
after(async () => { await browser?.close(); });

test('painel local mostra estatísticas, compartilháveis, responsáveis e relatório', async () => {
  const page = await browser.newPage({ viewport:{ width:880, height:700 } });
  const url = 'https://www.tribunadosertao.com.br/cidades/2026/10/15/1234-noticia';
  const item = { id:'item-1', titulo:'Notícia', concluidoEm:'2026-10-15T15:00:00Z', urlOriginal:url, responsavelId:null };
  let escolhido = null;
  await page.exposeFunction('operacaoProducao', async ({ acao, responsavelId }) => {
      if (acao === 'consultar') return { ok:true, resultado:{
        estatisticas:{ concluidas:1, atualizacoesAutomaticas:0, finalizadasManualmente:1, adicionadas:1, aguardandoRevisao:0, erros:0 },
        compartilh:[{ ...item, responsavelId:escolhido }],
        responsaveis:[{ id:'inicial-1', nome:'Vladimir', ativo:true }, { id:'inicial-2', nome:'Cinara', ativo:true }]
      } };
      if (acao === 'relatorio') return { ok:true, resultado:{ texto:'LINKS VLADIMIR\n\n'+url, semResponsavel:[], semUrl:[] } };
      if (acao === 'responsavel') { escolhido=responsavelId; return {ok:true,resultado:{}}; }
      if (acao === 'compartilhavel') return {ok:true,resultado:'*Notícia*\n\n'+url};
      return {ok:true,resultado:{}};
  });
  try {
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'painel-producao.html')).href);
    await page.getByText('Matérias concluídas').waitFor();
    await page.getByRole('button', { name:'Seleção de Links', exact:true }).click();
    await page.getByRole('heading', { name:'Notícia' }).waitFor();
    assert.equal(await page.locator('.materia-detalhes').isHidden(), false);
    await page.getByRole('group', { name:'Responsável por Notícia' }).getByRole('button', { name:'Vladimir' }).click();
    await page.getByRole('button', { name:'Expandir Notícia' }).waitFor();
    assert.equal(await page.locator('.materia-detalhes').isHidden(), true);
    assert.match(await page.locator('.materia-cabecalho').innerText(), /Notícia\s+Vladimir/);
    await page.getByRole('button', { name:'Expandir Notícia' }).click();
    assert.equal(await page.getByRole('group', { name:'Responsável por Notícia' }).getByRole('button', { name:'Vladimir' }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name:'Desfazer seleção' }).click();
    await page.waitForFunction(() => document.querySelector('.materia-cabecalho')?.textContent?.trim() === 'Notícia');
    assert.equal(await page.locator('.materia-detalhes').isHidden(), false);
    await page.getByRole('group', { name:'Responsável por Notícia' }).getByRole('button', { name:'Cinara' }).click();
    await page.getByRole('button', { name:'Expandir Notícia' }).waitFor();
    assert.match(await page.locator('.materia-cabecalho').innerText(), /Cinara/);
    await page.locator('#alternar-materias').click();
    assert.equal(await page.locator('.materia-detalhes').isHidden(), false);
    await page.locator('#alternar-materias').click();
    assert.equal(await page.locator('.materia-detalhes').isHidden(), true);
    await page.getByRole('button', { name:'Relatório de Links', exact:true }).click();
    assert.match(await page.locator('#texto-relatorio').innerText(), /LINKS VLADIMIR/);
  } finally { await page.close(); }
});

test('container independente mostra dia e total de oito dias por responsável', async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'autoxs-contagem-painel-'));
  const arquivo = path.join(pasta, 'historico-autoxs.json');
  const context = await browser.newContext();
  const historico = criarHistoricoProducao(arquivo, () => new Date('2026-10-15T15:00:00.000Z'));
  try {
    const pessoa = await historico.cadastrarResponsavel('Email');
    const item = await historico.registrar({ operacao:'adicionar', chave:'uma', titulo:'Notícia',
      situacao:'concluido', formaConclusao:'manual' });
    await historico.responsavel(item.id, pessoa.id);
    const page = await criarPainelProducao(context, historico).abrir('estatisticas');
    await page.locator('#data').fill('2026-10-15');
    await page.locator('#data').dispatchEvent('change');
    await page.waitForFunction(() => document.querySelector('#total-dia')?.textContent === '1');
    assert.match(await page.locator('#contagem-dia').innerText(), /Email: 1 matéria/);
    assert.equal(await page.locator('#total-periodo').innerText(), '1');
    await page.getByRole('button', { name:'Seleção de Links' }).click();
    assert.equal(await page.locator('#materias-responsavel').isHidden(), true);
  } finally {
    await context.close();
    await fs.rm(pasta, { recursive:true, force:true });
  }
});

test('atalhos do painel inicial abrem a produção sem substituir os controles principais', async () => {
  const context = await browser.newContext({ viewport:{ width:390, height:740 } });
  const historico = {
    consultar:async()=>({ estatisticas:{ concluidas:0, atualizacoesAutomaticas:0, finalizadasManualmente:0, adicionadas:0, aguardandoRevisao:0, erros:0 }, compartilh:[], responsaveis:[] }),
    materiasPorResponsavel:async()=>({ dia:{total:0,grupos:[]}, periodo:{total:0,grupos:[]} }),
    relatorio:async()=>({ texto:'', semResponsavel:[], semUrl:[], duplicados:[] })
  };
  try {
    const inicial = await criarPainelManual(context, async()=>({ abertas:0, enviadas:0, pendentes:0, erros:0 }), null, undefined, historico);
    assert.equal(await inicial.getByRole('button', { name:'Atualizar', exact:true }).count(), 1);
    assert.equal(await inicial.getByRole('button', { name:'Adicionar matérias', exact:true }).count(), 1);
    const abertura = context.waitForEvent('page');
    await inicial.getByRole('button', { name:'Estatísticas', exact:true }).click();
    const producao = await abertura;
    await producao.getByText('Matérias concluídas').waitFor();
    const posicao = await inicial.locator('.atalhos-producao').evaluate(elemento => getComputedStyle(elemento).position);
    assert.equal(posicao, 'static');
  } finally { await context.close(); }
});

test('Responsáveis inicia recolhido; expandir, cancelar e confirmar remoção preservam atribuição', async () => {
  const page = await browser.newPage({ viewport:{ width:390, height:740 } });
  const pessoa = { id:'inicial-1', nome:'Vladimir', ativo:true };
  let remocoes = 0;
  await page.exposeFunction('operacaoProducao', async ({ acao }) => {
    if (acao === 'consultar') return { ok:true, resultado:{
      estatisticas:{ concluidas:1, atualizacoesAutomaticas:0, finalizadasManualmente:1,
        adicionadas:1, aguardandoRevisao:0, erros:0 },
      compartilh:[{ id:'materia-1', titulo:'Notícia', concluidoEm:'2026-10-15T15:00:00Z',
        urlOriginal:'https://www.tribunadosertao.com.br/cidades/2026/10/15/1234-noticia',
        responsavelId:pessoa.id }], responsaveis:[pessoa]
    } };
    if (acao === 'relatorio') return { ok:true, resultado:{ texto:'', semResponsavel:[], semUrl:[] } };
    if (acao === 'removerResponsavel') {
      remocoes++; pessoa.ativo=false; pessoa.removido=true;
      return { ok:true, resultado:{ ...pessoa } };
    }
    return { ok:true, resultado:{} };
  });
  try {
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'painel-producao.html')).href);
    await page.getByRole('button', { name:'Seleção de Links' }).click();
    const alternar = page.locator('#alternar-responsaveis');
    await page.waitForFunction(() => document.querySelector('#quantidade-responsaveis')?.textContent === '1 nome');
    assert.equal(await alternar.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#conteudo-responsaveis').isHidden(), true);
    await alternar.click();
    assert.equal(await alternar.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const remover = page.locator('#gestao').getByRole('button', { name:/Remover/ });
    await remover.waitFor();
    await remover.click();
    await page.getByRole('button', { name:'Cancelar', exact:true }).click();
    assert.equal(remocoes, 0);
    await remover.waitFor();
    await remover.click();
    await page.getByRole('button', { name:'Confirmar remoção' }).click();
    await page.waitForFunction(() => !document.querySelector('#gestao input[aria-label="Nome de Vladimir"]'));
    assert.equal(remocoes, 1);
    assert.match(await page.locator('#status').innerText(), /Vladimir removido/);
    await page.getByRole('button', { name:'Expandir Notícia' }).click();
    assert.equal(await page.getByRole('group', { name:'Responsável por Notícia' })
      .getByRole('button', { name:'Vladimir' }).isDisabled(), true);
    await alternar.click();
    assert.equal(await page.locator('#conteudo-responsaveis').isHidden(), true);
    assert.equal(await page.locator('#quantidade-responsaveis').innerText(), '0 nomes');
  } finally { await page.close(); }
});

test('falha ao gravar remoção exibe erro e mantém o nome', async () => {
  const page = await browser.newPage();
  await page.exposeFunction('operacaoProducao', async ({ acao }) => {
    if (acao === 'consultar') return { ok:true, resultado:{
      estatisticas:{ concluidas:0, atualizacoesAutomaticas:0, finalizadasManualmente:0,
        adicionadas:0, aguardandoRevisao:0, erros:0 },
      compartilh:[], responsaveis:[{ id:'inicial-1', nome:'Vladimir', ativo:true }]
    } };
    if (acao === 'relatorio') return { ok:true, resultado:{ texto:'', semResponsavel:[], semUrl:[] } };
    if (acao === 'removerResponsavel') return { ok:false, mensagem:'Falha ao gravar histórico.' };
    return { ok:true, resultado:{} };
  });
  try {
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'painel-producao.html')).href);
    await page.getByRole('button', { name:'Seleção de Links' }).click();
    await page.locator('#alternar-responsaveis').click();
    await page.locator('#gestao').getByRole('button', { name:/Remover/ }).click();
    await page.getByRole('button', { name:'Confirmar remoção' }).click();
    await page.getByText('Falha ao gravar histórico.').waitFor();
    assert.equal(await page.locator('#gestao input[aria-label="Nome de Vladimir"]').count(), 1);
  } finally { await page.close(); }
});

test('botão real comunica com o processo principal e persiste após reabrir o histórico', async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'autoxs-remocao-painel-'));
  const arquivo = path.join(pasta, 'historico-autoxs.json');
  const context = await browser.newContext();
  try {
    const historico = criarHistoricoProducao(arquivo);
    const painel = criarPainelProducao(context, historico);
    const page = await painel.abrir('compartilhaveis');
    await page.locator('#alternar-responsaveis').click();
    await page.locator('#gestao').getByRole('button', { name:/Remover/ }).first().click();
    await page.getByRole('button', { name:'Confirmar remoção' }).click();
    await page.getByText('Vladimir removido dos responsáveis.').waitFor();
    const reaberto = criarHistoricoProducao(arquivo);
    const estado = await reaberto.consultar();
    assert.equal(estado.responsaveis.find(item => item.id === 'inicial-1').removido, true);
    assert.equal(await page.locator('#gestao input[aria-label="Nome de Vladimir"]').count(), 0);
  } finally {
    await context.close();
    await fs.rm(pasta, { recursive:true, force:true });
  }
});
