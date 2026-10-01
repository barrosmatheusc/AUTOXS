const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { mostrarAjudaFotos } = require('../ajuda-fotos');
const { sugerirTermosBusca } = require('../termo-busca');
let browser;
before(async () => { browser = await chromium.launch({ channel: 'msedge', headless: true }); });
after(async () => { await browser?.close(); });

test('sugere siglas, nomes compostos e palavras alternativas sem duplicatas', () => {
  const termos = sugerirTermosBusca('OAB-SP e entidades reivindicam transparência no STF e reforma do Judiciário');
  assert.equal(termos[0], 'OAB-SP');
  for (const termo of ['STF', 'transparência', 'Judiciário']) assert.ok(termos.includes(termo));
  assert.ok(sugerirTermosBusca('Jão tieta Elton John no Rock in Rio').includes('Elton John'));
  assert.equal(new Set(termos.map(t => t.toLowerCase())).size, termos.length);
  assert.ok(termos.length <= 12);
  assert.deepEqual(sugerirTermosBusca(''), []);
});

async function prepararPagina(context) {
  const page = await context.newPage();
  await page.setContent(`<html lang="pt-BR"><head><meta charset="utf-8"><style>
    body { background:#15221a; font:15px Arial; color:#e7eee9; }
    dialog { width:90vw; height:85vh; background:#19211d; color:#e7eee9; border:1px solid #64776b; border-radius:10px; padding:25px; }
    .grade { display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:30px; }
    .foto { height:130px;background:linear-gradient(135deg,#314c3c,#5d7d64);border-radius:6px;display:grid;place-items:center;color:#d6e7da; }
    input,select { padding:8px; }
  </style></head><body>
    <form onsubmit="event.preventDefault();window.enviou=true"><button>Enviar matéria</button></form>
    <dialog aria-label="Imagem de Destaque"><h2>Imagem de Destaque</h2>
      <label>Exibir <select id="quantidade"><option>100</option></select> fotos</label>
      <form onsubmit="event.preventDefault();window.buscou=document.querySelector('#pesquisa').value;document.querySelector('#resultado').textContent='Resultados para: '+window.buscou;">
        <label for="pesquisa">Pesquisar:</label><input type="search" id="pesquisa" value="OAB-SP"><button>Pesquisar</button>
      </form>
      <p id="resultado">Resultados para: OAB-SP</p>
      <div class="grade">${Array.from({length:12},(_,i)=>`<div class="foto">Foto ${i+1}</div>`).join('')}</div>
      <button type="button" onclick="document.querySelector('dialog').close()">Fechar</button>
    </dialog><script>document.querySelector('dialog').showModal();</script>
  </body></html>`);
  return page;
}

test('janela monta a busca ao clicar ou digitar e preserva o limite de 100 fotos', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let acessos = 0;
  await context.route('**/*', async route => { acessos++; await route.abort(); });
  try {
    const page = await prepararPagina(context);
    const dialog = page.getByRole('dialog', { name: 'Imagem de Destaque' });
    const titulo = 'OAB-SP e entidades reivindicam transparência no STF e reforma do Judiciário';
    const subtitulo = 'Entidades defendem medidas para ampliar a transparência e a participação da sociedade no Judiciário.';
    await mostrarAjudaFotos(page, dialog, titulo, { subtitulo });
    const janela = page.locator('#manual-ajuda-fotos');
    assert.equal(await janela.locator('#titulo').textContent(), titulo);
    assert.equal(await janela.locator('#subtitulo').textContent(), subtitulo);
    await janela.getByRole('button', { name: 'STF', exact: true }).click();
    await janela.getByRole('button', { name: 'Buscar', exact: true }).click();
    await page.waitForFunction(() => window.buscou === 'STF');
    assert.equal(await page.locator('#pesquisa').inputValue(), 'STF');
    await janela.getByRole('textbox', { name: 'Outro termo para buscar fotos' }).fill('Justiça brasileira');
    await janela.getByRole('button', { name: 'Buscar', exact: true }).click();
    await page.waitForFunction(() => window.buscou === 'Justiça brasileira');
    assert.equal(await page.locator('#quantidade').inputValue(), '100');
    assert.equal(await page.evaluate(() => Boolean(window.enviou)), false);
    assert.equal(acessos, 0);
    await mostrarAjudaFotos(page, dialog, titulo, { subtitulo });
    assert.equal(await page.locator('#manual-ajuda-fotos').count(), 1);
    assert.equal(await page.locator('#pesquisa').inputValue(), 'Justiça brasileira');
    await page.screenshot({ path: path.join(__dirname, '..', 'work', 'ajuda-fotos-preview.png') });
  } finally { await context.close(); }
});

test('busca padrão exibe palavras do título e bigode e permite retirar a seleção', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let acessos = 0;
  await context.route('**/*', async route => { acessos++; await route.abort(); });
  try {
    const page = await prepararPagina(context);
    await mostrarAjudaFotos(page, page.getByRole('dialog', { name: 'Imagem de Destaque' }),
      'Mathes acaba de ganhar uma bola de ouro na cidade de Paris',
      { subtitulo: 'Prêmio reconhece o atleta na cidade francesa.' });
    const janela = page.locator('#manual-ajuda-fotos');
    assert.equal(await janela.getByRole('button', { name: /^Modelo [12]$/ }).count(), 0);
    assert.equal(await janela.locator('.sugestoes').count(), 0);
    const palavrasTitulo = janela.getByRole('group', { name: 'Palavras do título', exact: true });
    const palavrasBigode = janela.getByRole('group', { name: 'Palavras do subtítulo', exact: true });
    assert.equal(await palavrasTitulo.isVisible(), true);
    assert.equal(await palavrasBigode.isVisible(), true);
    assert.equal(await palavrasTitulo.getByRole('button').count(), 12);
    await palavrasTitulo.getByRole('button', { name: 'Mathes', exact: true }).click();
    await palavrasTitulo.getByRole('button', { name: 'Paris', exact: true }).click();
    await palavrasBigode.getByRole('button', { name: 'Prêmio', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#pesquisa').value === 'Mathes Paris Prêmio');
    const campo = janela.getByRole('textbox', { name: 'Outro termo para buscar fotos' });
    assert.equal(await campo.inputValue(), 'Mathes Paris Prêmio');
    assert.equal(await palavrasTitulo.getByRole('button', { name: 'Mathes', exact: true }).getAttribute('aria-pressed'), 'true');
    await palavrasTitulo.getByRole('button', { name: 'Mathes', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#pesquisa').value === 'Paris Prêmio');
    assert.equal(await campo.inputValue(), 'Paris Prêmio');
    assert.equal(await palavrasTitulo.getByRole('button', { name: 'Mathes', exact: true }).getAttribute('aria-pressed'), 'false');
    await janela.getByRole('button', { name: 'Buscar', exact: true }).click();
    await page.waitForFunction(() => window.buscou === 'Paris Prêmio');
    await janela.getByRole('button', { name: 'Limpar seleção', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#pesquisa').value === '');
    assert.equal(await campo.inputValue(), '');
    assert.equal(await janela.locator('.palavra[aria-pressed="true"]').count(), 0);
    assert.equal(await palavrasTitulo.isVisible(), true);
    assert.equal(await palavrasBigode.isVisible(), true);
    assert.equal(await page.locator('#quantidade').inputValue(), '100');
    assert.equal(await page.evaluate(() => Boolean(window.enviou)), false);
    assert.equal(acessos, 0);
  } finally { await context.close(); }
});

test('janela pode ser arrastada, movida pelo teclado e minimizada', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await prepararPagina(context);
    await mostrarAjudaFotos(page, page.getByRole('dialog'), 'Lula discursa no Planalto');
    const janela = page.locator('#manual-ajuda-fotos');
    const antes = await janela.boundingBox();
    const cabecalho = await janela.locator('.mover').boundingBox();
    await page.mouse.move(cabecalho.x + 50, cabecalho.y + 15);
    await page.mouse.down();
    await page.mouse.move(cabecalho.x - 150, cabecalho.y + 85, { steps: 8 });
    await page.mouse.up();
    const depois = await janela.boundingBox();
    assert.ok(depois.x < antes.x - 100);
    assert.ok(depois.y > antes.y + 40);
    await janela.locator('.mover').focus();
    await page.keyboard.press('ArrowLeft');
    assert.ok((await janela.boundingBox()).x < depois.x);
    await janela.getByRole('button', { name: 'Minimizar sugestões' }).click();
    assert.equal(await janela.locator('.conteudo').isVisible(), false);
    await janela.getByRole('button', { name: 'Expandir sugestões' }).click();
    assert.equal(await janela.locator('.conteudo').isVisible(), true);
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    assert.equal(await janela.isVisible(), false);
  } finally { await context.close(); }
});

test('título é exibido como texto sem interpretar marcação', async () => {
  const context = await browser.newContext();
  try {
    const page = await prepararPagina(context);
    const titulo = '<img src=x onerror="window.executou=true"> Título da matéria';
    await mostrarAjudaFotos(page, page.getByRole('dialog'), titulo, { subtitulo: titulo });
    assert.equal(await page.locator('#manual-ajuda-fotos').locator('#titulo').textContent(), titulo);
    assert.equal(await page.locator('#manual-ajuda-fotos').locator('#subtitulo').textContent(), titulo);
    assert.equal(await page.evaluate(() => Boolean(window.executou)), false);
    await mostrarAjudaFotos(page, page.getByRole('dialog'), 'Novo título');
    assert.equal(await page.locator('#manual-ajuda-fotos').locator('#subtitulo').textContent(), 'Sem subtítulo');
  } finally { await context.close(); }
});
