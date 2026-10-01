const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { criarPainelManual } = require('../painel-manual');
const { obterOuAbrirMateria } = require('../autoxs');
let browser;
before(async () => { browser = await chromium.launch({ channel: 'msedge', headless: true }); });
after(async () => { await browser?.close(); });

test('painel inicia parado, bloqueia rodadas simultâneas e permite atualizar novamente', async () => {
  const context = await browser.newContext({ viewport: { width: 1100, height: 820 } });
  let chamadas = 0;
  let liberar;
  const espera = new Promise(resolve => { liberar = resolve; });
  const painel = await criarPainelManual(context, async progresso => {
    chamadas++;
    await progresso('Chapéu conferido.');
    if (chamadas === 1) await espera;
    return { abertas: 5, enviadas: 2, pendentes: 3, erros: 0 };
  });
  try {
    assert.equal(chamadas, 0);
    assert.equal(await painel.locator('h1').textContent(), 'Vamos atualizar?');
    await painel.screenshot({ path: path.join(__dirname, '..', 'work', 'painel-inicial.png') });
    await painel.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await painel.getByRole('button', { name: 'Atualizando…' }).waitFor();
    assert.equal(await painel.locator('#atualizar').isDisabled(), true);
    const concorrente = await painel.evaluate(() => window.atualizarMaterias());
    assert.equal(concorrente.ok, false);
    assert.equal(chamadas, 1);
    liberar();
    await painel.getByRole('button', { name: 'Atualizar', exact: true }).waitFor();
    assert.equal(await painel.locator('h1').textContent(), 'Vamos atualizar?');
    assert.equal(await painel.locator('#enviadas').textContent(), '2');
    assert.equal(await painel.locator('#pendentes').textContent(), '3');
    await painel.screenshot({ path: path.join(__dirname, '..', 'work', 'painel-concluido.png') });
    await painel.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await painel.getByRole('button', { name: 'Atualizar', exact: true }).waitFor();
    assert.equal(chamadas, 2);
  } finally { await context.close(); }
});

test('falha mostra aviso simples e libera uma nova tentativa', async () => {
  const context = await browser.newContext();
  const painel = await criarPainelManual(context, async () => { throw new Error('Detalhe técnico privado'); });
  try {
    await painel.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await painel.waitForFunction(() => document.querySelector('#etapa').textContent.includes('atenção'));
    assert.equal(await painel.locator('#atualizar').isEnabled(), true);
    assert.equal((await painel.locator('body').textContent()).includes('Detalhe técnico privado'), false);
  } finally { await context.close(); }
});

test('rodada seguinte reutiliza a aba e preserva preenchimento ainda não salvo', async () => {
  const context = await browser.newContext();
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<input name="hat">' }));
  const lista = await context.newPage();
  const cargas = new WeakMap();
  const materia = { url: 'http://manual.test/news/edit/1' };
  try {
    const primeira = await obterOuAbrirMateria(context, lista, materia, cargas);
    await cargas.get(primeira);
    await primeira.locator('input').fill('Preenchimento manual');
    const segunda = await obterOuAbrirMateria(context, lista, materia, cargas);
    assert.equal(primeira, segunda);
    assert.equal(context.pages().length, 2);
    assert.equal(await segunda.locator('input').inputValue(), 'Preenchimento manual');
  } finally { await context.close(); }
});