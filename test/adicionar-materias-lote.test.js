const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { instalarCaptura } = require('../captura-ponte');

const materia = numero => `INÍCIO DA MATÉRIA ${numero}\nTÍTULO: Notícia fictícia ${numero}\nCHAPÉU: GERAL\nBIGODE: Subtítulo ${numero}.\nTEXTO: Corpo fictício completo ${numero}.\nAUTOR: Ana Souza\nIMAGEM DE DESTAQUE SUGERIDA: foto-${numero}.jpg\nFIM DA MATÉRIA ${numero}`;

async function ambiente(t,nome) {
  const pasta=await fs.mkdtemp(path.join(os.tmpdir(),nome));
  t.after(()=>fs.rm(pasta,{recursive:true,force:true}));
  const navegador=await chromium.launch({channel:'msedge',headless:true});
  t.after(()=>navegador.close());
  const contexto=await navegador.newContext({viewport:{width:1400,height:900}});
  contexto.setDefaultTimeout(60000);
  await instalarCaptura(contexto,pasta);
  const pagina=await contexto.newPage();
  await pagina.goto(pathToFileURL(path.join(__dirname,'..','adicionar-painel.html')).href);
  return {pagina,contexto};
}

test('campo original distribui quatro matérias, preserva a quinta e não depende da Central',async t=>{
  const {pagina,contexto}=await ambiente(t,'autoxs-lote-ui-');
  let rede=0; await contexto.route(/^https?:/,rota=>{rede++;return rota.abort();});
  assert.equal(await pagina.getByRole('button',{name:'Central de Captura'}).count(),0);
  await pagina.getByLabel('Texto recebido',{exact:true}).fill(Array.from({length:5},(_,i)=>materia(i+1)).join('\n\n'));
  await pagina.getByRole('button',{name:'Identificar campos',exact:true}).click();
  await pagina.waitForFunction(()=>document.querySelectorAll('.editor-materia [data-ref="revisao-materia"]:not([hidden])').length===4);
  assert.deepEqual(await pagina.locator('[data-campo="titulo"] .valor').allTextContents(),
    ['Notícia fictícia 1','Notícia fictícia 2','Notícia fictícia 3','Notícia fictícia 4']);
  let estado=await pagina.evaluate(()=>window.capturaAutoXS({acao:'listar'}));
  assert.equal(estado.rascunhos.filter(item=>item.status==='encaminhado').length,4);
  assert.equal(estado.rascunhos.filter(item=>item.status==='na-fila').length,1);
  await pagina.waitForFunction(()=>/1 matéria\(s\) aguardando/.test(document.querySelector('#resumo-lote').textContent));
  assert.match(await pagina.locator('#resumo-lote').textContent(),/1 matéria\(s\) aguardando/);
  await pagina.locator('.editor-materia').first().getByRole('button',{name:'Nova matéria'}).click();
  await pagina.waitForFunction(()=>[...document.querySelectorAll('[data-campo="titulo"] .valor')].some(item=>item.textContent==='Notícia fictícia 5'));
  await pagina.waitForFunction(async()=>{
    const estado=await window.capturaAutoXS({acao:'listar'});
    return estado.rascunhos.find(item=>item.campos.titulo==='Notícia fictícia 5')?.status==='encaminhado';
  });
  estado=await pagina.evaluate(()=>window.capturaAutoXS({acao:'listar'}));
  assert.equal(estado.rascunhos.filter(item=>item.status==='liberada').length,1);
  assert.equal(estado.rascunhos.find(item=>item.campos.titulo==='Notícia fictícia 5').status,'encaminhado');
  assert.equal(rede,0);
});

test('uma matéria permanece no próprio painel e não entra na fila',async t=>{
  const {pagina}=await ambiente(t,'autoxs-individual-ui-');
  await pagina.getByLabel('Texto recebido',{exact:true}).fill(materia(1));
  await pagina.getByRole('button',{name:'Identificar campos',exact:true}).click();
  await pagina.waitForFunction(()=>document.querySelector('[data-campo="titulo"] .valor')?.textContent==='Notícia fictícia 1');
  assert.equal(await pagina.locator('.editor-materia').count(),1);
  assert.equal(await pagina.locator('[data-campo="titulo"] .valor').textContent(),'Notícia fictícia 1');
  const estado=await pagina.evaluate(()=>window.capturaAutoXS({acao:'listar'}));
  assert.equal(estado.rascunhos.length,0);
  assert.equal(await pagina.getByRole('button',{name:'Enviar matéria ao site',exact:true}).isEnabled(),true);
});

test('fila persistente não injeta matérias automaticamente ao abrir o Adicionar Matérias',async t=>{
  const {pagina}=await ambiente(t,'autoxs-lote-reinicio-');
  await pagina.getByLabel('Texto recebido',{exact:true}).fill(Array.from({length:4},(_,i)=>materia(i+1)).join('\n\n'));
  await pagina.getByRole('button',{name:'Identificar campos',exact:true}).click();
  await pagina.waitForFunction(()=>document.querySelectorAll('[data-campo="titulo"] .valor').length===4);
  await pagina.reload();
  await pagina.waitForTimeout(100);
  assert.equal(await pagina.locator('.editor-materia').count(),1);
  assert.equal(await pagina.locator('[data-ref="entrada-materia"]:not([hidden])').count(),1);
  assert.equal(await pagina.locator('[data-campo="titulo"] .valor').count(),0);
  assert.equal(await pagina.getByLabel('Texto recebido',{exact:true}).inputValue(),'');
  const estado=await pagina.evaluate(()=>window.capturaAutoXS({acao:'listar'}));
  assert.equal(estado.rascunhos.length,4,'a fila permanece preservada, mas só entra após ação explícita');
  await pagina.getByLabel('Texto recebido',{exact:true}).fill([materia(5),materia(6)].join('\n\n'));
  await pagina.getByRole('button',{name:'Identificar campos',exact:true}).click();
  await pagina.waitForFunction(()=>document.querySelectorAll('[data-campo="titulo"] .valor').length===2);
  assert.deepEqual(await pagina.locator('[data-campo="titulo"] .valor').allTextContents(),
    ['Notícia fictícia 5','Notícia fictícia 6'], 'somente o lote enviado nesta sessão pode ocupar os quadros');
});

test('novo lote ocupa somente quadros livres e não sobrescreve revisão existente',async t=>{
  const {pagina}=await ambiente(t,'autoxs-lote-ocupado-');
  await pagina.getByLabel('Texto recebido',{exact:true}).fill(materia(1));
  await pagina.getByRole('button',{name:'Identificar campos',exact:true}).click();
  await pagina.waitForFunction(()=>document.querySelector('[data-campo="titulo"] .valor')?.textContent==='Notícia fictícia 1');
  await pagina.getByRole('button',{name:'Adicionar +1'}).click();
  const segundo=pagina.locator('.editor-materia').nth(1);
  await segundo.getByLabel('Texto recebido',{exact:true}).fill([materia(2),materia(3),materia(4)].join('\n\n'));
  await segundo.getByRole('button',{name:'Identificar campos',exact:true}).click();
  await pagina.waitForFunction(()=>document.querySelectorAll('[data-campo="titulo"] .valor').length===4);
  assert.deepEqual(await pagina.locator('[data-campo="titulo"] .valor').allTextContents(),
    ['Notícia fictícia 1','Notícia fictícia 2','Notícia fictícia 3','Notícia fictícia 4']);
});
