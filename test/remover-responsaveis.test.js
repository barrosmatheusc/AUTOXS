const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { criarHistoricoProducao } = require('../historico-producao');

const url1 = 'https://www.tribunadosertao.com.br/cidades/2026/10/15/1234-noticia-um';
const url2 = 'https://www.tribunadosertao.com.br/cidades/2026/10/15/1235-noticia-dois';

test('remoção de nomes iniciais e personalizados preserva matérias, atribuições e relatório', async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'autoxs-responsaveis-'));
  const arquivo = path.join(pasta, 'historico-autoxs.json');
  const relogio = () => new Date('2026-10-15T15:00:00.000Z');
  try {
    const historico = criarHistoricoProducao(arquivo, relogio);
    const personalizada = await historico.cadastrarResponsavel('Paula');
    const primeira = await historico.registrar({ operacao:'adicionar', chave:'um', titulo:'Notícia um',
      situacao:'concluido', formaConclusao:'manual', urlOriginal:url1 });
    const segunda = await historico.registrar({ operacao:'adicionar', chave:'dois', titulo:'Notícia dois',
      situacao:'concluido', formaConclusao:'manual', urlOriginal:url2 });
    await historico.responsavel(primeira.id, 'inicial-1');
    await historico.responsavel(segunda.id, personalizada.id);
    assert.equal((await historico.removerResponsavel('inicial-1')).removido, true);
    assert.equal((await historico.removerResponsavel(personalizada.id)).removido, true);
    await assert.rejects(historico.responsavel(segunda.id, personalizada.id), /indisponível/);
    await assert.rejects(historico.editarResponsavel('inicial-1', { ativo:true }), /removido/);
    const reaberto = criarHistoricoProducao(arquivo, relogio);
    const consulta = await reaberto.consultar('2026-10-15');
    assert.equal(consulta.responsaveis.find(item => item.id === 'inicial-1').removido, true);
    assert.equal(consulta.responsaveis.find(item => item.id === personalizada.id).removido, true);
    assert.equal(consulta.compartilh.find(item => item.id === primeira.id).responsavelId, 'inicial-1');
    assert.equal(consulta.compartilh.find(item => item.id === segunda.id).responsavelId, personalizada.id);
    assert.deepEqual(consulta.compartilh.map(item => item.urlOriginal).sort(), [url1,url2]);
    const relatorio = await reaberto.relatorio('2026-10-15');
    assert.deepEqual(relatorio.grupos.find(grupo => grupo.responsavel.id === 'inicial-1').urls, [url1]);
    assert.deepEqual(relatorio.grupos.find(grupo => grupo.responsavel.id === personalizada.id).urls, [url2]);
    assert.match(relatorio.texto, /LINKS VLADIMIR/);
    assert.match(relatorio.texto, /LINKS PAULA/);
    const novoInicial = await reaberto.cadastrarResponsavel('Vladimir');
    const novaPersonalizada = await reaberto.cadastrarResponsavel('Paula');
    assert.notEqual(novoInicial.id, 'inicial-1');
    assert.notEqual(novaPersonalizada.id, personalizada.id);
    assert.equal(novoInicial.ativo, true);
    assert.equal(JSON.parse(await fs.readFile(arquivo, 'utf8')).registros.length, 2);
  } finally { await fs.rm(pasta, { recursive:true, force:true }); }
});
