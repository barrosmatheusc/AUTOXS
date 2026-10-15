const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { criarHistoricoProducao, RETENCAO_MS } = require('../historico-producao');

async function ambiente(executar) {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'autoxs-retencao-'));
  const arquivo = path.join(pasta, 'historico-autoxs.json');
  let instante = new Date('2026-10-07T14:59:59.999Z');
  const historico = criarHistoricoProducao(arquivo, () => instante);
  try {
    await executar({ historico, arquivo, ajustar: iso => { instante = new Date(iso); } });
  } finally { await fs.rm(pasta, { recursive:true, force:true }); }
}

test('prazo exato de 8 dias usa hora de conclusão e não a última edição', async () => {
  await ambiente(async ({ historico, ajustar }) => {
    const antigo = await historico.registrar({ operacao:'adicionar', chave:'antigo',
      titulo:'Antigo', situacao:'concluido', formaConclusao:'manual' });
    ajustar('2026-10-07T15:00:00.000Z');
    const limite = await historico.registrar({ operacao:'adicionar', chave:'limite',
      titulo:'No limite', situacao:'concluido', formaConclusao:'manual' });
    ajustar('2026-10-15T14:59:59.999Z');
    await historico.responsavel(antigo.id, 'inicial-1');
    ajustar('2026-10-15T15:00:00.000Z');
    assert.equal(RETENCAO_MS, 8 * 24 * 60 * 60 * 1000);
    assert.deepEqual((await historico.publicadas()).map(item => item.id), [limite.id]);
    assert.equal(await historico.limparExpirados(), 1);
    assert.equal((await historico.consultar('2026-10-07')).estatisticas.concluidas, 1);
    ajustar('2026-10-15T15:00:00.001Z');
    assert.equal((await historico.consultar('2026-10-07')).estatisticas.concluidas, 0);
    assert.equal(await historico.limparExpirados(), 1);
  });
});

test('virada de data usa oito períodos de 24 horas, sem apagar conclusão recente', async () => {
  await ambiente(async ({ historico, ajustar }) => {
    ajustar('2026-10-06T23:59:00.000Z');
    const rascunho = await historico.registrar({ operacao:'adicionar', chave:'conclusao-recente',
      titulo:'Concluída depois', situacao:'aguardandoRevisao' });
    ajustar('2026-10-14T23:59:00.000Z');
    await historico.registrar({ operacao:'adicionar', chave:'conclusao-recente',
      situacao:'concluido', formaConclusao:'manual' });
    ajustar('2026-10-15T00:01:00.000Z');
    assert.equal(await historico.limparExpirados(), 0);
    assert.deepEqual((await historico.publicadas()).map(item => item.id), [rascunho.id]);
    assert.equal((await historico.relatorio('2026-10-14')).semResponsavel.length, 1);
  });
});

test('limpeza preserva responsáveis, configurações e JSON íntegro', async () => {
  await ambiente(async ({ historico, arquivo, ajustar }) => {
    await historico.registrar({ operacao:'adicionar', chave:'antigo',
      situacao:'concluido', formaConclusao:'manual' });
    const responsavel = await historico.cadastrarResponsavel('Equipe personalizada');
    const antes = JSON.parse(await fs.readFile(arquivo, 'utf8'));
    antes.configuracoes = { tema:'escuro', preferencia:'manter' };
    await fs.writeFile(arquivo, JSON.stringify(antes, null, 2) + '\n');
    ajustar('2026-10-15T15:00:00.000Z');
    assert.equal(await historico.limparExpirados(), 1);
    const depois = JSON.parse(await fs.readFile(arquivo, 'utf8'));
    assert.equal(depois.registros.length, 0);
    assert.deepEqual(depois.configuracoes, antes.configuracoes);
    assert.deepEqual(depois.responsaveis.find(item => item.id === responsavel.id), responsavel);
    assert.equal(await historico.limparExpirados(), 0);
    assert.deepEqual(JSON.parse(await fs.readFile(arquivo, 'utf8')), depois);
  });
});

test('registros expirados não reaparecem nas leituras nem na recuperação de links', async () => {
  await ambiente(async ({ historico, arquivo, ajustar }) => {
    const antigo = await historico.registrar({ operacao:'adicionar', chave:'pendente-antigo',
      titulo:'Pendente antigo', urlCms:'https://redacao.tribunaweb.com.br/news/edit/1',
      situacao:'concluido', formaConclusao:'manual' });
    ajustar('2026-10-15T15:00:00.000Z');
    assert.equal((await historico.consultar('2026-10-07')).compartilh.length, 0);
    assert.equal((await historico.relatorio('2026-10-07')).semUrl.length, 0);
    assert.deepEqual(await historico.publicadas(), []);
    assert.deepEqual(await historico.pendentesRecuperaveis(), []);
    await assert.rejects(historico.compartilhavel(antigo.id), /não disponível/);
    assert.equal(await historico.limparExpirados(), 1);
    assert.deepEqual(JSON.parse(await fs.readFile(arquivo, 'utf8')).registros, []);
    const reaberto = criarHistoricoProducao(arquivo, () => new Date('2026-10-15T15:00:00.000Z'));
    assert.deepEqual(await reaberto.publicadas(), []);
  });
});

test('registros sem conclusão usam a criação e arquivo inválido não é sobrescrito', async () => {
  await ambiente(async ({ historico, arquivo, ajustar }) => {
    const pendente = await historico.registrar({ operacao:'atualizar', chave:'revisao-antiga',
      situacao:'aguardandoRevisao' });
    ajustar('2026-10-15T15:00:00.000Z');
    assert.equal((await historico.consultar('2026-10-07')).registros.length, 0);
    assert.equal(await historico.limparExpirados(), 1);
    assert.equal(JSON.parse(await fs.readFile(arquivo, 'utf8')).registros.some(item => item.id === pendente.id), false);
    const semDataConfiavel = JSON.parse(await fs.readFile(arquivo, 'utf8'));
    semDataConfiavel.registros.push({ ...pendente, criadoEm:'data inválida' });
    await fs.writeFile(arquivo, JSON.stringify(semDataConfiavel));
    assert.equal(await historico.limparExpirados(), 0);
    assert.equal((await historico.consultar('2026-10-07')).registros.length, 0);
    assert.equal(JSON.parse(await fs.readFile(arquivo, 'utf8')).registros.length, 1);
    const conteudoInvalido = '{"versao":1,"registros":';
    await fs.writeFile(arquivo, conteudoInvalido);
    await assert.rejects(historico.limparExpirados(), SyntaxError);
    assert.equal(await fs.readFile(arquivo, 'utf8'), conteudoInvalido);
  });
});
