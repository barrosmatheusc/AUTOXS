// Captura da fotografia escolhida (Fase 0 do aprendizado visual).
//
// Tudo roda contra um DOM sintético que imita a tela de edição do CMS: nenhuma
// matéria real é aberta, nenhum endereço do CMS é acessado.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { lerFotoEscolhida, registrarEscolhaDeFoto, verificarImagemDestaque } = require('../autoxs');

const FOTO = 'https://cms.local/uploads/2026/11/praca-central.jpg';
// 1x1 transparente: a imagem precisa carregar de verdade para valer como
// destaque, mas o tamanho visual vem do CSS, não dos bytes.
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function pagina({ imagens = [], titulo = 'Prefeitura anuncia obra', chapeu = 'Penedo',
  subtitulo = 'Entrega prevista para dezembro', botoes = 2 } = {}) {
  const maisBotoes = Array.from({ length:botoes }, () => '<button type="button">+</button>');
  // Cada imagem vai no próprio cartão, igual ao CMS: é o cartão entre os dois
  // botões + que identifica a imagem de destaque.
  const destaque = imagens.map(item =>
    `<div class="card" style="width:360px"><img src="${item.src || PIXEL}"
       data-fonte="${item.fonte || ''}" alt=""
       style="display:block;width:${item.largura ?? 320}px;height:${item.altura ?? 200}px"></div>`).join('');
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><body style="margin:0">
    <form>
      <input name="title" value="${titulo}">
      <input name="hat" value="${chapeu}">
      <textarea name="subtitle">${subtitulo}</textarea>
      <p>Imagem de destaque</p>
      ${maisBotoes[0] || ''}
      ${destaque}
      <p>Galeria</p>
      ${maisBotoes[1] || ''}
      <div class="card" style="width:360px"><img src="${PIXEL}" alt=""
        style="display:block;width:400px;height:300px"></div>
    </form>
    <script>
      // currentSrc precisa apontar para o endereço do acervo sem baixar nada da
      // rede: o teste troca a propriedade depois que o pixel já carregou.
      for (const img of document.querySelectorAll('img[data-fonte]')) {
        if (!img.dataset.fonte) continue;
        Object.defineProperty(img, 'currentSrc', { get:() => img.dataset.fonte });
      }
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

test('uma única imagem de destaque é capturada com o contexto da matéria', async () => {
  await comPagina(pagina({ imagens:[{ fonte:FOTO }] }), async aba => {
    const lida = await lerFotoEscolhida(aba);
    assert.equal(lida.estado, 'ok');
    assert.equal(lida.url, FOTO);
    assert.equal(lida.titulo, 'Prefeitura anuncia obra');
    assert.equal(lida.chapeu, 'Penedo');
    assert.equal(lida.subtitulo, 'Entrega prevista para dezembro');
  });
});

test('matéria sem imagem de destaque não produz escolha', async () => {
  await comPagina(pagina({ imagens:[] }), async aba => {
    const lida = await lerFotoEscolhida(aba);
    assert.equal(lida.estado, 'semCartao');
    assert.equal(lida.url, '');
  });
});

test('duas imagens na área de destaque são ambiguidade e não registram nada', async () => {
  await comPagina(pagina({ imagens:[{ fonte:FOTO },
    { fonte:'https://cms.local/uploads/2026/11/outra.jpg' }] }), async aba => {
    const lida = await lerFotoEscolhida(aba);
    assert.equal(lida.estado, 'cartaoAmbiguo');
    assert.equal(lida.url, '');
    const registros = [];
    const memoria = { registrar:async entrada => { registros.push(entrada); return entrada; } };
    const avisos = [];
    const escolha = await registrarEscolhaDeFoto(aba, { url:'https://cms.local/news/edit/1' },
      memoria, m => avisos.push(m));
    assert.equal(escolha, null);
    assert.deepEqual(registros, [], 'nada pode ser gravado em caso de ambiguidade');
    assert.match(avisos.join(' '), /mais de um cartão/i);
  });
});

test('placeholder no cartão de destaque não vira escolha', async () => {
  await comPagina(pagina({ imagens:[
    { fonte:'https://cms.local/assets/no-image-default.png' }
  ] }), async aba => {
    const lida = await lerFotoEscolhida(aba);
    assert.equal(lida.estado, 'interface');
    assert.equal(lida.url, '');
  });
});

test('sem os dois botões de referência a leitura não arrisca um palpite', async () => {
  await comPagina(pagina({ imagens:[{ fonte:FOTO }], botoes:1 }), async aba => {
    assert.equal((await lerFotoEscolhida(aba)).estado, 'semBotoes');
  });
});

test('aba quebrada devolve vazio em vez de derrubar o fechamento', async () => {
  const quebrada = { evaluate:async () => { throw new Error('página fechou'); } };
  const lida = await lerFotoEscolhida(quebrada);
  assert.equal(lida.estado, 'erro');
  assert.equal(lida.url, '');
});

test('sem memória visual a captura não roda e nada acontece', async () => {
  await comPagina(pagina({ imagens:[{ fonte:FOTO }] }), async aba => {
    assert.equal(await registrarEscolhaDeFoto(aba, { url:'https://cms.local/news/edit/1' }, null), null);
  });
});

test('a escolha chega à memória com matéria, foto e origem manual', async () => {
  await comPagina(pagina({ imagens:[{ fonte:FOTO }] }), async aba => {
    const registros = [];
    const memoria = { registrar:async entrada => { registros.push(entrada); return entrada; } };
    const escolha = await registrarEscolhaDeFoto(aba,
      { url:'https://cms.local/news/edit/1001', titulo:'Da listagem' }, memoria);
    await escolha.gravacao;
    assert.equal(registros.length, 1);
    assert.deepEqual(registros[0], { materiaUrl:'https://cms.local/news/edit/1001', imagemUrl:FOTO,
      // cmsId acompanha a entrada desde a correção; nulo quando o CMS não o expõe.
      cmsId:null, titulo:'Prefeitura anuncia obra', chapeu:'Penedo',
      subtitulo:'Entrega prevista para dezembro', origem:'manual' });
  });
});

test('falha ao gravar não interrompe quem está fechando a aba', async () => {
  await comPagina(pagina({ imagens:[{ fonte:FOTO }] }), async aba => {
    const memoria = { registrar:async () => { throw new Error('disco cheio'); } };
    const escolha = await registrarEscolhaDeFoto(aba, { url:'https://cms.local/news/edit/1' }, memoria);
    assert.ok(escolha, 'a leitura foi bem-sucedida');
    await assert.rejects(escolha.gravacao, /disco cheio/);
  });
});

test('a captura não altera a página nem o resultado do filtro de pendência', async () => {
  await comPagina(pagina({ imagens:[{ fonte:FOTO }] }), async aba => {
    const antes = await aba.evaluate(() => document.body.innerHTML);
    const filtroAntes = await verificarImagemDestaque(aba);
    await lerFotoEscolhida(aba);
    const filtroDepois = await verificarImagemDestaque(aba);
    assert.equal(await aba.evaluate(() => document.body.innerHTML), antes,
      'a leitura é passiva: o DOM não pode mudar');
    assert.deepEqual(filtroDepois, filtroAntes, 'o filtro inicial precisa continuar idêntico');
    assert.equal(filtroDepois.temImagem, true);
  });
});
