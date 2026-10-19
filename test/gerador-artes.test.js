const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { criarPainelManual } = require('../painel-manual');

let browser;
before(async () => { browser = await chromium.launch({ channel:'msedge', headless:true }); });
after(async () => { await browser?.close(); });

async function abrir() {
  const context = await browser.newContext({ acceptDownloads:true });
  const painel = await criarPainelManual(context, async () => {
    throw new Error('Atualização editorial não deve ser iniciada pelo gerador.');
  });
  await painel.getByRole('button', { name:'Gerador de Artes' }).click();
  await painel.waitForFunction(() => !document.querySelector('#gerador-artes').disabled);
  const gerador = context.pages().find(page => page !== painel);
  assert.ok(gerador, await painel.locator('#status').textContent());
  await gerador.getByRole('heading', { name:'Gerador de Artes' }).waitFor();
  return { context, painel, gerador };
}

async function carregarFoto(gerador) {
  const base64 = await gerador.evaluate(() => {
    const teste = document.createElement('canvas');
    teste.width = 1600; teste.height = 900;
    const pincel = teste.getContext('2d');
    const degradê = pincel.createLinearGradient(0, 0, 1600, 900);
    degradê.addColorStop(0, '#e23b35'); degradê.addColorStop(1, '#1d67d4');
    pincel.fillStyle = degradê; pincel.fillRect(0, 0, 1600, 900);
    return teste.toDataURL('image/png').split(',')[1];
  });
  await gerador.locator('#foto').setInputFiles({ name:'foto-de-teste.png', mimeType:'image/png',
    buffer:Buffer.from(base64, 'base64') });
  await gerador.waitForFunction(() => !document.querySelector('#aviso').textContent.includes('Escolha uma fotografia'));
}

test('painel abre e reutiliza o Gerador de Artes sem iniciar automação editorial', async () => {
  const { context, painel, gerador } = await abrir();
  try {
    assert.match(gerador.url(), /gerador-artes\.html$/);
    assert.equal(await gerador.locator('canvas').getAttribute('width'), '1080');
    assert.equal(await gerador.locator('canvas').getAttribute('height'), '1350');
    await painel.getByRole('button', { name:'Gerador de Artes' }).click();
    assert.equal(context.pages().length, 2);
    assert.equal(await painel.getByRole('button', { name:'Atualizar', exact:true }).isEnabled(), true);
  } finally { await context.close(); }
});

test('foto, enquadramento e textos atualizam a mesma prévia sem deslocar elementos fixos', async () => {
  const { context, gerador } = await abrir();
  try {
    await carregarFoto(gerador);
    await gerador.locator('#chapeu').fill('Política');
    await gerador.locator('#titulo').fill('Hugo Wanderley e Dr. Wanderley emergem das urnas como nova força política');
    assert.equal(await gerador.locator('#exportar').isEnabled(), true);
    await gerador.locator('#arte').screenshot({ path:path.join(__dirname, '..', 'work', 'gerador-artes-previa.png') });
    const antes = await gerador.locator('#arte').evaluate(canvas => canvas.toDataURL());
    await gerador.locator('#zoom').fill('1.4');
    await gerador.locator('#posicao-x').fill('60');
    await gerador.locator('#posicao-y').fill('-40');
    const depois = await gerador.locator('#arte').evaluate(canvas => canvas.toDataURL());
    assert.notEqual(depois, antes);
    const fixos = await gerador.locator('#arte').evaluate(canvas => {
      const c = canvas.getContext('2d');
      const amostra = (x,y) => [...c.getImageData(x,y,1,1).data];
      return { faixa:amostra(10,200), rodape:amostra(500,1300), foto:amostra(500,200) };
    });
    assert.deepEqual(fixos.faixa.slice(0,3), [3,158,56]);
    assert.deepEqual(fixos.rodape.slice(0,3), [0,0,0]);
    assert.notDeepEqual(fixos.foto.slice(0,3), [255,116,31]);
    const caixa = await gerador.locator('#arte').boundingBox();
    await gerador.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
    await gerador.mouse.down();
    await gerador.mouse.move(caixa.x + caixa.width / 2 + 65, caixa.y + caixa.height / 2 + 35, { steps:5 });
    await gerador.mouse.up();
    assert.notEqual(await gerador.locator('#posicao-x').inputValue(), '60');
    await gerador.locator('#restaurar').click();
    assert.equal(await gerador.locator('#zoom').inputValue(), '1');
    assert.equal(await gerador.locator('#posicao-x').inputValue(), '0');
    assert.equal(await gerador.locator('#posicao-y').inputValue(), '0');
    await gerador.locator('#foto').setInputFiles({ name:'arquivo.txt', mimeType:'text/plain', buffer:Buffer.from('inválido') });
    assert.equal(await gerador.locator('#exportar').isDisabled(), true);
    assert.match(await gerador.locator('#aviso').textContent(), /JPG, PNG ou WebP/);
  } finally { await context.close(); }
});

test('título excessivo impede exportação e PNG válido tem resolução final', async () => {
  const { context, gerador } = await abrir();
  try {
    await carregarFoto(gerador);
    await gerador.locator('#chapeu').fill('Política');
    await gerador.locator('#titulo').fill('Uma notícia importante ' .repeat(35));
    assert.equal(await gerador.locator('#exportar').isDisabled(), true);
    assert.match(await gerador.locator('#aviso').textContent(), /longo demais|ultrapassa/i);
    await gerador.locator('#titulo').fill('Notícia de teste para a arte');
    assert.equal(await gerador.locator('#exportar').isEnabled(), true);
    const download = gerador.waitForEvent('download');
    await gerador.locator('#exportar').click();
    const arquivo = await download;
    assert.match(arquivo.suggestedFilename(), /\.png$/);
    const fs = require('node:fs/promises');
    const bytes = await fs.readFile(await arquivo.path());
    assert.equal(bytes.toString('hex',0,8), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), 1080);
    assert.equal(bytes.readUInt32BE(20), 1350);
  } finally { await context.close(); }
});
