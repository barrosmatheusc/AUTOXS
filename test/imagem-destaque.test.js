// Leitura da IMAGEM DE DESTAQUE — correção do bug que gravou product-2.jpg.
//
// Tudo contra um DOM sintético que imita a tela de edição do CMS. Nenhuma
// matéria real é aberta, nada é publicado.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { lerFotoEscolhida, diagnosticarImagemDestaque, escolherIdDaMidia,
  registrarEscolhaDeFoto, instalarSentinelaDestaque, lerDestaqueGuardado,
  localizarAbasDeMateria, diagnosticarDestaqueAberto, URL_NEWS } = require('../autoxs');
const { acompanharEnvioManual } = require('../acompanhar-envio');

const FOTO = 'https://tdan.nyc3.digitaloceanspaces.com/images/praca-central.jpg';
const TEMA = 'https://tdan.nyc3.digitaloceanspaces.com/assets/images/products/product-2.jpg';
// 1x1 transparente: a imagem precisa carregar de verdade, mas o tamanho visual
// vem do CSS. currentSrc é trocado depois, sem tocar a rede.
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Monta a tela de edição: cabeçalho do tema (com arte), formulário com o
// rótulo, botão + da imagem, cartão de destaque, botão + da galeria, e um
// rodapé do tema — tudo como numa página real.
function telaDeEdicao({ destaque = FOTO, atributos = '', ocultos = '',
  cartoes = 1, imagensNoCartao = 1, comRotulo = true, comForm = true } = {}) {
  const img = (fonte, extra = '') =>
    `<img src="${PIXEL}" data-fonte="${fonte}" alt="" ${extra}
       style="display:block;width:320px;height:200px">`;
  const cartao = fonte => `<div class="card" ${atributos} style="width:360px">
      ${Array.from({ length:imagensNoCartao }, (v, i) =>
    img(i === 0 ? fonte : fonte.replace('.jpg', `-extra${i}.jpg`))).join('')}
      <button type="button">Editar legenda</button>
    </div>`;
  const corpo = `
    <header class="topo">${img('https://cms.local/assets/images/logo.png')}</header>
    ${comForm ? '<form>' : '<div>'}
      <input name="title" value="Obra na praça é entregue">
      <input name="hat" value="Penedo">
      <textarea name="subtitle">Entrega prevista para dezembro</textarea>
      ${ocultos}
      ${comRotulo ? '<p>Imagem de destaque</p>' : '<p>Outra coisa</p>'}
      <button type="button">+</button>
      ${Array.from({ length:cartoes }, (v, i) =>
    cartao(i === 0 ? destaque : destaque.replace('.jpg', `-segundo${i}.jpg`))).join('')}
      <p>Galeria</p>
      <button type="button">+</button>
      <div class="card" style="width:360px">${img('https://cms.local/images/galeria-1.jpg')}</div>
    ${comForm ? '</form>' : '</div>'}
    <footer>${img(TEMA)}</footer>`;
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><body style="margin:0">${corpo}
    <script>
      for (const el of document.querySelectorAll('img[data-fonte]'))
        Object.defineProperty(el, 'currentSrc', { get:() => el.dataset.fonte });
    <\/script></body></html>`;
}

async function comPagina(html, funcao) {
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  const contexto = await browser.newContext();
  const aba = await contexto.newPage();
  try {
    await aba.setContent(html);
    await aba.waitForFunction(() => [...document.images].every(img => img.complete));
    await funcao(aba);
  } finally { await contexto.close(); await browser.close(); }
}

// ============================================== a foto certa, e só ela

test('lê a foto do cartão de destaque, não a arte do tema', async () => {
  await comPagina(telaDeEdicao(), async aba => {
    const lida = await lerFotoEscolhida(aba);
    assert.equal(lida.estado, 'ok');
    assert.equal(lida.url, FOTO);
    assert.equal(lida.titulo, 'Obra na praça é entregue');
    assert.equal(lida.chapeu, 'Penedo');
  });
});

test('product-2.jpg no rodapé do tema não vence a foto do cartão', async () => {
  await comPagina(telaDeEdicao({ destaque:FOTO }), async aba => {
    const lida = await lerFotoEscolhida(aba);
    assert.equal(lida.url, FOTO);
    assert.notEqual(lida.url, TEMA);
  });
});

test('product-2.jpg DENTRO do cartão é recusado como arte do tema', async () => {
  await comPagina(telaDeEdicao({ destaque:TEMA }), async aba => {
    const lida = await lerFotoEscolhida(aba);
    assert.equal(lida.estado, 'interface');
    assert.equal(lida.url, '');
  });
});

for (const [rotulo, arte] of [
  ['logo', 'https://cms.local/images/logo-tribuna.png'],
  ['avatar', 'https://cms.local/images/avatar-usuario.jpg'],
  ['ícone', 'https://cms.local/images/icon-camera.png'],
  ['placeholder', 'https://cms.local/images/placeholder.jpg'],
  ['banner', 'https://cms.local/images/banner-topo.jpg'],
  ['arquivo de /assets/', 'https://cms.local/assets/foto.jpg']
]) {
  test(`${rotulo} no cartão não é aceito como foto de destaque`, async () => {
    await comPagina(telaDeEdicao({ destaque:arte }), async aba => {
      assert.equal((await lerFotoEscolhida(aba)).estado, 'interface');
    });
  });
}

// ============================================== quando NÃO dá para saber

test('listagem /news, sem formulário, não produz escolha', async () => {
  await comPagina(telaDeEdicao({ comForm:false }), async aba => {
    const lida = await lerFotoEscolhida(aba);
    assert.equal(lida.estado, 'semFormulario');
    assert.equal(lida.url, '');
  });
});

test('dois cartões na faixa é ambiguidade, não palpite', async () => {
  await comPagina(telaDeEdicao({ cartoes:2 }), async aba => {
    const lida = await lerFotoEscolhida(aba);
    assert.equal(lida.estado, 'cartaoAmbiguo');
    assert.equal(lida.url, '');
  });
});

test('duas fotos dentro do mesmo cartão é ambiguidade', async () => {
  await comPagina(telaDeEdicao({ imagensNoCartao:2 }), async aba => {
    const lida = await lerFotoEscolhida(aba);
    assert.equal(lida.estado, 'imagemAmbigua');
    assert.equal(lida.url, '');
  });
});

test('página quebrada devolve erro, nunca uma URL inventada', async () => {
  const quebrada = { evaluate:async () => { throw new Error('contexto destruído'); } };
  const lida = await lerFotoEscolhida(quebrada);
  assert.equal(lida.estado, 'erro');
  assert.equal(lida.url, '');
});

// ====================================================== id da mídia

test('ID da mídia tem prioridade quando o CMS o expõe', async () => {
  await comPagina(telaDeEdicao({ atributos:'data-image-id="48291"' }), async aba => {
    const lida = await lerFotoEscolhida(aba);
    assert.equal(lida.estado, 'ok');
    assert.equal(lida.cmsId, '48291');
    assert.match(lida.origemId, /data-image-id/);
  });
});

test('campo oculto do formulário também serve de ID', async () => {
  await comPagina(telaDeEdicao({ ocultos:'<input type="hidden" name="image_id" value="77120">' }),
    async aba => {
      const lida = await lerFotoEscolhida(aba);
      assert.equal(lida.cmsId, '77120');
      assert.match(lida.origemId, /image_id/);
    });
});

test('IDs divergentes não viram palpite', () => {
  const resultado = escolherIdDaMidia({
    atributos:[{ nome:'data-image-id', valor:'10' }],
    ocultos:[{ nome:'image_id', valor:'99' }] });
  assert.equal(resultado.cmsId, null);
  assert.equal(resultado.origemId, 'ambiguo');
});

test('sem ID nenhum, a identidade continua vindo da URL', async () => {
  await comPagina(telaDeEdicao(), async aba => {
    const lida = await lerFotoEscolhida(aba);
    assert.equal(lida.cmsId, null);
    assert.equal(lida.url, FOTO);
  });
});

test('token em campo sensível não é coletado', async () => {
  await comPagina(telaDeEdicao({
    ocultos:'<input type="hidden" name="image_csrf_token" value="segredo-abc">' }), async aba => {
    const lida = await lerFotoEscolhida(aba);
    assert.ok(!(lida.ocultos || []).some(item => /token/i.test(item.nome)),
      'campo de token não pode ser lido');
    assert.ok(!JSON.stringify(lida).includes('segredo-abc'));
  });
});

test('diagnóstico sanitiza a query e não despeja HTML', async () => {
  await comPagina(telaDeEdicao({ destaque:`${FOTO}?token=abc123&w=800` }), async aba => {
    const relatorio = await diagnosticarImagemDestaque(aba);
    assert.equal(relatorio.estado, 'ok');
    assert.match(relatorio.url, /token=%E2%80%A6|token=…/);
    assert.doesNotMatch(relatorio.url, /abc123/);
    assert.ok(!('titulo' in relatorio) || relatorio.titulo === undefined);
    assert.ok(JSON.stringify(relatorio).length < 4000, 'o diagnóstico precisa ser enxuto');
  });
});

// ============================ troca de fotos e momento da consolidação

test('trocar A → B → C antes do envio: vale a foto que estava na tela', async () => {
  await comPagina(telaDeEdicao({ destaque:'https://cms.local/images/foto-a.jpg' }), async aba => {
    const trocar = fonte => aba.evaluate(nova => {
      const img = document.querySelector('form .card img');
      img.dataset.fonte = nova;
    }, fonte);
    assert.equal((await lerFotoEscolhida(aba)).url, 'https://cms.local/images/foto-a.jpg');
    await trocar('https://cms.local/images/foto-b.jpg');
    assert.equal((await lerFotoEscolhida(aba)).url, 'https://cms.local/images/foto-b.jpg');
    await trocar('https://cms.local/images/foto-c.jpg');
    const final = await lerFotoEscolhida(aba);
    assert.equal(final.url, 'https://cms.local/images/foto-c.jpg', 'só a última conta');
  });
});

test('nenhum clique intermediário chega à memória: só a leitura entregue', async () => {
  await comPagina(telaDeEdicao(), async aba => {
    const gravadas = [];
    const memoria = { registrar:async entrada => { gravadas.push(entrada); return entrada; } };
    // A leitura provisória é feita uma vez, no envio. Cliques anteriores não
    // passam por aqui porque ninguém os registra.
    const provisorio = await lerFotoEscolhida(aba);
    const escolha = await registrarEscolhaDeFoto(aba, { url:'https://cms.local/news/edit/1' },
      memoria, () => {}, provisorio);
    await escolha.gravacao;
    assert.equal(gravadas.length, 1);
    assert.equal(gravadas[0].imagemUrl, FOTO);
  });
});

test('leitura ruim não consolida nada, mesmo com memória disponível', async () => {
  await comPagina(telaDeEdicao({ comForm:false }), async aba => {
    const gravadas = [];
    const memoria = { registrar:async entrada => { gravadas.push(entrada); return entrada; } };
    const avisos = [];
    const provisorio = await lerFotoEscolhida(aba);
    const escolha = await registrarEscolhaDeFoto(aba, { url:'https://cms.local/news/edit/1' },
      memoria, m => avisos.push(m), provisorio);
    assert.equal(escolha, null);
    assert.deepEqual(gravadas, []);
    assert.match(avisos.join(' '), /listagem|formulário/i);
  });
});

// ================================== o gancho de envio: sucesso × falha

// Formulário que posta de verdade, com a resposta do CMS controlada pelo teste.
async function comEnvio(funcao, { sucesso = true } = {}) {
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  const contexto = await browser.newContext();
  const aba = await contexto.newPage();
  try {
    await contexto.route('**/news/edit/1', async rota => {
      if (rota.request().method() !== 'POST') {
        return rota.fulfill({ contentType:'text/html',
          body:telaDeEdicao().replace('<form>', '<form method="POST" action="/news/edit/1">') });
      }
      // Sucesso navega para a listagem — exatamente o que destruía a leitura.
      return sucesso
        ? rota.fulfill({ status:200, contentType:'text/html',
          body:'<!doctype html><meta charset="utf-8"><body><div class="alert-success">Matéria atualizada com sucesso</div></body>' })
        : rota.fulfill({ status:500, contentType:'text/html', body:'<!doctype html><body>erro</body>' });
    });
    await aba.goto('https://cms.local/news/edit/1');
    await aba.waitForFunction(() => [...document.images].every(img => img.complete));
    await funcao(aba);
  } finally { await contexto.close(); await browser.close(); }
}

test('envio bem-sucedido consolida a foto lida antes da navegação', async () => {
  await comEnvio(async aba => {
    // acompanharEnvioManual fecha a aba logo após confirmar, então a espera
    // é pelo próprio callback, não pela página.
    // Como no fluxo real: a sentinela é instalada antes do envio.
    await instalarSentinelaDestaque(aba);
    let resolver;
    const confirmado = new Promise(pronto => { resolver = pronto; });
    const memoria = { registrar:async entrada => entrada };
    const parar = await acompanharEnvioManual(aba, aba.locator('form'),
      async provisorio => resolver(await registrarEscolhaDeFoto(aba,
        { url:'https://cms.local/news/edit/1' }, memoria, () => {}, provisorio)),
      () => lerFotoEscolhida(aba));
    assert.ok(parar, 'o acompanhamento precisa estar instalado');
    await aba.evaluate(() => document.querySelector('form').submit());
    const consolidada = await Promise.race([confirmado,
      new Promise((v, erro) => setTimeout(() => erro(new Error('o CMS não confirmou a tempo')), 20000))]);
    assert.ok(consolidada, 'a escolha precisa ser consolidada depois da confirmação');
    assert.equal(consolidada.entrada.imagemUrl, FOTO,
      'a foto do formulário, não a da página de destino');
  });
});

test('envio que falha não consolida escolha nenhuma', async () => {
  await comEnvio(async aba => {
    let confirmou = false;
    await acompanharEnvioManual(aba, aba.locator('form'),
      async () => { confirmou = true; }, () => lerFotoEscolhida(aba));
    await aba.evaluate(() => document.querySelector('form').submit());
    await aba.waitForTimeout(3000);
    assert.equal(confirmou, false, 'sem confirmação do CMS, nada é aprendido');
  }, { sucesso:false });
});

test('ler depois da navegação devolveria lixo — é por isso que lemos antes', async () => {
  await comEnvio(async aba => {
    await aba.evaluate(() => document.querySelector('form').submit());
    await aba.waitForFunction(() => !document.querySelector('form'), null, { timeout:15000 });
    // Esta é a leitura que a Fase 2 fazia: na página de destino.
    const tardia = await lerFotoEscolhida(aba);
    assert.notEqual(tardia.estado, 'ok');
    assert.equal(tardia.url, '', 'nenhuma URL pode sair da página de destino');
  });
});

test('nenhum teste deste arquivo publica matéria', async () => {
  // O único POST existente é o do formulário, interceptado pelo route e
  // respondido pelo próprio teste: nada sai para a internet.
  const fonte = await require('node:fs/promises').readFile(__filename, 'utf8');
  assert.doesNotMatch(fonte, /redacao\.tribunaweb\.com\.br/, 'nenhum endereço real do CMS');
});

test('a sentinela guarda a leitura no submit e sobrevive à navegação', async () => {
  await comEnvio(async aba => {
    await instalarSentinelaDestaque(aba);
    // Antes do envio não há nada guardado.
    assert.equal(await lerDestaqueGuardado(aba), null);
    await aba.evaluate(() => document.querySelector('form').submit());
    await aba.waitForFunction(() => !document.querySelector('form'), null, { timeout:15000 });
    // Já na página de destino, a leitura do formulário continua disponível.
    const guardada = await lerDestaqueGuardado(aba);
    assert.ok(guardada, 'a sentinela precisa ter guardado algo');
    assert.equal(guardada.estado, 'ok');
    assert.equal(guardada.url, FOTO);
    assert.equal(guardada.viaSentinela, true);
    // E é consumida uma vez só, para não vazar para a matéria seguinte.
    assert.equal(await lerDestaqueGuardado(aba), null);
  });
});

// --------------------------------------- localizar a aba da matéria no AutoXS
// O Chrome do AutoXS é controlado por --remote-debugging-pipe: não há porta de
// depuração e nenhum processo externo pode se anexar. O diagnóstico precisa
// achar a aba certa DENTRO do próprio contexto Playwright já em execução.

const aba = (endereco, fechada = false) =>
  ({ url:() => endereco, isClosed:() => fechada });

test('só o formulário da matéria conta como aba de matéria', () => {
  const contexto = { pages:() => [
    aba(`${URL_NEWS}/edit/9881`),
    aba(`${URL_NEWS}/edit/9882/`),
    aba(`${URL_NEWS}/add`),
    // A listagem é exatamente o lugar onde a captura antiga leu product-2.jpg.
    aba(URL_NEWS),
    aba(`${URL_NEWS}/edit/9881/historico`),
    aba(`${new URL(URL_NEWS).origin}/login`),
    aba('about:blank'),
    aba('file:///C:/manual/painel-manual.html'),
    // Outro domínio com o mesmo caminho não vale.
    aba('https://outro.exemplo.com/news/edit/9881'),
    aba(`${URL_NEWS}/edit/9999`, true)
  ] };
  assert.deepEqual(localizarAbasDeMateria(contexto).map(item => item.url()), [
    `${URL_NEWS}/edit/9881`,
    `${URL_NEWS}/edit/9882/`,
    `${URL_NEWS}/add`
  ]);
});

test('contexto sem abas, ou sem contexto, não quebra o diagnóstico', async () => {
  assert.deepEqual(localizarAbasDeMateria(null), []);
  assert.deepEqual(localizarAbasDeMateria({}), []);
  assert.deepEqual(await diagnosticarDestaqueAberto({ pages:() => [] }), { abas:[] });
});

test('o diagnóstico devolve conclusão por aba, sem tocar na página', async () => {
  await comPagina(telaDeEdicao({ atributos:'data-media-id="48291"' }), async pagina1 => {
    const contexto = { pages:() => [Object.assign(pagina1,
      { url:() => `${URL_NEWS}/edit/9881` })] };
    const antes = await pagina1.evaluate(() => document.body.innerHTML);
    const { abas } = await diagnosticarDestaqueAberto(contexto);
    assert.equal(abas.length, 1);
    assert.equal(abas[0].estado, 'ok');
    assert.equal(abas[0].motivo, null);
    assert.equal(abas[0].cmsId, '48291');
    assert.equal(abas[0].chave, 'cms:48291');
    assert.equal(abas[0].confianca, 'exata (id do CMS)');
    assert.equal(abas[0].materia, `${URL_NEWS}/edit/9881`);
    assert.equal(await pagina1.evaluate(() => document.body.innerHTML), antes);
  });
});

test('aba sem destaque legível vira indeterminada com motivo em português', async () => {
  await comPagina(telaDeEdicao({ cartoes:0 }), async pagina1 => {
    const contexto = { pages:() => [Object.assign(pagina1,
      { url:() => `${URL_NEWS}/add` })] };
    const { abas } = await diagnosticarDestaqueAberto(contexto);
    assert.equal(abas[0].estado, 'semCartao');
    assert.match(abas[0].motivo, /nenhum cartão de imagem/);
    assert.equal(abas[0].chave, null);
    assert.equal(abas[0].confianca, 'indeterminada');
  });
});
