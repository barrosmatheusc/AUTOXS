const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {lerCategoriaAtual,podeGerarImagemRJ,gerarImagemRJ,gerarImagemPorSolicitacao,imagemEmGeracao}=require('../imagem-rj');
const {processarLote}=require('../autoxs');
const {mostrarAjudaFotos}=require('../ajuda-fotos');
let browser;
before(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});});
after(async()=>{await browser?.close();});


const tituloCompleto = 'OAB-SP e entidades reivindicam transparência no STF: confira os detalhes da proposta para a reforma do Judiciário';
async function prepararLegenda(page, status = 200, padraoInicial = false) {
 await page.route('https://manual.test/images/save?ajax=1', async route => {
  assert.equal(route.request().method(), 'POST');
  const campos = new URLSearchParams(route.request().postData());
  assert.equal(campos.get('caption'), tituloCompleto);
  assert.equal(campos.get('default'), '1');
  assert.equal(campos.get('credits'), 'Imagem gerada por IA');
  await route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({success:status===200})});
 });
 await page.evaluate(({titulo, padraoInicial})=>{
  const area=document.createElement('section');
  area.innerHTML='<input name="title"><button type="button">+</button><div class="card" style="display:block;width:240px;height:100px"><img alt="Foto gerada"><button type="button" id="editar-foto">Editar</button></div><button type="button">+</button><div class="modal" id="editar-legenda" hidden><form><label for="caption">Legenda</label><textarea id="caption" name="caption"></textarea><input name="credits" value="Imagem gerada por IA"><label><input type="checkbox" name="default" value="1">Tornar legenda e créditos padrão da imagem</label><button type="submit">Salvar</button></form></div>';
  document.body.appendChild(area);
  area.querySelector('input').value=titulo;
  area.querySelector('[name=default]').checked=padraoInicial;
  area.querySelector('#editar-foto').onclick=()=>{area.querySelector('#editar-legenda').hidden=false;};
  area.querySelector('form').onsubmit=async e=>{
   e.preventDefault();
   const texto=area.querySelector('textarea').value;
   const resposta=await fetch('https://manual.test/images/save?ajax=1',{method:'POST',body:new URLSearchParams(new FormData(area.querySelector('form')))});
   if(resposta.ok){window.legendaSalva=texto;area.querySelector('#editar-legenda').hidden=true;}
  };
 },{titulo:tituloCompleto, padraoInicial});
}

test('só autoriza RJ em Foco com ausência de foto confirmada',()=>{
 assert.equal(podeGerarImagemRJ('RJ em Foco',false),true);
 for(const [categoria,imagem] of [['Política',false],['',false],['RJ em Foco',true],['RJ em Foco',null]]) assert.equal(podeGerarImagemRJ(categoria,imagem),false);
});

for (const status of [200, 500]) test(`geração copia o título completo, confere a resposta ${status} da legenda e não envia a matéria`,async()=>{
 const context=await browser.newContext();
 const page=await context.newPage();
 try{
  await page.setContent(`<select id="inp_category_id" name="category_id"><option selected>RJ em Foco</option></select>
   <a href="#" onclick="event.preventDefault();document.querySelector('#prompt').hidden=false">IMAGEM IA</a>
   <div id="prompt" hidden><select id="nanobananaFormPrompts"><option value="">Selecione</option><option value="nb-1">Geração imagem destaque de matérias (Nano Banana)</option><option value="oai-9">OpenAI</option></select>
    <button onclick="window.geracoes=(window.geracoes||0)+1;window.promptUsado=document.querySelector('#nanobananaFormPrompts').value;this.parentElement.hidden=true;document.querySelector('#resultado').hidden=false">Gerar Imagem</button></div>
   <div class="modal" id="resultado" hidden><h2>Geração de Imagem com IA</h2><button onclick="window.temImagem=true;this.parentElement.hidden=true"> Usar esta Imagem</button></div>
   <button onclick="window.enviou=true">Enviar</button>`);
  await prepararLegenda(page,status);
  assert.equal(await lerCategoriaAtual(page),'RJ em Foco');
  const foto=async aba=>({temImagem:await aba.evaluate(()=>Boolean(window.temImagem))});
  if(status===500){
   await assert.rejects(gerarImagemRJ(page,foto), /não confirmou o salvamento da legenda/);
   await assert.rejects(gerarImagemRJ(page,foto), /não confirmou o salvamento da legenda/);
   assert.equal(await page.evaluate(()=>window.geracoes),1);
   assert.equal(await page.evaluate(()=>Boolean(window.enviou)),false);
   assert.equal(await page.locator('#editar-legenda').isVisible(),true);
   return;
  }
  assert.equal(await gerarImagemRJ(page,foto),true);
  assert.equal(await page.evaluate(()=>window.legendaSalva),tituloCompleto);
  assert.equal(await gerarImagemRJ(page,foto),true);
  assert.deepEqual(await page.evaluate(()=>({total:window.geracoes,prompt:window.promptUsado,enviou:Boolean(window.enviou)})),{total:1,prompt:'nb-1',enviou:false});
 }finally{await context.close();}
});

test('a rodada deixa a matéria com imagem gerada aberta para revisão, sem envio',async()=>{
 let envios=0, geracoes=0, buscas=0;
 const resumo=await processarLote([{titulo:'Teste RJ',data:'01/01/2026'}],{
  abrir:async()=>({close:async()=>{throw new Error('Não deve fechar');}}),
  ler:async()=>({temChapeu:true,temImagem:false,categoria:'RJ em Foco'}),
  gerarImagem:async()=>{geracoes++;return true;},
  enviar:async()=>{envios++;return true;},
  pesquisar:async()=>{buscas++;},
  log:()=>{}
 });
 assert.equal(geracoes,1);assert.equal(envios,0);assert.equal(buscas,0);assert.equal(resumo.pendentes,1);
});

test('as outras categorias continuam pesquisando no acervo',async()=>{
 let geracoes=0,buscas=0;
 await processarLote([{titulo:'Teste',data:'01/01/2026'}],{
  abrir:async()=>({}),ler:async()=>({temChapeu:true,temImagem:false,categoria:'Política'}),
  gerarImagem:async()=>{geracoes++;},pesquisar:async()=>{buscas++;},log:()=>{}
 });
 assert.equal(geracoes,0);assert.equal(buscas,1);
});
test('Gerar IA fecha o acervo, usa Nano Banana fora de RJ e não envia nem duplica geração',async()=>{
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 const page=await context.newPage();
 try{
  await page.setContent(`<select id="inp_category_id" name="category_id"><option>Política</option></select>
   <button onclick="window.enviou=true">Enviar</button>
   <a href="#" onclick="event.preventDefault();document.querySelector('#prompt').hidden=false">IMAGEM IA</a>
   <dialog aria-label="Imagem de Destaque"><label for="busca">Pesquisar:</label><input id="busca" type="search" value="OAB-SP">
    <button type="button" aria-label="Close" onclick="document.querySelector('dialog').close()">×</button></dialog>
   <div id="prompt" hidden><select id="nanobananaFormPrompts"><option value="oai-9">OpenAI</option><option value="nb-1">Geração imagem destaque de matérias (Nano Banana)</option></select>
    <button onclick="window.geracoes=(window.geracoes||0)+1;window.promptUsado=document.querySelector('#nanobananaFormPrompts').value;this.parentElement.hidden=true;document.querySelector('#resultado').hidden=false">Gerar Imagem</button></div>
   <div class="modal" id="resultado" hidden><h2>Geração de Imagem com IA</h2><button id="usar" hidden onclick="window.temImagem=true;this.parentElement.hidden=true">Usar esta Imagem</button></div>
   <script>document.querySelector('dialog').showModal();</script>`);
  await prepararLegenda(page,200,true);
  const foto=async aba=>{
   assert.equal(await aba.getByRole('dialog').isVisible(),false,'Fecha o acervo antes de conferir a foto da matéria');
   return{temImagem:await aba.evaluate(()=>Boolean(window.temImagem))};
  };
  await mostrarAjudaFotos(page,page.getByRole('dialog'),'OAB-SP defende transparência no STF',{
   gerarImagem:log=>gerarImagemPorSolicitacao(page,foto,log)
  });
  await page.locator('#manual-ajuda-fotos').getByRole('button',{name:'Gerar IA',exact:true}).click();
  await page.waitForFunction(()=>window.geracoes===1);
  assert.equal(imagemEmGeracao(page),true);
  assert.equal(await page.getByRole('dialog').isVisible(),false);
  assert.equal((await page.evaluate(()=>window.__manualGerarFoto())).ok,false);
  assert.equal(await page.evaluate(()=>window.geracoes),1);
  await page.locator('#usar').evaluate(el=>{el.hidden=false;});
  await page.waitForFunction(()=>document.querySelector('#manual-aviso-geracao')?.textContent.includes('Confira a matéria antes de enviar'));
  assert.equal(await page.evaluate(()=>window.legendaSalva),tituloCompleto);
  assert.deepEqual(await page.evaluate(()=>({geracoes:window.geracoes,prompt:window.promptUsado,foto:window.temImagem,enviou:Boolean(window.enviou)})),{geracoes:1,prompt:'nb-1',foto:true,enviou:false});
  assert.equal(imagemEmGeracao(page),false);
 }finally{await context.close();}
});

test('erro no prompt mostra aviso fora do acervo sem gerar nem enviar',async()=>{
 const context=await browser.newContext();
 const page=await context.newPage();
 try{
  await page.setContent(`<input name="title" value="Teste"><a href="#" onclick="event.preventDefault();document.querySelector('#prompt').hidden=false">IMAGEM IA</a>
   <dialog aria-label="Imagem de Destaque"><label for="busca">Pesquisar:</label><input id="busca" type="search"><button onclick="document.querySelector('dialog').close()">Fechar</button></dialog>
   <div id="prompt" hidden><select id="nanobananaFormPrompts"><option value="oai-9">OpenAI</option></select><button onclick="window.gerou=true">Gerar Imagem</button></div>
   <button onclick="window.enviou=true">Enviar</button><script>document.querySelector('dialog').showModal();</script>`);
  await mostrarAjudaFotos(page,page.getByRole('dialog'),'Teste',{
   gerarImagem:log=>gerarImagemPorSolicitacao(page,async()=>({temImagem:false}),log)
  });
  await page.locator('#manual-ajuda-fotos').getByRole('button',{name:'Gerar IA',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#manual-aviso-geracao')?.textContent.includes('Não foi possível concluir'));
  assert.equal(await page.locator('#manual-aviso-geracao').isVisible(),true);
  assert.equal(await page.evaluate(()=>Boolean(window.gerou||window.enviou)),false);
  assert.equal(imagemEmGeracao(page),false);
 }finally{await context.close();}
});