const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { instalarCaptura } = require('../captura-ponte');

test('interface antiga da Central de Captura não é mais exposta no Adicionar Matérias',async t=>{
  const html=await fs.readFile(path.join(__dirname,'..','adicionar-painel.html'),'utf8');
  assert.doesNotMatch(html,/id="abrir-captura"|id="captura-dialogo"|captura-painel\.js/);
  return;
  const pasta=await fs.mkdtemp(path.join(os.tmpdir(),'autoxs-captura-ui-'));
  t.after(()=>fs.rm(pasta,{recursive:true,force:true}));
  const navegador=await chromium.launch({channel:'msedge',headless:true});
  t.after(()=>navegador.close());
  const contexto=await navegador.newContext({viewport:{width:1100,height:800}});
  // Teste de interface longo: cinco ciclos completos de captura em navegador
  // real. Sob carga paralela, os 30 s padrao do Playwright nao bastam para um
  // clique, e o teste falhava sem haver regressao no AutoXS.
  contexto.setDefaultTimeout(60000);
  let rede=0;
  await contexto.route(/^https?:/,rota=>{rede++;return rota.abort();});
  await instalarCaptura(contexto,pasta);
  const pagina=await contexto.newPage();
  await pagina.goto(pathToFileURL(path.join(__dirname,'..','adicionar-painel.html')).href);
  await pagina.getByRole('button',{name:'Central de Captura'}).click();
  const dialogo=pagina.locator('#captura-dialogo');
  assert.equal(await dialogo.isVisible(),true);
  for(let numero=1;numero<=5;numero++) {
    await pagina.locator('#captura-texto').fill(`Título: Notícia fictícia ${numero}\nRedação: Texto fictício ${numero}.`);
    await pagina.getByRole('button',{name:'Guardar na caixa'}).click();
    await pagina.waitForFunction(()=>document.querySelector('#captura-texto').value==='');
    await pagina.waitForFunction(()=>/mensagem\(ns\) guardada/i.test(document.querySelector('#captura-estado').textContent));
    await pagina.getByRole('button',{name:'Organizar mensagens'}).click();
    const cartao=pagina.locator('.captura-cartao').filter({has:pagina.getByRole('heading',{name:`Notícia fictícia ${numero}`})});
    await cartao.getByRole('button',{name:'Aprovar rascunho'}).waitFor();
    await cartao.getByRole('button',{name:'Aprovar rascunho'}).click();
    await pagina.waitForFunction(async numero => {
      const estado=await window.capturaAutoXS({acao:'listar'});
      const item=estado.rascunhos.find(r=>r.campos.titulo===`Notícia fictícia ${numero}`);
      return numero<=4 ? item?.status==='encaminhado' : item?.status==='na-fila';
    },numero);
  }
  await pagina.evaluate(()=>window.aguardarFilaCaptura());
  // O estado persistido muda logo depois que o rascunho é entregue. Em uma
  // suíte muito concorrida, o Chromium pode concluir a atualização visual dos
  // quatro quadros no ciclo seguinte. Espere a condição real da interface em
  // vez de medir o DOM no mesmo instante da gravação.
  await pagina.waitForFunction(() => document.querySelectorAll('.editor-materia').length === 4,undefined,{timeout:10000}).catch(async erro=>{
    const diagnostico=await pagina.evaluate(async()=>({
      quadros:[...document.querySelectorAll('.editor-materia')].map(item=>item.textContent.slice(0,120)),
      rascunhos:(await window.capturaAutoXS({acao:'listar'})).rascunhos.map(item=>({titulo:item.campos.titulo,status:item.status,motivo:item.motivo}))
    }));
    assert.fail(`${erro.message}\n${JSON.stringify(diagnostico)}`);
  });
  assert.equal(await pagina.locator('.editor-materia').count(),4);
  assert.equal((await pagina.evaluate(()=>window.capturaAutoXS({acao:'listar'}))).rascunhos.filter(r=>r.status==='encaminhado').length,4);
  const estadosAntesDeReabrir=(await pagina.evaluate(()=>window.capturaAutoXS({acao:'listar'}))).rascunhos.map(r=>r.status);
  assert.equal(estadosAntesDeReabrir.filter(status=>['aprovado','na-fila'].includes(status)).length,1,JSON.stringify(estadosAntesDeReabrir));
  await pagina.reload();
  await pagina.getByRole('button',{name:'Central de Captura'}).click();
  await pagina.locator('.captura-cartao').first().waitFor();
  assert.equal(await pagina.locator('.captura-cartao').count(),5);
  await pagina.waitForFunction(()=>document.querySelector('.editor-materia')?.textContent.includes('Notícia fictícia 5'),undefined,{timeout:10000}).catch(async erro=>{
    const diagnostico=await pagina.evaluate(async()=>({
      quadro:document.querySelector('.editor-materia')?.textContent.slice(0,200),
      aviso:document.querySelector('#captura-estado')?.textContent,
      rascunhos:(await window.capturaAutoXS({acao:'listar'})).rascunhos.map(item=>({titulo:item.campos.titulo,status:item.status,motivo:item.motivo}))
    }));
    assert.fail(`${erro.message}\n${JSON.stringify(diagnostico)}`);
  });
  assert.match(await pagina.locator('.editor-materia').first().textContent(),/Notícia fictícia 5/);
  assert.equal(rede,0);
});
