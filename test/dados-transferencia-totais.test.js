const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { criarHistoricoProducao } = require('../historico-producao');

const url = n => `https://www.tribunadosertao.com.br/cidades/2026/11/03/${n}-materia`;
async function ambiente(funcao) {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'autoxs-totais-'));
  let agora = new Date('2026-11-03T15:00:00Z');
  const a = criarHistoricoProducao(path.join(pasta, 'a.json'), () => agora);
  const b = criarHistoricoProducao(path.join(pasta, 'b.json'), () => agora);
  const idA = randomUUID(), idB = randomUUID();
  try { await funcao({ a, b, idA, idB, pasta, relogio: valor => { agora = new Date(valor); } }); }
  finally { await fs.rm(pasta, { recursive:true, force:true }); }
}
async function transferir(origem, destino, idOrigem, idDestino) {
  const arquivo = await origem.exportarDadosHoje(idOrigem);
  const previa = await destino.preverImportacao(arquivo, idDestino);
  await destino.importarDadosHoje(arquivo, previa, idDestino);
  return { arquivo, previa };
}
const entrada = (id, link = url(id)) => ({ operacao:'adicionar', chave:id, titulo:`Matéria ${id}`,
  situacao:'concluido', formaConclusao:'manual', urlOriginal:link });

test('totais por origem e links são transferidos sem detalhes de produção', async () => {
  await ambiente(async ({ a, b, idA, idB, pasta }) => {
    await a.registrar(entrada('100001'));
    const { arquivo, previa } = await transferir(a, b, idA, idB);
    assert.equal(arquivo.versao, 2);
    assert.equal(arquivo.registros, undefined);
    assert.deepEqual(Object.keys(arquivo.estatisticas[0].totais).sort(),
      ['concluidas','atualizacoesAutomaticas','finalizadasManualmente','adicionadas','aguardandoRevisao','erros'].sort());
    assert.equal(previa.novosTotais, 1);
    assert.equal(previa.novosLinks, 1);
    assert.equal((await b.consultar()).estatisticas.concluidas, 1);
    assert.equal((await b.consultar()).compartilh.length, 1);
    const salvo = JSON.parse(await fs.readFile(path.join(pasta, 'b.json'), 'utf8'));
    assert.equal(salvo.registros.length, 1);
    assert.equal(salvo.registros[0].responsavelId, null);
  });
});

test('reimportação e troca bidirecional não contam duas vezes', async () => {
  await ambiente(async ({ a, b, idA, idB, relogio }) => {
    await a.registrar(entrada('100001'));
    await b.registrar(entrada('100002'));
    const primeira = await transferir(a, b, idA, idB);
    const repetida = await b.preverImportacao(primeira.arquivo, idB);
    assert.equal(repetida.novosTotais + repetida.atualizadosTotais + repetida.novosLinks, 0);
    await b.importarDadosHoje(primeira.arquivo, repetida, idB);
    await transferir(b, a, idB, idA);
    await transferir(a, b, idA, idB);
    assert.equal((await a.consultar()).estatisticas.concluidas, 2);
    assert.equal((await b.consultar()).estatisticas.concluidas, 2);
    relogio('2026-11-03T16:00:00Z');
    await a.registrar(entrada('100003'));
    await transferir(a, b, idA, idB);
    assert.equal((await b.consultar()).estatisticas.concluidas, 3);
    assert.equal((await b.consultar()).compartilh.length, 3);
  });
});

test('arquivo v1 soma seis indicadores sem URL ou CMS ID e preserva histórico antigo', async () => {
  await ambiente(async ({ b, idA, idB, pasta, relogio }) => {
    relogio('2026-11-02T15:00:00Z');
    await b.registrar(entrada('100009', ''));
    relogio('2026-11-03T15:00:00Z');
    const velho = { versao:1, instalacao:idA, dia:'2026-11-03', exportadoEm:'2026-11-03T15:00:00Z',
      registros:[
        { origem:{instalacao:idA,registro:randomUUID()}, operacao:'atualizar', situacao:'concluido',
          formaConclusao:'automatico', criadoEm:'2026-11-03T12:00:00Z',
          concluidoEm:'2026-11-03T13:00:00Z', titulo:'Sem ID', chapeu:'', subtitulo:'', urlOriginal:'' },
        { origem:{instalacao:idA,registro:randomUUID()}, operacao:'atualizar', situacao:'aguardandoRevisao',
          criadoEm:'2026-11-03T14:00:00Z', titulo:'Pendente', chapeu:'', subtitulo:'', urlOriginal:'' }
      ] };
    const previa = await b.preverImportacao(velho, idB);
    assert.equal(previa.novosTotais, 1);
    await b.importarDadosHoje(velho, previa, idB);
    assert.equal((await b.consultar()).estatisticas.concluidas, 1);
    assert.equal((await b.consultar()).estatisticas.aguardandoRevisao, 1);
    assert.equal((await b.consultar('2026-11-02')).estatisticas.concluidas, 1);
    const salvo = JSON.parse(await fs.readFile(path.join(pasta, 'b.json'), 'utf8'));
    assert.equal(salvo.registros.length, 1);
    assert.ok((await fs.readdir(path.join(pasta, 'backups'))).length >= 1);
  });
});

test('totais novos substituem a contagem de cópias antigas sem apagar registros existentes', async () => {
  await ambiente(async ({ a, b, idA, idB, pasta }) => {
    await a.registrar(entrada('100001'));
    await b.registrar(entrada('100002'));
    const caminho = path.join(pasta, 'b.json');
    const estado = JSON.parse(await fs.readFile(caminho, 'utf8'));
    estado.registros.push({ ...structuredClone(estado.registros[0]), id:randomUUID(),
      chave:`importado:${idA}:${randomUUID()}`, origemInstalacao:idA,
      origemRegistroId:randomUUID(), urlOriginal:'' });
    await fs.writeFile(caminho, JSON.stringify(estado));
    assert.equal((await b.consultar()).estatisticas.concluidas, 2);
    const resultado = await transferir(a, b, idA, idB);
    assert.equal(resultado.previa.atualizadosTotais, 1);
    assert.equal((await b.consultar()).estatisticas.concluidas, 2);
    assert.equal(JSON.parse(await fs.readFile(caminho, 'utf8')).registros.length, 3);
  });
});
