const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { criarHistoricoProducao } = require('../historico-producao');
const { salvarExportacao } = require('../dados-transferencia-arquivo');
const { identificarInstalacao } = require('../instalacao-autoxs');

const PUBLICA = 'https://www.tribunadosertao.com.br/cidades/2026/10/31/100001-materia-teste';
async function ambiente(executar) {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'autoxs-dados-'));
  const origemArquivo = path.join(pasta, 'origem.json');
  const destinoArquivo = path.join(pasta, 'destino.json');
  let agora = new Date('2026-10-31T15:00:00.000Z');
  const origem = criarHistoricoProducao(origemArquivo, () => agora);
  const destino = criarHistoricoProducao(destinoArquivo, () => agora);
  try {
    await executar({ pasta, origem, destino, destinoArquivo,
      relogio: iso => { agora = new Date(iso); }, instalacao:randomUUID() });
  } finally { await fs.rm(pasta, { recursive:true, force:true }); }
}
const registro = (chave, opcoes = {}) => ({ operacao:'adicionar', chave,
  titulo:`Título ${chave}`, situacao:'concluido', formaConclusao:'manual',
  urlOriginal:PUBLICA, urlCms:'https://redacao.tribunaweb.com.br/news/edit/500001', ...opcoes });

test('base vazia recebe apenas registros novos de hoje, sem responsáveis ou credenciais', async () => {
  await ambiente(async ({ origem, destino, instalacao, destinoArquivo, pasta }) => {
    await origem.registrar(registro('a'));
    const arquivo = await origem.exportarDadosHoje(instalacao);
    assert.equal(arquivo.dia, '2026-10-31');
    assert.equal(arquivo.registros.length, 1);
    assert.equal(arquivo.registros[0].responsavelId, undefined);
    assert.equal(arquivo.registros[0].urlCms, undefined);
    const previa = await destino.preverImportacao(arquivo);
    assert.equal(previa.novos, 1);
    assert.equal((await destino.importarDadosHoje(arquivo, previa)).novos, 1);
    assert.equal((await destino.consultar('2026-10-31')).estatisticas.concluidas, 1);
    assert.equal((await fs.readdir(path.join(pasta, 'backups')).catch(() => [])).length, 0);
    assert.equal((JSON.parse(await fs.readFile(destinoArquivo, 'utf8'))).registros.length, 1);
  });
});

test('mescla base existente, preserva dia anterior e não duplica importação repetida', async () => {
  await ambiente(async ({ origem, destino, instalacao, destinoArquivo, pasta, relogio }) => {
    relogio('2026-10-30T15:00:00.000Z');
    await destino.registrar(registro('ontem', { urlOriginal:'', urlCms:'https://redacao.tribunaweb.com.br/news/edit/400000' }));
    relogio('2026-10-31T15:00:00.000Z');
    await origem.registrar(registro('a'));
    await origem.registrar(registro('b', { urlOriginal:'', urlCms:'https://redacao.tribunaweb.com.br/news/edit/500002' }));
    await destino.registrar(registro('local', { urlOriginal:PUBLICA }));
    const arquivo = await origem.exportarDadosHoje(instalacao);
    const previa = await destino.preverImportacao(arquivo);
    assert.equal(previa.novos, 1);
    assert.equal(previa.repetidos, 1);
    await destino.importarDadosHoje(arquivo, previa);
    assert.equal((await destino.consultar('2026-10-30')).estatisticas.concluidas, 1);
    assert.equal((await destino.consultar('2026-10-31')).estatisticas.concluidas, 2);
    const repetida = await destino.preverImportacao(arquivo);
    assert.equal(repetida.novos, 0);
    assert.equal(repetida.repetidos, 2);
    await assert.rejects(destino.importarDadosHoje(arquivo, repetida), /Não há registros novos/);
    assert.equal((JSON.parse(await fs.readFile(destinoArquivo, 'utf8'))).registros.length, 3);
    assert.ok((await fs.readdir(path.join(pasta, 'backups'))).length >= 1);
  });
});

test('exportações consecutivas levam só novidades e atualização segura de status', async () => {
  await ambiente(async ({ origem, destino, instalacao, relogio }) => {
    await origem.registrar({ operacao:'atualizar', chave:'https://redacao.tribunaweb.com.br/news/edit/600001',
      urlCms:'https://redacao.tribunaweb.com.br/news/edit/600001', situacao:'aguardandoRevisao', titulo:'Aguardando' });
    const primeiro = await origem.exportarDadosHoje(instalacao);
    await destino.importarDadosHoje(primeiro, await destino.preverImportacao(primeiro));
    assert.equal((await destino.consultar('2026-10-31')).estatisticas.aguardandoRevisao, 1);
    relogio('2026-10-31T16:00:00.000Z');
    await origem.registrar({ operacao:'atualizar', chave:'https://redacao.tribunaweb.com.br/news/edit/600001',
      urlCms:'https://redacao.tribunaweb.com.br/news/edit/600001', situacao:'concluido', formaConclusao:'automatico' });
    await origem.registrar(registro('nova', { urlOriginal:'', urlCms:'https://redacao.tribunaweb.com.br/news/edit/600002' }));
    const segundo = await origem.exportarDadosHoje(instalacao);
    const previa = await destino.preverImportacao(segundo);
    assert.equal(previa.novos, 1);
    assert.equal(previa.atualizados, 1);
    await destino.importarDadosHoje(segundo, previa);
    const dados = await destino.consultar('2026-10-31');
    assert.equal(dados.estatisticas.concluidas, 2);
    assert.equal(dados.estatisticas.aguardandoRevisao, 0);
    assert.equal((await destino.preverImportacao(segundo)).repetidos, 2);
  });
});

test('outros dias, dados inválidos e registros sem identidade ficam fora', async () => {
  await ambiente(async ({ origem, destino, instalacao, relogio }) => {
    relogio('2026-10-30T15:00:00.000Z');
    await origem.registrar(registro('ontem'));
    const ontem = await origem.exportarDadosHoje(instalacao);
    relogio('2026-10-31T15:00:00.000Z');
    assert.equal((await destino.preverImportacao(ontem)).expirados, 1);
    await assert.rejects(destino.preverImportacao({ versao:99 }), /inválido/);
    const hoje = await origem.exportarDadosHoje(instalacao);
    assert.equal(hoje.registros.length, 0);
    const ambiguo = structuredClone(ontem);
    ambiguo.dia = '2026-10-31';
    ambiguo.registros[0].criadoEm = '2026-10-31T15:00:00.000Z';
    ambiguo.registros[0].concluidoEm = '2026-10-31T15:00:00.000Z';
    ambiguo.registros[0].origem.registro = undefined;
    assert.equal((await destino.preverImportacao(ambiguo)).invalidos, 1);
    ambiguo.registros[0].origem.registro = randomUUID();
    ambiguo.registros[0].urlOriginal = '';
    ambiguo.registros[0].cmsId = null;
    assert.equal((await destino.preverImportacao(ambiguo)).ambiguos, 1);
  });
});

test('oitavo dia permanece e nono sai pelo calendário de Maceió', async () => {
  await ambiente(async ({ origem, relogio }) => {
    relogio('2026-10-23T15:00:00.000Z');
    await origem.registrar(registro('nono', { urlOriginal:'', urlCms:'https://redacao.tribunaweb.com.br/news/edit/700001' }));
    relogio('2026-10-24T15:00:00.000Z');
    await origem.registrar(registro('oitavo', { urlOriginal:'', urlCms:'https://redacao.tribunaweb.com.br/news/edit/700002' }));
    relogio('2026-10-31T03:01:00.000Z');
    assert.equal((await origem.consultar('2026-10-24')).estatisticas.concluidas, 1);
    assert.equal((await origem.consultar('2026-10-23')).estatisticas.concluidas, 0);
    assert.equal(await origem.limparExpirados(), 1);
  });
});

test('links duplicados não aumentam contagem e arquivo exportado não é sobrescrito', async () => {
  await ambiente(async ({ origem, destino, instalacao, pasta }) => {
    await origem.registrar(registro('a'));
    const arquivo = await origem.exportarDadosHoje(instalacao);
    arquivo.registros.push({ ...structuredClone(arquivo.registros[0]),
      origem:{ instalacao, registro:randomUUID() } });
    const previa = await destino.preverImportacao(arquivo);
    assert.equal(previa.novos, 1);
    assert.equal(previa.repetidos, 1);
    const caminho = path.join(pasta, 'AUTOXS_DADOS_2026-10-31.json');
    assert.equal((await salvarExportacao(arquivo, async () => caminho)).registros, 2);
    await assert.rejects(salvarExportacao(arquivo, async () => caminho), /já existe/);
    assert.equal(JSON.parse(await fs.readFile(caminho, 'utf8')).registros.length, 2);
    const idArquivo = path.join(pasta, 'instalacao.id');
    assert.equal(await identificarInstalacao(idArquivo), await identificarInstalacao(idArquivo));
  });
});

test('falha ao gravar mantém o histórico original e o backup', async () => {
  await ambiente(async ({ origem, destino, instalacao, destinoArquivo, pasta }) => {
    await destino.registrar(registro('local', { urlOriginal:'', urlCms:'https://redacao.tribunaweb.com.br/news/edit/800001' }));
    await origem.registrar(registro('novo'));
    const documento = await origem.exportarDadosHoje(instalacao);
    const previa = await destino.preverImportacao(documento);
    const original = await fs.readFile(destinoArquivo, 'utf8');
    const renomear = fs.rename;
    fs.rename = async (de, para) => {
      if (para === destinoArquivo) throw Object.assign(new Error('falha simulada'), { code:'EIO' });
      return renomear(de, para);
    };
    try { await assert.rejects(destino.importarDadosHoje(documento, previa), /falha simulada/); }
    finally { fs.rename = renomear; }
    assert.equal(await fs.readFile(destinoArquivo, 'utf8'), original);
    assert.ok((await fs.readdir(path.join(pasta, 'backups'))).length >= 1);
  });
});
