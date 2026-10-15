const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { numeroPaginaUltimas, proximaPaginaUltimas, percorrerPaginasUltimas } = require('../compartilhar-materias');
const { criarHistoricoProducao } = require('../historico-producao');
const { criarBuscadorLinks } = require('../painel-producao');

const base = 'https://www.tribunadosertao.com.br/noticias/ultimas';
const link = 'https://www.tribunadosertao.com.br/cidades/2026/10/15/1234-papa-apresenta-boa-recuperacao';

async function comHistorico(fn) {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'autoxs-paginacao-'));
  try { await fn(criarHistoricoProducao(path.join(pasta, 'historico.json'), () => new Date('2026-10-15T15:00:00Z'))); }
  finally { await fs.rm(pasta, { recursive:true, force:true }); }
}

test('reconhece a rota real de paginação e rejeita links alheios', () => {
  assert.equal(numeroPaginaUltimas(base), 1);
  assert.equal(numeroPaginaUltimas(base + '/pagina-2'), 2);
  assert.equal(numeroPaginaUltimas('https://evil.test/noticias/ultimas/pagina-2'), 0);
  assert.equal(proximaPaginaUltimas(base, [base + '/pagina-2']), base + '/pagina-2');
  assert.equal(proximaPaginaUltimas(base + '/pagina-2', []), base + '/pagina-3');
  assert.equal(proximaPaginaUltimas('https://evil.test/noticias/ultimas', []), '');
});

test('percorre páginas, anuncia progresso e respeita o limite configurado', async () => {
  let atual = 1;
  const progresso = [], navegadas = [];
  const paginas = {
    1:{ candidatos:[{titulo:'Primeira',url:'u1'}], hrefs:[base+'/pagina-2'] },
    2:{ candidatos:[{titulo:'Segunda',url:'u2'}], hrefs:[base+'/pagina-3'] },
    3:{ candidatos:[{titulo:'Terceira',url:'u3'}], hrefs:[base+'/pagina-4'] }
  };
  const resultado = await percorrerPaginasUltimas({ limitePaginas:2,
    progresso:mensagem=>progresso.push(mensagem), abrirPrimeira:async()=>{},
    lerPagina:async()=>({url:atual===1?base:base+'/pagina-'+atual,...paginas[atual]}),
    abrirProxima:async url=>{navegadas.push(url);atual++;return true;}
  });
  assert.deepEqual(progresso, ['Procurando na página 1','Procurando na página 2']);
  assert.deepEqual(navegadas, [base+'/pagina-2']);
  assert.deepEqual(resultado.candidatos.map(item=>item.titulo), ['Primeira','Segunda']);
  assert.equal(resultado.paginasVisitadas, 2);
  assert.equal(resultado.limiteAtingido, true);
});

test('encerra quando a próxima página não existe ou repete conteúdo', async () => {
  const primeira = { url:base, candidatos:[{titulo:'Uma',url:'u1'}], hrefs:[] };
  let leituras = 0;
  const semProxima = await percorrerPaginasUltimas({ abrirPrimeira:async()=>{},
    lerPagina:async()=>{leituras++;return primeira;}, abrirProxima:async()=>false });
  assert.equal(semProxima.paginasVisitadas, 1);
  assert.equal(leituras, 1);
  let atual = 1;
  const repetida = await percorrerPaginasUltimas({ abrirPrimeira:async()=>{},
    lerPagina:async()=>({...primeira,url:atual===1?base:base+'/pagina-2'}),
    abrirProxima:async()=>{atual++;return true;} });
  assert.equal(repetida.paginasVisitadas, 1);
});

test('matéria encontrada na página 2 é associada e persistida', async () => {
  await comHistorico(async historico => {
    const item = await historico.registrar({ operacao:'adicionar', chave:'papa',
      titulo:"Papa apresenta 'boa recuperação' após cirurgia e retoma trabalho",
      situacao:'concluido', formaConclusao:'manual' });
    const chamadas = [];
    const compartilhamento = { consultarPaginas:async ({limitePaginas,progresso})=>{
      assert.equal(limitePaginas, 10);
      progresso('Procurando na página 1'); progresso('Procurando na página 2');
      chamadas.push(1,2);
      return { candidatos:[{titulo:'Outra matéria',url:link},
        {titulo:'Papa apresenta boa recuperacao apos cirurgia e retoma trabalho',url:link}],
        paginasVisitadas:2, limiteAtingido:false };
    } };
    const buscador = criarBuscadorLinks(historico, compartilhamento);
    const eventos = [];
    buscador.observar(evento=>eventos.push(evento.mensagem));
    assert.deepEqual(await buscador.procurar(item.id), {recuperadas:1,cancelado:false});
    assert.deepEqual(chamadas,[1,2]);
    assert.ok(eventos.includes('Procurando na página 2'));
    assert.equal((await historico.consultar('2026-10-15')).compartilh[0].urlOriginal, link);
  });
});

test('cancelamento impede gravação posterior e bloqueia busca duplicada', async () => {
  await comHistorico(async historico => {
    const anterior = await historico.registrar({ operacao:'adicionar', chave:'anterior',
      titulo:'Matéria anterior', urlOriginal:link, situacao:'concluido', formaConclusao:'manual' });
    const pendente = await historico.registrar({ operacao:'adicionar', chave:'pendente',
      titulo:'Nova matéria pendente', situacao:'concluido', formaConclusao:'manual' });
    let liberar, iniciou;
    const iniciada = new Promise(resolve => { iniciou = resolve; });
    const compartilhamento = { consultarPaginas:({sinal})=>new Promise(resolve=>{
      liberar=()=>resolve({ candidatos:[{titulo:'Nova matéria pendente',url:link}],
        paginasVisitadas:2, cancelado:false, limiteAtingido:false });
      sinal.addEventListener('abort',liberar,{once:true});
      iniciou();
    }) };
    const buscador = criarBuscadorLinks(historico, compartilhamento);
    const andamento = buscador.procurar(pendente.id);
    assert.throws(()=>buscador.procurar(pendente.id), /já está em andamento/);
    await iniciada;
    assert.equal(buscador.cancelar(pendente.id), true);
    assert.deepEqual(await andamento,{recuperadas:0,cancelado:true});
    const registros = (await historico.consultar('2026-10-15')).compartilh;
    assert.equal(registros.find(item=>item.id===pendente.id).urlOriginal,'');
    assert.equal(registros.find(item=>item.id===anterior.id).urlOriginal,link);
  });
});

test('títulos iguais em páginas diferentes permanecem pendentes', async () => {
  await comHistorico(async historico => {
    const item = await historico.registrar({ operacao:'adicionar', chave:'ambigua',
      titulo:'Papa apresenta boa recuperação após cirurgia e retoma trabalho',
      situacao:'concluido', formaConclusao:'manual' });
    const compartilhamento = { consultarPaginas:async () => ({ candidatos:[
      { titulo:item.titulo, url:link },
      { titulo:item.titulo, url:link.replace('1234-', '5678-') }
    ], paginasVisitadas:2, limiteAtingido:false }) };
    const resultado = await criarBuscadorLinks(historico, compartilhamento).procurar(item.id);
    assert.equal(resultado.recuperadas, 0);
    const registro = (await historico.consultar('2026-10-15')).compartilh.find(atual=>atual.id===item.id);
    assert.equal(registro.urlOriginal, '');
    assert.match(registro.motivoLinkPendente, /Mais de uma matéria/);
  });
});
