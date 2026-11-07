const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { instalarCaptura } = require('../captura-ponte');

test('Central local persiste, revisa, entrega a quatro quadros e mantém excedente na fila',async t=>{
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
    await pagina.getByRole('button',{name:'Organizar mensagens'}).click();
    const cartao=pagina.locator('.captura-cartao').filter({has:pagina.getByRole('heading',{name:`Notícia fictícia ${numero}`})});
    await cartao.getByRole('button',{name:'Aprovar rascunho'}).click();
    await cartao.getByRole('button',{name:'Encaminhar para quadro livre'}).waitFor();
    await cartao.getByRole('button',{name:'Encaminhar para quadro livre'}).click();
    await pagina.waitForFunction(numero => numero<=4
      ? document.querySelector('#captura-estado').textContent.includes(`quadro ${numero}`)
      : /quatro quadros estão ocupados/i.test(document.querySelector('#captura-estado').textContent),numero);
  }
  assert.equal(await pagina.locator('.editor-materia').count(),4);
  assert.equal((await pagina.evaluate(()=>window.capturaAutoXS({acao:'listar'}))).rascunhos.filter(r=>r.status==='encaminhado').length,4);
  assert.equal((await pagina.evaluate(()=>window.capturaAutoXS({acao:'listar'}))).rascunhos.filter(r=>r.status==='aprovado').length,1);
  await pagina.reload();
  await pagina.getByRole('button',{name:'Central de Captura'}).click();
  await pagina.locator('.captura-cartao').first().waitFor();
  assert.equal(await pagina.locator('.captura-cartao').count(),5);
  await pagina.getByRole('button',{name:'Reabrir em quadro livre'}).first().click();
  await pagina.waitForFunction(()=>document.querySelector('#captura-estado').textContent.includes('quadro 1'));
  assert.match(await pagina.locator('.editor-materia').first().textContent(),/Notícia fictícia 1/);
  assert.equal(rede,0);
});
