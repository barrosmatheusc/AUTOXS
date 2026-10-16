const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { criarHistoricoProducao, urlPublica } = require('../historico-producao');
const { recuperarLinksPendentes } = require('../painel-producao');

async function comHistorico(executar) {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'autoxs-producao-'));
  const arquivo = path.join(pasta, 'historico.json');
  let instante = new Date('2026-10-15T15:00:00.000Z');
  const historico = criarHistoricoProducao(arquivo, () => instante);
  try { await executar({ historico, arquivo, avancar: iso => { instante = new Date(iso); } }); }
  finally { await fs.rm(arquivo, { force:true }); await fs.rmdir(pasta); }
}

const url1 = 'https://www.tribunadosertao.com.br/cidades/2026/10/15/1234-noticia-um';
const url2 = 'https://www.tribunadosertao.com.br/politica/2026/10/15/1235-noticia-dois';

test('preparação não conta como conclusão; confirmação manual/automática conta uma única vez', async () => {
  await comHistorico(async ({ historico, avancar }) => {
    await historico.registrar({ operacao:'adicionar', chave:'rascunho-1', titulo:'Notícia um', situacao:'aguardandoRevisao' });
    await historico.registrar({ operacao:'atualizar', chave:'cms-1', titulo:'Atualização', situacao:'aguardandoRevisao' });
    let dados = await historico.consultar('2026-10-15');
    assert.equal(dados.estatisticas.concluidas, 0);
    assert.equal(dados.estatisticas.aguardandoRevisao, 2);
    await historico.registrar({ operacao:'adicionar', chave:'rascunho-1', situacao:'concluido', formaConclusao:'manual', urlOriginal:url1 });
    await historico.registrar({ operacao:'adicionar', chave:'rascunho-1', situacao:'concluido', formaConclusao:'manual' });
    await historico.registrar({ operacao:'atualizar', chave:'cms-1', situacao:'concluido', formaConclusao:'automatico' });
    dados = await historico.consultar('2026-10-15');
    assert.deepEqual(dados.estatisticas, { concluidas:2, atualizacoesAutomaticas:1, finalizadasManualmente:1, adicionadas:1, aguardandoRevisao:0, erros:0 });
    assert.equal(dados.compartilh.length, 1);
    assert.equal(dados.compartilh[0].urlOriginal, url1);
    avancar('2026-10-16T15:00:00.000Z');
    await historico.registrar({ operacao:'adicionar', chave:'rascunho-1', situacao:'aguardandoRevisao' });
    assert.equal((await historico.consultar('2026-10-15')).estatisticas.concluidas, 2);
    assert.equal((await historico.consultar('2026-10-16')).estatisticas.concluidas, 0);
  });
});

test('atualização manual, falha e ausência de confirmação ficam separadas', async () => {
  await comHistorico(async ({ historico }) => {
    await historico.registrar({ operacao:'atualizar', chave:'cms-2', situacao:'concluido', formaConclusao:'manual' });
    await historico.registrar({ operacao:'atualizar', chave:'cms-3', situacao:'erro' });
    await historico.registrar({ operacao:'adicionar', chave:'rascunho-2', situacao:'naoConfirmado' });
    const dados = await historico.consultar('2026-10-15');
    assert.equal(dados.estatisticas.finalizadasManualmente, 1);
    assert.equal(dados.estatisticas.atualizacoesAutomaticas, 0);
    assert.equal(dados.estatisticas.adicionadas, 0);
    assert.equal(dados.estatisticas.erros, 2);
  });
});

test('responsável único pode ser escolhido, trocado, removido e recuperado do arquivo', async () => {
  await comHistorico(async ({ historico, arquivo }) => {
    const materia = await historico.registrar({ operacao:'adicionar', chave:'rascunho-1', titulo:'Notícia um', situacao:'concluido', formaConclusao:'manual', urlOriginal:url1 });
    const novo = await historico.cadastrarResponsavel('Paula');
    await historico.responsavel(materia.id, 'inicial-1');
    await historico.responsavel(materia.id, novo.id);
    let outro = criarHistoricoProducao(arquivo);
    assert.equal((await outro.consultar('2026-10-15')).compartilh[0].responsavelId, novo.id);
    await outro.responsavel(materia.id, novo.id);
    assert.equal((await historico.consultar('2026-10-15')).compartilh[0].responsavelId, null);
    await historico.editarResponsavel(novo.id, { nome:'Paula Lima', ativo:false });
    outro = criarHistoricoProducao(arquivo);
    assert.deepEqual((await outro.consultar('2026-10-15')).responsaveis.find(item => item.id === novo.id), { id:novo.id, nome:'Paula Lima', ativo:false });
  });
});

test('matérias por responsável contam dia e oito dias sem duplicar URL nem seleção', async () => {
  await comHistorico(async ({ historico, arquivo, avancar }) => {
    const pessoa = await historico.cadastrarResponsavel('Email');
    avancar('2026-10-14T15:00:00.000Z');
    const primeira = await historico.registrar({ operacao:'adicionar', chave:'dia-1', titulo:'Primeira',
      situacao:'concluido', formaConclusao:'manual', urlOriginal:url1 });
    await historico.responsavel(primeira.id, pessoa.id);
    await historico.responsavel(primeira.id, pessoa.id); // Desfaz a seleção.
    assert.equal((await historico.materiasPorResponsavel('2026-10-14')).dia.total, 0);
    await historico.responsavel(primeira.id, pessoa.id);
    await historico.responsavel(primeira.id, 'inicial-1'); // Troca sem aumentar o total.
    const segunda = await historico.registrar({ operacao:'adicionar', chave:'dia-1-outra', titulo:'Segunda',
      situacao:'concluido', formaConclusao:'manual', urlOriginal:url2 });
    await historico.responsavel(segunda.id, 'inicial-2');
    let resumo = await historico.materiasPorResponsavel('2026-10-14');
    assert.equal(resumo.dia.total, 2);
    assert.equal(resumo.dia.grupos.find(grupo=>grupo.nome==='Vladimir').quantidade, 1);
    assert.equal(resumo.dia.grupos.find(grupo=>grupo.nome==='Email').quantidade, 0);

    avancar('2026-10-15T15:00:00.000Z');
    const repetida = await historico.registrar({ operacao:'adicionar', chave:'dia-2-duplicada', titulo:'Cópia',
      situacao:'concluido', formaConclusao:'manual', urlOriginal:url1.replace('www.', '')+'?utm_source=teste' });
    const semUrl = await historico.registrar({ operacao:'adicionar', chave:'dia-2-sem-url', titulo:'Sem URL',
      situacao:'concluido', formaConclusao:'manual' });
    await historico.responsavel(repetida.id, pessoa.id);
    await historico.responsavel(semUrl.id, pessoa.id);
    resumo = await historico.materiasPorResponsavel('2026-10-15');
    assert.equal(resumo.dia.total, 2);
    assert.equal(resumo.periodo.total, 3); // A mesma URL em dois registros conta uma vez.
    assert.equal(resumo.periodo.grupos.find(grupo=>grupo.nome==='Email').quantidade, 2);
    assert.equal(resumo.periodo.grupos.find(grupo=>grupo.nome==='Cinara').quantidade, 1);
    assert.equal((await historico.materiasPorResponsavel('2026-10-14')).dia.total, 1);

    await historico.removerResponsavel(pessoa.id);
    const reaberto = criarHistoricoProducao(arquivo, () => new Date('2026-10-15T15:00:00.000Z'));
    assert.equal((await reaberto.materiasPorResponsavel('2026-10-15')).periodo.grupos.find(grupo=>grupo.nome==='Email').quantidade, 2);
    avancar('2026-10-23T15:00:00.001Z');
    assert.equal((await historico.materiasPorResponsavel('2026-10-15')).periodo.total, 0);
  });
});

test('relatório separa dia e responsável, deduplica URLs e aponta pendências', async () => {
  await comHistorico(async ({ historico, avancar }) => {
    const a = await historico.registrar({ operacao:'adicionar', chave:'a', titulo:'Um', situacao:'concluido', formaConclusao:'manual', urlOriginal:url1 });
    const b = await historico.registrar({ operacao:'adicionar', chave:'b', titulo:'Dois', situacao:'concluido', formaConclusao:'manual', urlOriginal:url2 });
    const duplicada = await historico.registrar({ operacao:'adicionar', chave:'c', titulo:'Cópia', situacao:'concluido', formaConclusao:'manual', urlOriginal:url1 });
    await historico.registrar({ operacao:'atualizar', chave:'atualizada', titulo:'Outra', situacao:'concluido', formaConclusao:'automatico' });
    const semResponsavel = await historico.registrar({ operacao:'adicionar', chave:'d', titulo:'Sem responsável', situacao:'concluido', formaConclusao:'manual', urlOriginal:url2 });
    const semUrl = await historico.registrar({ operacao:'adicionar', chave:'e', titulo:'Sem URL', situacao:'concluido', formaConclusao:'manual' });
    await historico.responsavel(a.id, 'inicial-1');
    await historico.responsavel(b.id, 'inicial-2');
    await historico.responsavel(duplicada.id, 'inicial-1');
    await historico.responsavel(semUrl.id, 'inicial-3');
    const relatorio = await historico.relatorio('2026-10-15');
    assert.deepEqual(relatorio.grupos.find(g => g.responsavel.nome === 'Vladimir').urls, [url1]);
    assert.deepEqual(relatorio.grupos.find(g => g.responsavel.nome === 'Cinara').urls, [url2]);
    assert.deepEqual(relatorio.semResponsavel.map(item => item.id), [semResponsavel.id]);
    assert.deepEqual(relatorio.semUrl.map(item => item.id), [semUrl.id]);
    assert.deepEqual(relatorio.duplicados.map(item => item.id), [duplicada.id]);
    assert.equal(relatorio.texto.includes('Outra'), false);
    assert.equal(relatorio.texto.split(url1).length - 1, 1);
    avancar('2026-10-16T15:00:00.000Z');
    await historico.registrar({ operacao:'adicionar', chave:'dia-2', situacao:'concluido', formaConclusao:'manual', urlOriginal:url2 });
    assert.equal((await historico.relatorio('2026-10-16')).semResponsavel.length, 1);
    assert.equal((await historico.relatorio('2026-10-15')).semResponsavel.length, 1);
  });
});

test('compartilhável usa formato editorial e só URL pública original', async () => {
  await comHistorico(async ({ historico }) => {
    const item = await historico.registrar({ operacao:'adicionar', chave:'a', titulo:'Título', chapeu:'CIDADES', subtitulo:'Resumo', situacao:'concluido', formaConclusao:'manual' });
    await assert.rejects(historico.compartilhavel(item.id), /Link original/);
    await historico.definirUrl(item.id, url1);
    assert.equal(await historico.compartilhavel(item.id), `*CIDADES*\n\n*Título*\n\n*_Resumo_*\n\n${url1}`);
    assert.equal(urlPublica('https://redacao.tribunaweb.com.br/news/edit/1'), '');
    assert.equal(urlPublica('https://www.tribunadosertao.com.br.evil.test/cidades/2026/10/15/1234-x'), '');
  });
});

test('recuperação isolada consulta somente edição identificada e persiste URL da mesma matéria', async () => {
  await comHistorico(async ({ historico, arquivo }) => {
    const cms = 'https://redacao.tribunaweb.com.br/news/edit/1234';
    const item = await historico.registrar({ operacao:'adicionar', chave:'rascunho-1234', titulo:'Título alterado',
      situacao:'concluido', formaConclusao:'manual', urlCms:cms });
    const antigo = await historico.registrar({ operacao:'adicionar', chave:'rascunho-antigo', titulo:'Título igual',
      situacao:'concluido', formaConclusao:'manual' });
    const consultas = [];
    const request = { get:async url => {
      consultas.push(url);
      return { status:()=>200, url:()=>url, headers:()=>({ 'content-type':'text/html' }),
        text:async()=>`<a href="${url1}">Visualizar</a>` };
    } };
    assert.equal(await recuperarLinksPendentes(historico, request), 1);
    assert.deepEqual(consultas, [cms]);
    const reaberto = criarHistoricoProducao(arquivo);
    const registros = (await reaberto.consultar('2026-10-15')).compartilh;
    assert.equal(registros.find(registro => registro.id === item.id).urlOriginal, url1);
    assert.equal(registros.find(registro => registro.id === antigo.id).urlOriginal, '');
    assert.equal(await reaberto.compartilhavel(item.id), `*Título alterado*\n\n${url1}`);
  });
});

test('recuperação recusa ID divergente, redirecionamento e associação trocada', async () => {
  await comHistorico(async ({ historico }) => {
    const cms = 'https://redacao.tribunaweb.com.br/news/edit/1234';
    const item = await historico.registrar({ operacao:'adicionar', chave:'rascunho', situacao:'concluido',
      formaConclusao:'manual', urlCms:cms });
    const resposta = { status:()=>200, url:()=>cms, headers:()=>({ 'content-type':'text/html' }),
      text:async()=>`<a href="${url2}">Visualizar</a>` };
    assert.equal(await recuperarLinksPendentes(historico, { get:async()=>resposta }), 0);
    assert.equal((await historico.consultar('2026-10-15')).compartilh[0].urlOriginal, '');
    await assert.rejects(historico.definirUrlRecuperada(item.id,
      'https://redacao.tribunaweb.com.br/news/edit/9999', url1), /não corresponde/);
    assert.equal(await recuperarLinksPendentes(historico, { get:async()=>({ ...resposta,
      url:()=> 'https://redacao.tribunaweb.com.br/login' }) }), 0);
  });
});

test('histórico avisa o painel após persistir o link e não altera outro registro', async () => {
  await comHistorico(async ({ historico }) => {
    const chamadas = [];
    const deixarDeObservar = historico.observar(() => chamadas.push('atualizar'));
    const a = await historico.registrar({ operacao:'adicionar', chave:'a', situacao:'concluido', formaConclusao:'manual' });
    const b = await historico.registrar({ operacao:'adicionar', chave:'b', situacao:'concluido', formaConclusao:'manual' });
    await historico.definirUrl(a.id, url1);
    assert.equal(chamadas.length, 3);
    const registros = (await historico.consultar('2026-10-15')).compartilh;
    assert.equal(registros.find(item => item.id === a.id).urlOriginal, url1);
    assert.equal(registros.find(item => item.id === b.id).urlOriginal, '');
    deixarDeObservar();
    await historico.definirUrl(b.id, url2);
    assert.equal(chamadas.length, 3);
  });
});
