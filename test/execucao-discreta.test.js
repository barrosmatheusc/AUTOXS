const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { processarLote, abrirMateriaEmSegundoPlano, prepararAbaMateria } = require('../autoxs');
const { acompanharEnvioManual } = require('../acompanhar-envio');

test('abertura discreta não chama bringToFront', async () => {
  let focos = 0;
  const aba = { goto:async()=>{} };
  const contexto = { newPage:async()=>aba };
  const listagem = { bringToFront:async()=>{ focos++; } };
  assert.equal(await abrirMateriaEmSegundoPlano(contexto, listagem,
    { url:'https://cms.test/news/edit/1' }, new WeakMap(), false), aba);
  assert.equal(focos, 0);
});

test('modo discreto abre o banco de fotos e mantém a matéria para revisão', async () => {
  const materia = { titulo:'Matéria para revisão manual', url:'https://cms.test/news/edit/1' };
  let estado = { temChapeu:false, temImagem:false };
  let fechada = false, pesquisas = 0, geracoes = 0, acompanhamentos = 0, envios = 0;
  const aba = { close:async()=>{ fechada=true; }, isClosed:()=>fechada };
  const operacoes = { discreto:true, ativo:()=>true, log:async()=>{},
    abrir:async()=>aba, preparar:async()=>{}, ler:async()=>estado,
    enviar:async()=>{ envios++; return true; },
    pesquisar:async()=>{ pesquisas++; }, gerarImagem:async()=>{ geracoes++; },
    acompanhar:async()=>{ acompanhamentos++; }
  };
  const primeira = await processarLote([materia], operacoes);
  assert.equal(primeira.pendentes, 1);
  assert.equal(envios, 0);
  assert.equal(pesquisas, 1);
  assert.equal(geracoes, 0);
  assert.equal(acompanhamentos, 1);
  assert.equal(fechada, false);

  estado = { temChapeu:true, temImagem:true };
  const segunda = await processarLote([materia], operacoes);
  assert.equal(segunda.enviadas, 1);
  assert.equal(envios, 1);
  assert.equal(fechada, true);
});

test('modo discreto preserva a geração de foto para RJ em Foco', async () => {
  const materia = { titulo:'Matéria RJ', url:'https://cms.test/news/edit/2' };
  let pesquisas = 0, geracoes = 0, acompanhamentos = 0, envios = 0;
  const aba = { url:()=>materia.url, close:async()=>{}, isClosed:()=>false };
  const resumo = await processarLote([materia], {
    discreto:true, ativo:()=>true, log:async()=>{}, abrir:async()=>aba,
    preparar:async()=>{}, ler:async()=>({ temChapeu:true, temImagem:false, categoria:'RJ em Foco' }),
    enviar:async()=>{ envios++; return true; },
    pesquisar:async()=>{ pesquisas++; },
    gerarImagem:async()=>{ geracoes++; return false; },
    acompanhar:async()=>{ acompanhamentos++; }
  });
  assert.equal(resumo.pendentes, 1);
  assert.equal(geracoes, 1);
  assert.equal(pesquisas, 0);
  assert.equal(envios, 0);
  assert.equal(acompanhamentos, 1);
});

test('modo discreto preserva revisão de categoria sem abrir foto desnecessariamente', async () => {
  const materia = { titulo:'Matéria esportiva', url:'https://cms.test/news/edit/3' };
  let pesquisas = 0, envios = 0, acompanhamentos = 0;
  const resumo = await processarLote([materia], {
    discreto:true, ativo:()=>true, log:async()=>{},
    abrir:async()=>({ close:async()=>{} }), preparar:async()=>{},
    ler:async()=>({ temChapeu:true, temImagem:true, conferenciaCategoria:{ revisar:true } }),
    enviar:async()=>{ envios++; return true; },
    pesquisar:async()=>{ pesquisas++; }, acompanhar:async()=>{ acompanhamentos++; }
  });
  assert.equal(resumo.pendentes, 1);
  assert.equal(pesquisas, 0);
  assert.equal(envios, 0);
  assert.equal(acompanhamentos, 1);
});

test('preparação discreta não traz repetidamente o Chrome para primeiro plano', async () => {
  let focos = 0;
  const aba = {
    url:()=> 'https://cms.test/news/edit/4',
    bringToFront:async()=>{ focos++; },
    getByRole:()=>({ or(){ return this; }, filter(){ return this; }, waitFor:async()=>{} }),
    locator:()=>({})
  };
  const carregamentos = new Map([[aba, Promise.resolve({ erro:null })]]);
  await prepararAbaMateria(aba, carregamentos, false);
  await prepararAbaMateria(aba, carregamentos, false);
  assert.equal(focos, 0);
});

test('envio manual confirmado é acompanhado e fecha a aba sem botão de continuação', async () => {
  const aba = new EventEmitter();
  const endereco = 'https://redacao.tribunaweb.com.br/news/edit/123';
  const frame = {};
  let fechada = false, conclusoes = 0;
  aba.url = () => endereco;
  aba.mainFrame = () => frame;
  aba.isClosed = () => fechada;
  aba.locator = () => ({ allTextContents:async()=>[] });
  aba.waitForFunction = async()=>true;
  aba.close = async()=>{ fechada = true; aba.emit('close'); };
  const formulario = { count:async()=>1, evaluate:async()=>endereco };
  let confirmar;
  const concluida = new Promise(resolve => { confirmar = resolve; });
  await acompanharEnvioManual(aba, formulario, async()=>{ conclusoes++; confirmar(); });
  const requisicao = { url:()=>endereco, method:()=> 'POST', frame:()=>frame };
  aba.emit('request', requisicao);
  aba.emit('response', { request:()=>requisicao, status:()=>200 });
  await concluida;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(conclusoes, 1);
  assert.equal(fechada, true);
});
