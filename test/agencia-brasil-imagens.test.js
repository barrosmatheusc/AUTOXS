const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { analisarImagensAgenciaBrasil, prepararImagensAgenciaBrasil } = require('../agencia-brasil-imagens');
const { processarLote } = require('../autoxs');

let browser;
before(async () => { browser = await chromium.launch({ channel: 'msedge', headless: true }); });
after(async () => { await browser?.close(); });

async function paginaComCorpo(html) {
  const page = await browser.newPage();
  await page.setContent(`
    <form>
      <img id="imagem-destaque" src="/destaque.jpg" alt="Foto de destaque">
      <textarea id="inp_text" name="text" hidden></textarea>
      <a href="#" data-command="source.toggle">HTML</a>
      <div class="rx-editor" contenteditable="true"></div>
      <textarea class="rx-source" hidden></textarea>
    </form>
    <script>
      document.querySelector('a[data-command="source.toggle"]').addEventListener('click', event => {
        event.preventDefault();
        const visual = document.querySelector('.rx-editor');
        const fonte = document.querySelector('.rx-source');
        if (fonte.hidden) {
          fonte.value = visual.innerHTML;
          visual.hidden = true;
          fonte.hidden = false;
        } else {
          visual.innerHTML = fonte.value;
          document.querySelector('#inp_text').value = fonte.value;
          fonte.hidden = true;
          visual.hidden = false;
        }
      });
    </script>`);
  await page.locator('.rx-editor').evaluate((elemento, conteudo) => { elemento.innerHTML = conteudo; }, html);
  await page.locator('#inp_text').evaluate((elemento, conteudo) => { elemento.value = conteudo; }, html);
  return page;
}

const logo = '<img src="/uploads/logo-agencia-brasil.png" alt="Logotipo da Agência Brasil">';
const foto = '<figure><img src="/uploads/reportagem.jpg" alt="Foto: Agência Brasil"><figcaption>Registro da reportagem</figcaption></figure>';
const logoReal = '<figure data-rx-type="image"><a href="https://agenciabrasil.ebc.com.br/"><img src="/uploads/logo-agenciabrasil.svg" alt="Logo Agência Brasil"></a></figure>';

test('remove apenas logotipo inequívoco e preserva texto, link, formatação e destaque', async () => {
  const page = await paginaComCorpo(`<p><strong>Texto</strong> com <a href="https://exemplo.test/noticia">link</a>.</p>${logo}<p>Fim.</p>`);
  try {
    const resultado = await prepararImagensAgenciaBrasil(page);
    assert.deepEqual(resultado, { ok: true, removidas: 1 });
    const corpo = await page.locator('.rx-editor').innerHTML();
    assert.doesNotMatch(corpo, /logo-agencia-brasil/);
    assert.match(corpo, /<strong>Texto<\/strong>/);
    assert.match(corpo, /href="https:\/\/exemplo.test\/noticia"/);
    assert.match(corpo, /<p>Fim\.<\/p>/);
    assert.equal(await page.locator('#imagem-destaque').getAttribute('src'), '/destaque.jpg');
    assert.doesNotMatch(await page.locator('#inp_text').inputValue(), /logo-agencia-brasil/);
  } finally { await page.close(); }
});

test('autoria Agência Brasil sem logotipo não altera o corpo', async () => {
  const html = '<p>Agência Brasil publicou a matéria.</p>';
  const page = await paginaComCorpo(html);
  try {
    assert.deepEqual(await prepararImagensAgenciaBrasil(page), { ok: true, removidas: 0 });
    assert.equal(await page.locator('.rx-editor').innerHTML(), html);
  } finally { await page.close(); }
});

test('fotografia jornalística creditada à Agência Brasil permanece', async () => {
  const page = await paginaComCorpo(foto);
  try {
    assert.deepEqual(await prepararImagensAgenciaBrasil(page), { ok: true, removidas: 0 });
    assert.equal(await page.locator('.rx-editor img').count(), 1);
    assert.equal(await page.locator('figcaption').innerText(), 'Registro da reportagem');
  } finally { await page.close(); }
});

test('logotipo e fotografia juntos: retira somente o logotipo', async () => {
  const page = await paginaComCorpo(`${logo}${foto}`);
  try {
    assert.deepEqual(await prepararImagensAgenciaBrasil(page), { ok: true, removidas: 1 });
    assert.equal(await page.locator('.rx-editor img').count(), 1);
    assert.equal(await page.locator('.rx-editor img').getAttribute('src'), '/uploads/reportagem.jpg');
    assert.equal(await page.locator('#imagem-destaque').count(), 1);
  } finally { await page.close(); }
});

test('identificação ambígua não remove imagem e exige revisão manual', async () => {
  const html = '<p>Texto</p><img src="/uploads/agencia-brasil.jpg" alt="Agência Brasil">';
  const page = await paginaComCorpo(html);
  try {
    const resultado = await prepararImagensAgenciaBrasil(page);
    assert.equal(resultado.ok, false);
    assert.match(resultado.aviso, /revisão manual/i);
    assert.equal(await page.locator('.rx-editor').innerHTML(), html);
    assert.equal(await page.locator('#inp_text').inputValue(), html);
  } finally { await page.close(); }
});

test('sinal de logo dentro de picture não desmonta a estrutura da imagem', async () => {
  const page = await paginaComCorpo(`<picture><source srcset="/uploads/alternativa.jpg">${logo}</picture>`);
  try {
    const resultado = await prepararImagensAgenciaBrasil(page);
    assert.equal(resultado.ok, false);
    assert.equal(await page.locator('.rx-editor picture img').count(), 1);
  } finally { await page.close(); }
});

test('marcação desconhecida nunca é removida só pelo nome da autora', async () => {
  const page = await paginaComCorpo('<p>Agência Brasil</p><img src="/uploads/arquivo-desconhecido.jpg">');
  try {
    assert.deepEqual(await prepararImagensAgenciaBrasil(page), { ok: true, removidas: 0 });
    assert.equal(await page.locator('.rx-editor img').count(), 1);
  } finally { await page.close(); }
});

test('prévia classifica arquivo de logo e não confunde crédito de foto', async () => {
  const page = await paginaComCorpo('<p>Teste</p>');
  try {
    const resultado = await page.evaluate(analisarImagensAgenciaBrasil,
      '<img src="/uploads/agencia-brasil-logotipo.png"><img src="/uploads/retrato.jpg" alt="Foto: Agência Brasil">');
    assert.equal(resultado.removidas, 1);
    assert.match(resultado.html, /retrato.jpg/);
  } finally { await page.close(); }
});

test('reconhece logo-agenciabrasil.svg mesmo sem alt', async () => {
  const page = await paginaComCorpo('<img src="/uploads/logo-agenciabrasil.svg">');
  try {
    assert.deepEqual(await prepararImagensAgenciaBrasil(page), { ok: true, removidas: 1 });
    assert.equal(await page.locator('.rx-editor img').count(), 0);
  } finally { await page.close(); }
});

test('reconhece alt Logo Agência Brasil mesmo com arquivo de nome neutro', async () => {
  const page = await paginaComCorpo('<img src="/uploads/arquivo.svg" alt="Logo Agência Brasil">');
  try {
    assert.deepEqual(await prepararImagensAgenciaBrasil(page), { ok: true, removidas: 1 });
    assert.equal(await page.locator('.rx-editor img').count(), 0);
  } finally { await page.close(); }
});

test('remove figure do editor contendo somente o logotipo e seu link', async () => {
  const html = `<p><strong>Antes</strong> e <a href="https://exemplo.test/externo">link externo</a>.</p>${logoReal}<p>Depois.</p>`;
  const page = await paginaComCorpo(html);
  try {
    assert.deepEqual(await prepararImagensAgenciaBrasil(page), { ok: true, removidas: 1 });
    assert.equal(await page.locator('.rx-editor figure').count(), 0);
    assert.equal(await page.locator('.rx-editor a[href="https://agenciabrasil.ebc.com.br/"]').count(), 0);
    assert.match(await page.locator('.rx-editor').innerHTML(), /<strong>Antes<\/strong>.*href="https:\/\/exemplo.test\/externo".*<p>Depois\.<\/p>/);
    assert.equal(await page.locator('#imagem-destaque').getAttribute('src'), '/destaque.jpg');
  } finally { await page.close(); }
});

test('fotografia legítima no mesmo domínio não é removida', async () => {
  const html = '<figure data-rx-type="image"><a href="https://agenciabrasil.ebc.com.br/noticia"><img src="https://agenciabrasil.ebc.com.br/imagens/foto-reportagem.jpg" alt="Foto: Agência Brasil"></a></figure>';
  const page = await paginaComCorpo(html);
  try {
    assert.deepEqual(await prepararImagensAgenciaBrasil(page), { ok: true, removidas: 0 });
    assert.equal(await page.locator('.rx-editor figure img').count(), 1);
  } finally { await page.close(); }
});

test('figure com legenda ou conteúdo editorial adicional não é alterado automaticamente', async () => {
  const html = '<figure data-rx-type="image"><a href="https://agenciabrasil.ebc.com.br/"><img src="/uploads/logo-agenciabrasil.svg" alt="Logo Agência Brasil"></a><figcaption>Crédito editorial</figcaption></figure>';
  const page = await paginaComCorpo(html);
  try {
    const resultado = await prepararImagensAgenciaBrasil(page);
    assert.equal(resultado.ok, false);
    assert.match(resultado.aviso, /revisão manual/i);
    assert.equal(await page.locator('.rx-editor').innerHTML(), html);
    assert.equal(await page.locator('#inp_text').inputValue(), html);
    assert.equal(await page.locator('#imagem-destaque').getAttribute('src'), '/destaque.jpg');
  } finally { await page.close(); }
});

test('lote não tenta enviar se faltar chapéu ou imagem destacada', async () => {
  const materias = [1, 2, 3].map(id => ({ titulo: `Matéria ${id}`, url: `https://exemplo.test/${id}` }));
  const estados = [{ temChapeu: false, temImagem: true }, { temChapeu: true, temImagem: false }, { temChapeu: true, temImagem: true }];
  const enviadas = [];
  await processarLote(materias, {
    abrir: async materia => ({ id: Number(materia.titulo.at(-1)), close: async () => {} }),
    ler: async aba => estados[aba.id - 1],
    enviar: async aba => { enviadas.push(aba.id); return true; },
    pesquisar: async () => {}, log: async () => {}
  });
  assert.deepEqual(enviadas, [3]);
});
