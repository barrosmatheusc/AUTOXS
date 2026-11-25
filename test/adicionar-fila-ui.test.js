const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { instalarCaptura } = require('../captura-ponte');

const materia = numero => `INÍCIO DA MATÉRIA ${numero}\nTÍTULO: Matéria da fila ${numero}\nCHAPÉU: CHAPÉU ${numero}\nBIGODE: Bigode ${numero}\nAUTOR: Autor ${numero}\nCATEGORIA: Geral\nLEGENDA: Legenda ${numero}\nCRÉDITOS DA FOTO: Crédito ${numero}\nTEXTO: Corpo completo ${numero}.\nFIM DA MATÉRIA ${numero}`;

async function ambiente(t, nome) {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), nome));
  t.after(() => fs.rm(pasta, { recursive:true, force:true }));
  const navegador = await chromium.launch({ channel:'msedge', headless:true });
  t.after(() => navegador.close());
  const contexto = await navegador.newContext({ viewport:{ width:1400, height:900 } });
  contexto.setDefaultTimeout(60000);
  await instalarCaptura(contexto, pasta);
  const pagina = await contexto.newPage();
  await pagina.goto(pathToFileURL(path.join(__dirname, '..', 'adicionar-painel.html')).href);
  return pagina;
}

async function importar(pagina, quantidade) {
  const primeiro = pagina.locator('.editor-materia').first();
  await primeiro.getByLabel('Texto recebido', { exact:true }).fill(Array.from({ length:quantidade }, (_, i) => materia(i + 1)).join('\n\n'));
  await primeiro.getByRole('button', { name:'Identificar campos', exact:true }).click();
  await pagina.waitForFunction(q => document.querySelectorAll('.item-fila').length === q, Math.max(0, quantidade - 4));
}

test('dez matérias ocupam quatro painéis e deixam seis visíveis na fila', async t => {
  const pagina = await ambiente(t, 'autoxs-fila-dez-');
  await importar(pagina, 10);
  assert.equal(await pagina.locator('.editor-materia').count(), 4);
  assert.equal(await pagina.locator('[data-campo="titulo"] .valor').count(), 4);
  assert.equal(await pagina.locator('.item-fila').count(), 6);
  assert.deepEqual(await pagina.locator('.item-fila h3').allTextContents(),
    ['Matéria da fila 5','Matéria da fila 6','Matéria da fila 7','Matéria da fila 8','Matéria da fila 9','Matéria da fila 10']);
});

test('fila permite visualizar metadados, reordenar, remover e carregar item escolhido', async t => {
  const pagina = await ambiente(t, 'autoxs-fila-controles-');
  await importar(pagina, 6);
  let itemSeis = pagina.locator('.item-fila').filter({ hasText:'Matéria da fila 6' });
  await itemSeis.getByRole('button', { name:'Visualizar' }).click();
  assert.match(await itemSeis.locator('.detalhes-fila').textContent(), /Legenda 6/);
  assert.match(await itemSeis.locator('.detalhes-fila').textContent(), /Crédito 6/);
  await itemSeis.getByRole('button', { name:'↑' }).click();
  await pagina.waitForFunction(() => document.querySelector('.item-fila h3')?.textContent === 'Matéria da fila 6');
  const itemCinco = pagina.locator('.item-fila').filter({ hasText:'Matéria da fila 5' });
  await itemCinco.getByRole('button', { name:'Remover' }).click();
  assert.equal(await itemCinco.getByText('Remover somente esta matéria da fila?').isVisible(), true);
  await itemCinco.getByRole('button', { name:'Sim, remover' }).click();
  await pagina.waitForFunction(() => ![...document.querySelectorAll('.item-fila h3')].some(el => el.textContent === 'Matéria da fila 5'));
  await pagina.locator('.editor-materia').first().getByRole('button', { name:'Nova matéria' }).click();
  itemSeis = pagina.locator('.item-fila').filter({ hasText:'Matéria da fila 6' });
  await itemSeis.getByRole('button', { name:'Carregar no painel' }).click();
  await pagina.waitForFunction(() => [...document.querySelectorAll('[data-campo="titulo"] .valor')].some(el => el.textContent === 'Matéria da fila 6'));
  await pagina.waitForFunction(() => ![...document.querySelectorAll('.item-fila h3')].some(el => el.textContent === 'Matéria da fila 6'));
  assert.equal(await pagina.locator('.item-fila').filter({ hasText:'Matéria da fila 6' }).count(), 0);
});

test('falha ao enviar não apaga matéria nem permite duplicação de painel', async t => {
  const pagina = await ambiente(t, 'autoxs-fila-falha-');
  await importar(pagina, 5);
  await pagina.locator('.editor-materia').first().getByRole('button', { name:'Nova matéria' }).click();
  const item = pagina.locator('.item-fila').filter({ hasText:'Matéria da fila 5' });
  await item.getByRole('button', { name:'Enviar ao site' }).click();
  await pagina.waitForFunction(() => [...document.querySelectorAll('[data-campo="titulo"] .valor')].some(el => el.textContent === 'Matéria da fila 5'));
  await pagina.waitForFunction(() => [...document.querySelectorAll('[data-estado-painel="erro"]')].some(el => el.textContent === 'Erro'));
  assert.equal(await pagina.locator('[data-campo="titulo"] .valor').filter({ hasText:'Matéria da fila 5' }).count(), 1);
  const estado = await pagina.evaluate(() => window.capturaAutoXS({ acao:'listar' }));
  assert.notEqual(estado.rascunhos.find(item => item.campos.titulo === 'Matéria da fila 5').status, 'descartado');
});
