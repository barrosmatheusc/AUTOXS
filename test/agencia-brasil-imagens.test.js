const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { analisarImagensAgenciaBrasil, compararCorposAgenciaBrasil, prepararImagensAgenciaBrasil, extrairHtmlRequisicao } = require('../agencia-brasil-imagens');
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
const logoSemTipo = '<figure style="text-align: center;"><a href="https://agenciabrasil.ebc.com.br/noticia" target="_BLANK"><img alt="Logo Agência Brasil" src="https://cdn.jsdelivr.net/gh/sergiosdlima/assets-ebc@1.0.0/abr/assets/images/logo-agenciabrasil.svg" style="height: 54px;"></a></figure>';

test('wrapper exclusivo do logotipo é removido sem atingir fotografia e texto', async () => {
  const html = '<p><a href="/noticia">Texto editorial</a></p>' +
    '<figure data-rx-type="image"><div class="centralizado"><a href="https://agenciabrasil.ebc.com.br/"><span>' +
    '<img data-lazy-src="/assets/logo-agenciabrasil.svg" alt="Logo Agência Brasil"></span></a></div></figure>' + foto;
  const page = await paginaComCorpo(html);
  try {
    assert.deepEqual(await prepararImagensAgenciaBrasil(page), { ok:true, removidas:1 });
    const enviado = await page.locator('#inp_text').inputValue();
    assert.doesNotMatch(enviado, /logo-agenciabrasil/);
    assert.match(enviado, /Texto editorial/);
    assert.match(enviado, /reportagem\.jpg/);
    assert.equal(await page.locator('#imagem-destaque').getAttribute('src'), '/destaque.jpg');
  } finally { await page.close(); }
});

test('logotipo presente somente na fonte HTML não passa pela saída antecipada', async () => {
  const corpo = '<p>Reportagem preservada.</p>';
  const page = await paginaComCorpo(corpo);
  try {
    await page.locator('a[data-command="source.toggle"]').evaluate((botao, html) => {
      botao.addEventListener('click', () => {
        document.querySelector('.rx-editor').innerHTML = html;
      }, { capture:true, once:true });
    }, corpo + logoReal);
    assert.deepEqual(await prepararImagensAgenciaBrasil(page), { ok:true, removidas:1 });
    assert.doesNotMatch(await page.locator('#inp_text').inputValue(), /logo-agenciabrasil/);
  } finally { await page.close(); }
});

test('logotipo só no visual também é conferido antes de declarar sucesso', async () => {
  const corpo = '<p>Reportagem preservada.</p>';
  const page = await paginaComCorpo(corpo + logoReal);
  try {
    await page.locator('#inp_text').evaluate((campo, html) => { campo.value = html; }, corpo);
    await page.locator('a[data-command="source.toggle"]').evaluate((botao, html) => {
      botao.addEventListener('click', () => {
        document.querySelector('.rx-editor').innerHTML = html;
      }, { capture:true, once:true });
    }, corpo);
    assert.deepEqual(await prepararImagensAgenciaBrasil(page), { ok:true, removidas:1 });
    assert.doesNotMatch(await page.locator('.rx-editor').innerHTML(), /logo-agenciabrasil/);
  } finally { await page.close(); }
});

test('limpeza ocorre antes da decisão de revisar por foto ausente', async () => {
  const eventos = [];
  const resumo = await processarLote([{ titulo:'Agência Brasil', url:'https://cms.test/news/edit/1' }], {
    abrir:async () => ({ isClosed:() => false }),
    limparLogo:async () => { eventos.push('limpar'); return { ok:true, removidas:1 }; },
    ler:async () => { eventos.push('requisitos'); return { temChapeu:true, temImagem:false }; },
    pesquisar:async () => { eventos.push('revisao'); },
    enviar:async () => { eventos.push('enviar'); return true; }, log:async () => {}
  });
  assert.deepEqual(eventos, ['limpar', 'requisitos', 'revisao']);
  assert.equal(resumo.pendentes, 1);
  assert.equal(resumo.enviadas, 0);
});

test('falha ao confirmar a remoção mantém a matéria aberta e impede envio', async () => {
  const eventos = [];
  const resumo = await processarLote([{ titulo:'Agência Brasil', url:'https://cms.test/news/edit/2' }], {
    abrir:async () => ({ isClosed:() => false }),
    limparLogo:async () => ({ ok:false, aviso:'Divergência real no HTML do formulário.' }),
    ler:async () => { eventos.push('ler'); return { temChapeu:true, temImagem:true }; },
    enviar:async () => { eventos.push('enviar'); return true; }, log:async () => {}
  });
  assert.deepEqual(eventos, []);
  assert.equal(resumo.pendentes, 1);
  assert.equal(resumo.enviadas, 0);
});

test('extrai o HTML real da requisição sem confundir outros campos', () => {
  const html = '<p>Texto & <strong>formatação</strong>.</p>';
  const requisicao = (tipo, corpo) => ({ headers:() => ({ 'content-type':tipo }), postData:() => corpo });
  assert.equal(extrairHtmlRequisicao(requisicao('application/x-www-form-urlencoded',
    new URLSearchParams({ title:'Outra matéria', text:html }).toString())), html);
  assert.equal(extrairHtmlRequisicao(requisicao('application/json', JSON.stringify({ text:html }))), html);
  const multipart = `--AbC123\r\nContent-Disposition: form-data; name="title"\r\n\r\nOutro título\r\n` +
    `--AbC123\r\nContent-Disposition: form-data; name="text"\r\n\r\n${html}\r\n--AbC123--\r\n`;
  assert.equal(extrairHtmlRequisicao(requisicao('multipart/form-data; boundary=AbC123', multipart)), html);
  assert.equal(extrairHtmlRequisicao(requisicao('application/json', JSON.stringify({ title:'Sem corpo' }))), null);
});

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

test('remove o figure real sem data-rx-type e confirma HTML do formulário', async () => {
  const html = `<p><strong>Antes</strong> com <a href="https://exemplo.test/noticia">link</a>.</p>${logoSemTipo}${foto}<p>Depois.</p>`;
  const page = await paginaComCorpo(html);
  try {
    assert.deepEqual(await prepararImagensAgenciaBrasil(page), { ok:true, removidas:1 });
    const enviado = await page.locator('form').evaluate(form => new FormData(form).get('text'));
    assert.doesNotMatch(enviado, /logo-agenciabrasil\.svg/);
    assert.match(enviado, /<strong>Antes<\/strong>/);
    assert.match(enviado, /href="https:\/\/exemplo.test\/noticia"/);
    assert.match(enviado, /foto-reportagem|reportagem\.jpg/);
    assert.equal(await page.locator('.rx-editor figure').count(), 1);
    assert.equal(await page.locator('#imagem-destaque').getAttribute('src'), '/destaque.jpg');
  } finally { await page.close(); }
});

test('figure sem data-rx-type com legenda preserva o conteúdo e exige revisão', async () => {
  const html = logoSemTipo.replace('</figure>', '<figcaption>Informação editorial</figcaption></figure>');
  const page = await paginaComCorpo(html);
  try {
    const resultado = await prepararImagensAgenciaBrasil(page);
    assert.equal(resultado.ok, false);
    assert.equal(await page.locator('form').evaluate(form => new FormData(form).get('text')), html);
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

test('HTML antigo do formulário é sincronizado quando só diverge pelo logotipo', async () => {
  const corpoVisivel = '<p><strong>Notícia</strong> sem logotipo visível.</p>';
  const corpoEnviado = `${corpoVisivel}${logoReal}`;
  const page = await paginaComCorpo(corpoVisivel);
  try {
    await page.locator('#inp_text').evaluate((elemento, conteudo) => { elemento.value = conteudo; }, corpoEnviado);
    const resultado = await prepararImagensAgenciaBrasil(page);
    assert.deepEqual(resultado, { ok: true, removidas: 1 });
    assert.equal(await page.locator('.rx-editor').innerHTML(), corpoVisivel);
    assert.equal(await page.locator('#inp_text').inputValue(), corpoVisivel);
    assert.equal(await page.locator('form').evaluate(form => new FormData(form).get('text')), corpoVisivel);
    assert.equal(await page.locator('#imagem-destaque').getAttribute('src'), '/destaque.jpg');
  } finally { await page.close(); }
});

test('serializações equivalentes do editor e formulário não bloqueiam a remoção', async () => {
  const visual = `<p class="redacao destaque" style="color: rgb(1, 2, 3); text-align: center"><a href="https://exemplo.test/original?a=1&amp;b=2" target="_BLANK">Texto &amp; <strong>formatação</strong></a></p>${logoSemTipo}`;
  const formulario = `<p style="text-align:center;color:rgb(1, 2, 3)" class="destaque redacao"><a target="_blank" href="https://exemplo.test/original?a=1&amp;b=2">Texto &#38; <strong>formatação</strong></a></p>\n${logoSemTipo}`;
  const page = await paginaComCorpo(visual);
  try {
    await page.locator('#inp_text').evaluate((campo, html) => { campo.value = html; }, formulario);
    const resultado = await prepararImagensAgenciaBrasil(page);
    assert.equal(resultado.ok, true, resultado.aviso);
    assert.equal(resultado.removidas, 1);
    const enviado = await page.locator('form').evaluate(form => new FormData(form).get('text'));
    assert.doesNotMatch(enviado, /logo-agenciabrasil\.svg/);
    assert.match(enviado, /href="https:\/\/exemplo\.test\/original\?a=1&amp;b=2"/);
  } finally { await page.close(); }
});

test('atributos internos observados no Redactor não geram falsa divergência', async () => {
  const visual = '<p data-rx-type="text" data-rx-first-level="true">Texto <strong>preservado</strong>.</p>' +
    '<figure data-rx-type="image" data-rx-first-level="true" contenteditable="false" style="text-align:center">' +
    '<a class="" href="https://agenciabrasil.ebc.com.br/noticia"><img alt="Logo Agência Brasil" src="/logo-agenciabrasil.svg" data-rx-style-cache="height:54px"></a></figure>' +
    '<p data-rx-type="text" data-rx-first-level="true"><img src="/foto-legitima.jpg" data-rx-style-cache="width:100px"></p>';
  const formulario = '<p>Texto <strong>preservado</strong>.</p>' +
    '<figure style="text-align:center"><a href="https://agenciabrasil.ebc.com.br/noticia"><img alt="Logo Agência Brasil" src="/logo-agenciabrasil.svg"></a></figure>' +
    '<p><img src="/foto-legitima.jpg"></p>';
  const page = await paginaComCorpo(visual);
  try {
    await page.locator('#inp_text').evaluate((campo, html) => { campo.value = html; }, formulario);
    const resultado = await prepararImagensAgenciaBrasil(page);
    assert.equal(resultado.ok, true, resultado.aviso);
    assert.equal(resultado.removidas, 1);
    const enviado = await page.locator('form').evaluate(form => new FormData(form).get('text'));
    assert.doesNotMatch(enviado, /logo-agenciabrasil\.svg/);
    assert.match(enviado, /foto-legitima\.jpg/);
    assert.match(enviado, /<strong>preservado<\/strong>/);
  } finally { await page.close(); }
});

test('comparação estrutural preserva diferenças de texto, foto, legenda e destino de link', async () => {
  const page = await paginaComCorpo('<p>Teste.</p>');
  try {
    const original = '<p><a href="https://exemplo.test/a">Texto</a></p><figure><img src="/foto.jpg"><figcaption>Legenda</figcaption></figure>';
    for (const alterado of [
      original.replace('Texto', 'Outro texto'),
      original.replace('/foto.jpg', '/outra-foto.jpg'),
      original.replace('Legenda', 'Outra legenda'),
      original.replace('exemplo.test/a', 'exemplo.test/b'),
      original.replace('<figure>', '<figure data-editorial-id="novo">')
    ]) {
      const resultado = await page.evaluate(compararCorposAgenciaBrasil, { primeiro:original, segundo:alterado });
      assert.equal(resultado.equivalentes, false, alterado);
      assert.ok(resultado.motivo);
    }
  } finally { await page.close(); }
});

test('HTML do formulário com conteúdo editorial divergente permanece pendente', async () => {
  const corpoVisivel = '<p>Texto atual do editor.</p>';
  const corpoEnviado = '<p>Outro texto editorial.</p>' + logoReal;
  const page = await paginaComCorpo(corpoVisivel);
  try {
    await page.locator('#inp_text').evaluate((elemento, conteudo) => { elemento.value = conteudo; }, corpoEnviado);
    const resultado = await prepararImagensAgenciaBrasil(page);
    assert.equal(resultado.ok, false);
    assert.match(resultado.aviso, /divergem|revisão manual/i);
    assert.equal(await page.locator('#inp_text').inputValue(), corpoEnviado);
    assert.equal(await page.locator('#imagem-destaque').getAttribute('src'), '/destaque.jpg');
  } finally { await page.close(); }
});

test('editor que restaura o logotipo no campo enviado impede a conclusão', async () => {
  const page = await paginaComCorpo(logoReal);
  try {
    await page.locator('a[data-command="source.toggle"]').evaluate((botao, logoHtml) => {
      botao.addEventListener('click', () => {
        if (document.querySelector('.rx-source').hidden) document.querySelector('#inp_text').value += logoHtml;
      });
      document.querySelector('#inp_text').addEventListener('change', event => { event.target.value += logoHtml; });
    }, logoReal);
    const resultado = await prepararImagensAgenciaBrasil(page);
    assert.equal(resultado.ok, false);
    assert.match(resultado.aviso, /Logotipo.*persiste|revisão manual/i);
    assert.match(await page.locator('#inp_text').inputValue(), /logo-agenciabrasil\.svg/);
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
