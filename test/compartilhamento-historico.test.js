const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chaveTitulo, encontrarLinkPorTitulo } = require('../compartilhar-materias');
const { criarHistoricoProducao } = require('../historico-producao');
const { recuperarLinksPorCompartilhamento } = require('../painel-producao');

const url1 = 'https://www.tribunadosertao.com.br/cidades/2026/10/15/1234-noticia';
const url2 = 'https://www.tribunadosertao.com.br/politica/2026/10/15/9999-outra';

async function comHistorico(fn) {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'autoxs-compartilhar-'));
  try { await fn(criarHistoricoProducao(path.join(pasta, 'historico.json'), () => new Date('2026-10-15T15:00:00Z'))); }
  finally { await fs.rm(pasta, { recursive:true, force:true }); }
}

test('correspondência tolera pontuação, espaços e acentos, retornando somente a URL', () => {
  assert.equal(chaveTitulo('  São  José: vitória! '), chaveTitulo('Sao Jose - vitoria'));
  const resultado = encontrarLinkPorTitulo('  São  José: vitória! ', [
    { titulo:'Sao Jose - vitoria', url:url1 }, { titulo:'Outra notícia', url:url2 }
  ]);
  assert.deepEqual(resultado, { url:url1, motivo:'' });
  assert.equal(resultado.url.includes('*'), false);
});

test('títulos iguais em URLs diferentes são ambíguos; URL administrativa e título fraco são recusados', () => {
  const titulo = 'Notícia sobre eleições em Alagoas';
  assert.match(encontrarLinkPorTitulo(titulo, [
    { titulo, url:url1 }, { titulo:'Noticia sobre eleicoes em Alagoas', url:url2 }
  ]).motivo, /Mais de uma/);
  assert.equal(encontrarLinkPorTitulo(titulo, [{ titulo, url:'https://redacao.tribunaweb.com.br/news/edit/1234' }]).url, '');
  assert.equal(encontrarLinkPorTitulo('Oi', [{ titulo:'Oi', url:url1 }]).url, '');
});

test('busca reutilizada recupera publicação antiga pendente, persiste e não usa texto compartilhável', async () => {
  await comHistorico(async historico => {
    const item = await historico.registrar({ operacao:'adicionar', chave:'antiga', titulo:'São José: vitória!',
      situacao:'concluido', formaConclusao:'manual' });
    let consultas = 0;
    const compartilhamento = { consultarCandidatos:async()=>{ consultas++; return [
      { titulo:'Sao Jose - vitoria', url:url1 }
    ]; } };
    assert.equal(await recuperarLinksPorCompartilhamento(historico, compartilhamento), 1);
    assert.equal(consultas, 1);
    const resultado = (await historico.consultar('2026-10-15')).compartilh[0];
    assert.equal(resultado.id, item.id);
    assert.equal(resultado.urlOriginal, url1);
    assert.equal(resultado.motivoLinkPendente, '');
  });
});

test('não associa se houver dois registros com o mesmo título, mesmo havendo uma URL candidata', async () => {
  await comHistorico(async historico => {
    const a = await historico.registrar({ operacao:'adicionar', chave:'a', titulo:'Mesma notícia de hoje',
      situacao:'concluido', formaConclusao:'manual' });
    const b = await historico.registrar({ operacao:'adicionar', chave:'b', titulo:'Mesma noticia de hoje!',
      situacao:'concluido', formaConclusao:'manual' });
    const compartilhamento = { consultarCandidatos:async()=>[{ titulo:'Mesma notícia de hoje', url:url1 }] };
    assert.equal(await recuperarLinksPorCompartilhamento(historico, compartilhamento), 0);
    const dados = (await historico.consultar('2026-10-15')).compartilh;
    for (const id of [a.id,b.id]) {
      const item = dados.find(registro => registro.id === id);
      assert.equal(item.urlOriginal, '');
      assert.match(item.motivoLinkPendente, /títulos iguais/);
    }
  });
});

test('não associa link de data incompatível, URL já usada ou candidato ausente', async () => {
  await comHistorico(async historico => {
    const usado = await historico.registrar({ operacao:'adicionar', chave:'usado', titulo:'Matéria anterior',
      situacao:'concluido', formaConclusao:'manual', urlOriginal:url1 });
    const pendente = await historico.registrar({ operacao:'adicionar', chave:'pendente', titulo:'Nova notícia importante',
      situacao:'concluido', formaConclusao:'manual' });
    const compartilhamento = { consultarCandidatos:async()=>[{ titulo:'Nova notícia importante', url:url1 }] };
    assert.equal(await recuperarLinksPorCompartilhamento(historico, compartilhamento, pendente.id), 0);
    assert.match((await historico.consultar('2026-10-15')).compartilh.find(i=>i.id===pendente.id).motivoLinkPendente, /já está associada/);
    compartilhamento.consultarCandidatos = async()=>[{ titulo:'Nova notícia importante',
      url:'https://www.tribunadosertao.com.br/cidades/2025/10/15/1234-antiga' }];
    assert.equal(await recuperarLinksPorCompartilhamento(historico, compartilhamento, pendente.id), 0);
    assert.match((await historico.consultar('2026-10-15')).compartilh.find(i=>i.id===pendente.id).motivoLinkPendente, /data/);
    compartilhamento.consultarCandidatos = async()=>[];
    assert.equal(await recuperarLinksPorCompartilhamento(historico, compartilhamento, pendente.id), 0);
    assert.match((await historico.consultar('2026-10-15')).compartilh.find(i=>i.id===pendente.id).motivoLinkPendente, /não encontrado/);
    assert.equal((await historico.consultar('2026-10-15')).compartilh.find(i=>i.id===usado.id).urlOriginal, url1);
  });
});
