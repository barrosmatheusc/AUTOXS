const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { acompanharPublicacaoAdicao } = require('../acompanhar-publicacao-adicao');

function paginaSimulada(status = 200, retorno = {}) {
  const pagina = new EventEmitter();
  const frame = {};
  const url = 'https://redacao.tribunaweb.com.br/news/add';
  pagina.url = () => url;
  pagina.isClosed = () => false;
  pagina.mainFrame = () => frame;
  pagina.waitForFunction = async () => {};
  pagina.locator = seletor => {
    if (seletor === '#inp_title') return { locator: () => ({ count:async()=>1, evaluate:async()=> 'https://redacao.tribunaweb.com.br/news/save' }) };
    return { allTextContents:async()=>[] };
  };
  const requisicao = { url:()=>'https://redacao.tribunaweb.com.br/news/save', frame:()=>frame, method:()=> 'POST',
    headers:()=>({ 'content-type':'application/x-www-form-urlencoded' }),
    postData:()=> 'title=Not%C3%ADcia+revisada&hat=CIDADES&subtitle=Resumo+novo' };
  const resposta = { request:()=>requisicao, status:()=>status,
    url:()=>retorno.url || 'https://redacao.tribunaweb.com.br/news/save',
    headers:()=>({ 'content-type':retorno.contentType || 'text/html', location:retorno.location || '' }),
    text:async()=>retorno.corpo || '' };
  return { pagina, requisicao, resposta };
}

test('envio manual só é concluído após resposta válida e confirmação do CMS', async () => {
  const mock = paginaSimulada(200, { location:'https://www.tribunadosertao.com.br/cidades/2026/10/15/1234-noticia' });
  let resolver;
  const evento = new Promise(resolve => { resolver = resolve; });
  await acompanharPublicacaoAdicao(mock.pagina, { id:'a', campos:{ titulo:'Notícia' } }, async dados => resolver(dados));
  mock.pagina.emit('request', mock.requisicao);
  mock.pagina.emit('response', mock.resposta);
  const dados = await evento;
  assert.equal(dados.tipo, 'concluido');
  assert.equal(dados.urlOriginal, 'https://www.tribunadosertao.com.br/cidades/2026/10/15/1234-noticia');
  assert.equal(dados.campos.titulo, 'Notícia revisada');
  assert.equal(dados.campos.chapeu, 'CIDADES');
});

test('não associa link apenas porque o título da página coincide', async () => {
  const mock = paginaSimulada(200, { corpo:'<a href="https://www.tribunadosertao.com.br/cidades/2026/10/15/9999-noticia">Notícia revisada</a>' });
  let resolver;
  const evento = new Promise(resolve => { resolver = resolve; });
  await acompanharPublicacaoAdicao(mock.pagina, { id:'c', campos:{ titulo:'Notícia' } }, async dados => resolver(dados));
  mock.pagina.emit('request', mock.requisicao);
  mock.pagina.emit('response', mock.resposta);
  const dados = await evento;
  assert.equal(dados.tipo, 'concluido');
  assert.equal(dados.urlOriginal, '');
});

test('resposta de erro não vira publicação concluída', async () => {
  const mock = paginaSimulada(500);
  let resolver;
  const evento = new Promise(resolve => { resolver = resolve; });
  await acompanharPublicacaoAdicao(mock.pagina, { id:'b', campos:{ titulo:'Notícia' } }, async dados => resolver(dados));
  mock.pagina.emit('request', mock.requisicao);
  mock.pagina.emit('response', mock.resposta);
  assert.equal((await evento).tipo, 'naoConfirmado');
});
