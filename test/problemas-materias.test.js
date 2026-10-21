const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { processarLote } = require('../autoxs');

const materia = id => ({ titulo:`Título completo da matéria ${id} e mais detalhes importantes`,
  url:`https://redacao.tribunaweb.com.br/news/edit/${id}`, fonte:'Agência Brasil', numeroExecucao:id });

function operacoes(estados, eventos, extras = {}) {
  return {
    abrir:async m => ({ id:Number(m.url.match(/\d+$/)[0]), close:async () => {} }),
    ler:async aba => estados[aba.id],
    enviar:async () => true,
    pesquisar:async () => '',
    log:async () => {},
    registrarProblema:async evento => eventos.push(evento),
    ...extras
  };
}

test('falhas técnicas/editoriais agrupam por matéria e falta isolada de foto não entra', async () => {
  const eventos = [];
  const estados = {
    1:{ temChapeu:true, temImagem:false },
    2:{ temChapeu:false, temImagem:false, conferenciaCategoria:{ revisar:true, mensagem:'Categoria divergente.' } },
    3:{ temChapeu:true, temImagem:true }
  };
  await processarLote([materia(1), materia(2), materia(3)], operacoes(estados, eventos, {
    enviar:async () => false,
    motivoPendencia:() => 'HTML do formulário divergente do editor.'
  }));
  assert.equal(eventos.some(evento => evento.materia.url === materia(1).url), false);
  assert.deepEqual(eventos.filter(evento => evento.materia.url === materia(2).url && evento.situacao !== 'Corrigido').map(evento => evento.codigo), ['chapeu', 'categoria']);
  assert.equal(eventos.find(evento => evento.materia.url === materia(3).url && evento.codigo === 'envio').descricao, 'HTML do formulário divergente do editor.');
});

test('falha da Agência Brasil é registrada e não marcada como corrigida sem validação', async () => {
  const eventos = [];
  const estado = { 4:{ temChapeu:true, temImagem:true } };
  await processarLote([materia(4)], operacoes(estado, eventos, {
    limparLogo:async () => ({ ok:false, aviso:'editor visual divergente' })
  }));
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].codigo, 'agencia-brasil');
  assert.equal(eventos[0].situacao, 'Revisão necessária');
  assert.equal(eventos.some(evento => evento.situacao === 'Corrigido'), false);
});

test('problema de chapéu validado depois da geração de foto é marcado como corrigido', async () => {
  const eventos = [];
  let leituras = 0;
  await processarLote([materia(4)], operacoes({}, eventos, {
    ler:async () => ++leituras === 1
      ? { temChapeu:false, temImagem:false, categoria:'RJ em Foco' }
      : { temChapeu:true, temImagem:true, categoria:'RJ em Foco' },
    gerarImagem:async () => true
  }));
  assert.equal(eventos.find(evento => evento.codigo === 'chapeu')?.situacao, 'Revisão necessária');
  assert.equal(eventos.at(-1).situacao, 'Corrigido');
});

test('erro de abertura e falha de envio não são perdidos', async () => {
  const eventos = [];
  const estado = { 6:{ temChapeu:true, temImagem:true } };
  await processarLote([materia(5), materia(6)], operacoes(estado, eventos, {
    abrir:async m => { if (m.url.endsWith('/5')) throw new Error('navegação falhou'); return { close:async () => {} }; },
    ler:async () => estado[6],
    enviar:async () => false
  }));
  assert.deepEqual(eventos.filter(evento => evento.situacao !== 'Corrigido').map(evento => evento.codigo), ['abrir', 'envio']);
  assert.equal(eventos[0].situacao, 'Erro técnico');
});

let browser;
before(async () => { browser = await chromium.launch({ channel:'msedge', headless:true }); });
after(async () => { await browser?.close(); });

test('painel agrupa, deduplica, preserva no fim e mostra link de edição seguro', async () => {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'painel-manual.html')).href);
  const m = materia(7);
  await page.evaluate(materia => {
    window.registrarProblemaMateria({ materia, numero:7, codigo:'html', descricao:'Editor visual divergente.', situacao:'Erro técnico' });
    window.registrarProblemaMateria({ materia, numero:7, codigo:'html', descricao:'Editor visual divergente.', situacao:'Erro técnico' });
    window.registrarProblemaMateria({ materia, numero:7, codigo:'categoria', descricao:'Categoria não confirmada.', situacao:'Revisão necessária' });
  }, m);
  assert.equal(await page.locator('#contador-problemas').textContent(), '1');
  assert.equal(await page.locator('.problema-cartao').count(), 1);
  assert.equal(await page.locator('.problema-cartao li').count(), 2);
  assert.match(await page.locator('.problema-titulo').textContent(), /Matéria 7.*Título completo/);
  assert.equal(await page.locator('.problema-situacao').textContent(), 'Erro técnico');
  assert.equal(await page.locator('.problema-detalhes a').getAttribute('href'), m.url);
  await page.evaluate(materia => window.registrarProblemaMateria({ materia, codigo:'html', situacao:'Corrigido' }), m);
  assert.equal(await page.locator('.problema-situacao').textContent(), 'Revisão necessária');
  await page.evaluate(materia => window.registrarProblemaMateria({ materia, situacao:'Corrigido' }), m);
  assert.equal(await page.locator('.problema-situacao').textContent(), 'Corrigido');
  await page.close();
});

test('painel acomoda várias matérias, expande e não gera rolagem horizontal em tela estreita', async () => {
  const page = await browser.newPage({ viewport:{ width:360, height:740 } });
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'painel-manual.html')).href);
  await page.evaluate(({ a, b }) => {
    window.registrarProblemaMateria({ materia:a, numero:8, codigo:'chapeu', descricao:'Chapéu não confirmado.', situacao:'Revisão necessária' });
    window.registrarProblemaMateria({ materia:b, numero:9, codigo:'html', descricao:'Divergência detalhada '.repeat(30), situacao:'Erro técnico' });
  }, { a:materia(8), b:materia(9) });
  assert.equal(await page.locator('#contador-problemas').textContent(), '2');
  await page.locator('.problema-cartao').first().locator('summary').click();
  assert.equal(await page.locator('.problema-cartao').first().evaluate(elemento => elemento.open), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.close();
});
