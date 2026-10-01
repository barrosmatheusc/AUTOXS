const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { criarEnvioAoSite, preencherCampos, formatarData } = require('../preencher-materia');
const { criarPainelManual } = require('../painel-manual');
const { textoParaHtml } = require('../texto-para-html');
let browser;
before(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});});
after(async()=>{await browser?.close();});
const origem='https://redacao.tribunaweb.com.br';
const campos={categoria:'Cidades',data:'2026-09-09T16:32:47',titulo:'Rio Largo tem possibilidade de chuva',chapeu:'RADAR CLIMA',bigode:'Mínima de 22°C e máxima de 28°C',autor:'',imagem:'',redacao:'**Rio Largo** — Primeiro parágrafo.\n\nSegundo parágrafo.\n\n| 6h9h | |\n| --- | --- |\n| 22°C | 23°C |\n\n[INMET](https://previsao.inmet.gov.br/)'};
const formulario='<form name="formSave" action="https://redacao.tribunaweb.com.br/news/save" method="post"><select id="inp_category_id" name="category_id"><option value="">Selecione...</option><option value="60">Cidades</option><option value="4">Política</option></select><input id="inp_title" name="title"><input id="inp_hat" name="hat"><input id="inp_subtitle" name="subtitle"><input id="inp_author" name="author"><textarea id="inp_text" name="text" hidden></textarea><a href="#" data-command="source.toggle" onclick="event.preventDefault();const s=document.querySelector(\'.rx-source\'),e=document.querySelector(\'.rx-editor\');if(s.hidden){s.hidden=false;e.hidden=true;s.value=e.innerHTML;}else{e.innerHTML=s.value;document.querySelector(\'#inp_text\').value=s.value;s.hidden=true;e.hidden=false;}">HTML</a><div class="rx-editor" contenteditable="true"></div><textarea class="rx-source" hidden></textarea><input id="inp_publish_date" name="publish_date" onfocus="window.focouData=true"><input name="extra" value="preservar"><button type="submit">Enviar</button></form>';
async function contextoMock(){
 const c=await browser.newContext();let salvamentos=0;const caminhos=[];
 await c.route(/^https?:/, async r=>{
  const u=new URL(r.request().url());caminhos.push(u.pathname);
  if(u.pathname==='/news/save'){salvamentos++;return r.fulfill({body:'Registro salvo'});}
  if(u.pathname==='/news/add')return r.fulfill({contentType:'text/html; charset=utf-8',body:formulario.replace('</form>', '<label><input type="checkbox" name="domains[]" value="agreste">Tribuna do Agreste</label><label><input type="checkbox" name="domains[]" value="sertao">Tribuna do Sertão</label></form>')});
  return r.fulfill({contentType:'text/html; charset=utf-8',body:'<a href="#" onclick="event.preventDefault();document.querySelector(\'#posts\').hidden=false">Notícias</a><div id="posts" hidden><a href="#" onclick="event.preventDefault();document.querySelector(\'#add\').hidden=false">Posts</a><a id="add" hidden href="'+origem+'/news/add">Adicionar</a></div>'});
 });
 return {c,salvamentos:()=>salvamentos,caminhos};
}
test('data preserva segundos, rejeita valores inválidos e HTML não executa marcação recebida',()=>{
 assert.equal(formatarData(campos.data),'09/09/2026 16:32:47');
 assert.equal(formatarData('2026-09-09T16:32'),'09/09/2026 16:32:00');
 assert.equal(formatarData(''),'');
 for(const d of ['2026-02-30T16:00','2026-09-09T24:00','2026-09-09T16:99','texto'])assert.throws(()=>formatarData(d));
 const html=textoParaHtml('<script>alert(1)</script>\n\n[clique](javascript:alert(1))\n\n**Rio**');
 assert.doesNotMatch(html,/<script|href="javascript/);assert.match(html,/<strong>Rio<\/strong>/);
 assert.match(textoParaHtml(campos.redacao),/<th>6h<\/th><th>9h<\/th>/);
});
test('preenche na mesma aba, marca os portais e salva apenas com clique manual',async()=>{
 const m=await contextoMock();
 try{
  const preencher=criarEnvioAoSite(m.c,async()=>true);
  const resultado=await preencher({id:'teste-1',campos});
  assert.equal(resultado.envioManual,true);assert.equal(m.salvamentos(),0);
  const p=m.c.pages()[0];
  assert.equal(p.url(),origem+'/news/add');assert.ok(!m.caminhos.includes('/news'));
  const recebido=await p.locator('form').evaluate(f=>Object.fromEntries(new FormData(f)));
  assert.equal(recebido.category_id,'60');assert.equal(recebido.title,campos.titulo);assert.equal(recebido.hat,campos.chapeu);assert.equal(recebido.subtitle,campos.bigode);assert.equal(recebido.author,'');assert.equal(recebido.publish_date,'09/09/2026 16:32:47');assert.equal(recebido.extra,'preservar');assert.equal(recebido.text,textoParaHtml(campos.redacao));
  assert.equal(await p.evaluate(()=>Boolean(window.focouData)),false);
  assert.equal(await p.getByLabel('Tribuna do Agreste').isChecked(),true);
  assert.equal(await p.getByLabel('Tribuna do Sertão').isChecked(),true);
  assert.equal((await preencher({id:'teste-1',campos})).reutilizada,true);assert.equal(m.c.pages().length,1);
  await p.locator('#inp_title').fill('Ajuste feito no site');
  await preencher({id:'teste-1',campos:{...campos,titulo:'Outra revisão'}});
  assert.equal(m.c.pages().length,1);assert.equal(await p.locator('#inp_title').inputValue(),'Outra revisão');
  assert.equal(m.salvamentos(),0);
  await p.getByRole('button',{name:'Enviar',exact:true}).click();
  await p.waitForURL(origem+'/news/save');
  assert.equal(m.salvamentos(),1);
  await preencher({id:'teste-2',campos:{...campos,titulo:'Nova matéria'}});
  assert.equal(m.c.pages().length,1);assert.equal(await p.locator('#inp_title').inputValue(),'Nova matéria');
  assert.equal(m.salvamentos(),1);
 }finally{await m.c.close();}
});
test('categoria sem correspondência não preenche outra por aproximação',async()=>{
 const m=await contextoMock();
 try{const p=await m.c.newPage();await p.goto(origem+'/news/add');await assert.rejects(preencherCampos(p,{...campos,categoria:'Clima e Tempo'}),/não existe/);assert.equal(await p.locator('#inp_category_id').inputValue(),'');assert.equal(await p.locator('#inp_title').inputValue(),'');}finally{await m.c.close();}
});
test('botão envia a revisão atual, impede operação concorrente e orienta o envio manual',async()=>{
 const m=await contextoMock();
 try{
  let liberar; const espera=new Promise(r=>{liberar=r;});let chamadas=0;
  const acao=criarEnvioAoSite(m.c,async()=>true);
  const painel=await criarPainelManual(m.c,async()=>{throw Error('Não deve atualizar');},async(dados,log)=>{chamadas++;await espera;return acao(dados,log);});
  await painel.getByRole('button',{name:'Adicionar matérias',exact:true}).click();
  await painel.getByLabel('Texto recebido',{exact:true}).fill('Categoria: Cidades\nTítulo: Teste da revisão\nRedação: Corpo da matéria.');
  await painel.getByRole('button',{name:'Identificar campos',exact:true}).click();
  await painel.getByRole('button',{name:'Alterar Título',exact:true}).click();
  await painel.getByRole('textbox',{name:'Título',exact:true}).fill('Título ajustado');
  await painel.getByRole('button',{name:'Enviar matéria ao site',exact:true}).click();
  await painel.getByRole('button',{name:'Preenchendo no site…',exact:true}).waitFor();
  assert.equal(await painel.locator('#nova-materia').isDisabled(),true);
  assert.equal((await painel.evaluate(()=>window.atualizarMaterias())).ok,false);
  assert.equal((await painel.evaluate(()=>window.enviarMateriaAoSite({}))).ok,false);
  liberar();
  await painel.waitForFunction(()=>document.querySelector('#recado-revisao').textContent.includes('Nada foi salvo automaticamente.'));
  assert.equal(chamadas,1);assert.equal(m.salvamentos(),0);assert.equal(m.c.pages().length,2);
  assert.equal(await m.c.pages()[1].locator('#inp_title').inputValue(),'Título ajustado');
  assert.equal(await painel.locator('#enviar-ao-site').isEnabled(),true);
 }finally{await m.c.close();}
});

test('permite todos os campos em branco sem escolher categoria nem publicar',async()=>{
 const m=await contextoMock();
 try{
  const p=await m.c.newPage();await p.goto(origem+'/news/add');
  await preencherCampos(p,campos);
  await preencherCampos(p,Object.fromEntries(Object.keys(campos).map(k=>[k,''])));
  for(const id of ['inp_category_id','inp_title','inp_hat','inp_subtitle','inp_author','inp_publish_date']) {
   assert.equal(await p.locator('#'+id).inputValue(),'');
  }
  assert.equal((await p.locator('.rx-editor').innerText()).trim(),'');
  assert.equal(await p.getByLabel('Tribuna do Agreste').isChecked(),true);
  assert.equal(await p.getByLabel('Tribuna do Sertão').isChecked(),true);
  assert.equal(m.salvamentos(),0);
 }finally{await m.c.close();}
});
