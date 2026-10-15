const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extrairDadosPublicacao } = require('../url-publicacao-cms');

const cms = 'https://redacao.tribunaweb.com.br/news/edit/1234';
const publica = 'https://www.tribunadosertao.com.br/cidades/2026/10/15/1234-noticia';
const outra = 'https://www.tribunadosertao.com.br/cidades/2026/10/15/9999-outra';

test('aceita URL pública fornecida pela resposta do envio e rejeita URL administrativa', () => {
  assert.equal(extrairDadosPublicacao({ location: publica }).urlOriginal, publica);
  assert.deepEqual(extrairDadosPublicacao({ location: cms }), { urlOriginal:'', urlCms:cms, ambiguo:false });
  assert.equal(extrairDadosPublicacao({ location:'https://redacao.tribunaweb.com.br/news' }).urlOriginal, '');
});

test('aceita permalink explícito no JSON do envio, sem procurar por título', () => {
  const dados = extrairDadosPublicacao({ contentType:'application/json', corpo:JSON.stringify({ article:{ public_url:publica, title:'Outro título' } }) });
  assert.equal(dados.urlOriginal, publica);
  assert.equal(extrairDadosPublicacao({ contentType:'application/json', corpo:JSON.stringify({ title:'Notícia', url:outra }) }).urlOriginal, '');
  assert.deepEqual(extrairDadosPublicacao({ contentType:'application/json', corpo:JSON.stringify({
    article:{ edit_url:cms, public_url:publica }
  }) }), { urlOriginal:publica, urlCms:cms, ambiguo:false });
});

test('página de edição só fornece link Visualizar ou canonical do mesmo identificador', () => {
  const html = `<a href="${publica}">Visualizar</a><a href="${outra}">Notícia</a>`;
  assert.equal(extrairDadosPublicacao({ urlResposta:cms, contentType:'text/html', corpo:html }).urlOriginal, publica);
  assert.equal(extrairDadosPublicacao({ urlResposta:cms, contentType:'text/html', corpo:`<a href="${outra}">Visualizar</a>` }).urlOriginal, '');
  assert.equal(extrairDadosPublicacao({ urlResposta:'https://redacao.tribunaweb.com.br/news', contentType:'text/html', corpo:html }).urlOriginal, '');
});

test('múltiplos candidatos e URLs inválidas não são associados à matéria', () => {
  assert.deepEqual(extrairDadosPublicacao({ contentType:'application/json', corpo:JSON.stringify({ public_url:publica, permalink:outra }) }),
    { urlOriginal:'', urlCms:'', ambiguo:true });
  for (const location of ['https://redacao.tribunaweb.com.br/news/edit/1234',
    'https://tribunadosertao.com.br.evil.test/cidades/2026/10/15/1234-x',
    'https://www.tribunadosertao.com.br/']) {
    assert.equal(extrairDadosPublicacao({ location }).urlOriginal, '');
  }
});
