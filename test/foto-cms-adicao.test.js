const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const {criarPreparadorFotos,enviarESelecionar,extrairIdentidade,metadadosPlanejados,metadadosInformados,editarMetadadosLocais,listarFotosAcervo}=require('../foto-cms-adicao');

test('identidade do upload e regras editoriais de legenda/crédito são determinísticas',()=>{
  assert.deepEqual(extrairIdentidade({data:{image_id:42,url:'https://cdn.test/images/foto.jpg'}}),{id:'42',caminho:'/images/foto.jpg'});
  assert.deepEqual(metadadosPlanejados({tipoRadar:'noticias',titulo:'Título',legendaImagem:'Legenda',creditoImagem:'Crédito'}),
    {legenda:'Legenda',credito:'Crédito',preservarCredito:false,atualizarGlobal:false});
  assert.deepEqual(metadadosPlanejados({tipoRadar:'clima',titulo:'Previsão',legendaImagem:'Outra',creditoImagem:''}),
    {legenda:'Previsão',credito:null,preservarCredito:true,atualizarGlobal:false});
  assert.deepEqual(metadadosInformados({legendaImagem:'Legenda recebida',creditoImagem:''}),
    {legenda:'Legenda recebida',credito:null,preservarLegenda:false,preservarCredito:true,atualizarGlobal:false});
  assert.deepEqual(metadadosInformados({legendaImagem:'',creditoImagem:'João/Assessoria'}),
    {legenda:null,credito:'João/Assessoria',preservarLegenda:true,preservarCredito:false,atualizarGlobal:false});
});

test('metadados compartilhados permanecem bloqueados sem validação real',async()=>{
  const resultado=await editarMetadadosLocais({}, {legenda:'Título',credito:null,atualizarGlobal:false},{permitir:false});
  assert.equal(resultado.ok,false); assert.equal(resultado.etapa,'metadados-bloqueados');
});

test('legenda local preserva crédito existente e desmarca alteração global',async t=>{
  const navegador=await chromium.launch({channel:'msedge',headless:true}); t.after(()=>navegador.close());
  const pagina=await navegador.newPage();
  await pagina.route('https://manual.test/news/add',rota=>rota.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><form><input name="image_id" value="42"><div class="card"><img alt="foto"><button type="button" data-type="image">Editar</button></div></form><div id="inpModalImagemBox" hidden><input id="inpModalImagemBoxLegenda" value="Antiga"><input id="inpModalImagemBoxCreditos" value="Crédito original"><label><input id="inpModalImagemBoxUpdateGlobal" type="checkbox" checked>Global</label><button class="btn-success">Salvar</button></div><script>const m=document.querySelector('#inpModalImagemBox');document.querySelector('[data-type=image]').onclick=()=>m.hidden=false;m.querySelector('button').onclick=async()=>{await fetch('/images/save',{method:'POST'});m.hidden=true;};</script>`}));
  await pagina.route('https://manual.test/images/save',rota=>rota.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
  await pagina.goto('https://manual.test/news/add');
  const resultado=await editarMetadadosLocais(pagina,{legenda:'Título da matéria',credito:null,preservarCredito:true,atualizarGlobal:false});
  assert.equal(resultado.ok,true); assert.equal(resultado.legenda,'Título da matéria');
  assert.equal(resultado.credito,'Crédito original'); assert.equal(resultado.atualizarGlobal,false);
  assert.equal(await pagina.locator('#inpModalImagemBoxUpdateGlobal').isChecked(),false);
  assert.equal(await pagina.locator('input[name="image_id"]').inputValue(),'42');
  assert.equal(resultado.publicada,false);
});

test('seletor visual devolve ID, nome e somente miniaturas HTTP seguras',async t=>{
  const navegador=await chromium.launch({channel:'msedge',headless:true}); t.after(()=>navegador.close());
  const pagina=await navegador.newPage();
  await pagina.setContent(`<div role="dialog" aria-label="Imagem de Destaque"><div id="system_datatable_wrapper"><div class="dataTables_filter"><input></div></div><article class="dt-card-item" data-id="10"><span class="card-title-item">Maceió Clima.jpg</span><img src="https://cdn.test/images/maceio.jpg"></article><article class="dt-card-item" data-id="11"><span class="card-title-item">Inválida</span><img src="data:image/png;base64,AA=="></article></div>`);
  const resultado=await listarFotosAcervo(pagina,'');
  assert.equal(resultado.ok,true); assert.deepEqual(resultado.itens.map(item=>({id:item.id,nome:item.nome,url:item.url})),[
    {id:'10',nome:'Maceió Clima.jpg',url:'https://cdn.test/images/maceio.jpg'},
    {id:'11',nome:'Inválida',url:''}
  ]);
});

test('upload simulado usa setInputFiles, ID da resposta e confirma image_id sem publicar',async t=>{
  const pasta=await fs.mkdtemp(path.join(os.tmpdir(),'autoxs-upload-')); t.after(()=>fs.rm(pasta,{recursive:true,force:true}));
  const arquivo=path.join(pasta,'foto.png'); await fs.writeFile(arquivo,Buffer.alloc(20));
  let id='7',arquivoRecebido=null;
  const cartao={count:async()=>1,waitFor:async()=>{},locator:()=>({first(){return this;},click:async()=>{id='42';}})};
  const dialog={isVisible:async()=>true,locator:seletor=>seletor.includes('data-id="42"')?cartao:{waitFor:async()=>{}},waitFor:async()=>{}};
  const campo={count:async()=>1,setInputFiles:async valor=>{arquivoRecebido=valor;}};
  const imageId={count:async()=>1,first(){return this;},inputValue:async()=>id};
  const aba={getByRole:()=>dialog,locator:seletor=>seletor==='#datatableMultipleUploadImages'?campo:imageId,
    waitForResponse:async()=>({status:()=>200,json:async()=>({image_id:42}),request:()=>({method:()=> 'POST'}),url:()=> 'https://redacao.tribunaweb.com.br/images/save'})};
  const resultado=await enviarESelecionar(aba,arquivo);
  assert.equal(arquivoRecebido,arquivo); assert.equal(resultado.ok,true); assert.equal(resultado.imageId,'42'); assert.equal(resultado.publicada,false);
});

test('fluxo integrado envia, seleciona, configura metadados locais e nunca publica',async t=>{
  const pasta=await fs.mkdtemp(path.join(os.tmpdir(),'autoxs-foto-integrada-')); t.after(()=>fs.rm(pasta,{recursive:true,force:true}));
  const arquivo=path.join(pasta,'foto.jpg'); await fs.writeFile(arquivo,Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3,4]));
  const navegador=await chromium.launch({channel:'msedge',headless:true}); t.after(()=>navegador.close());
  const pagina=await navegador.newPage(); let uploads=0,metadados=0;
  await pagina.route('https://manual.test/news/add',rota=>rota.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><button class="mais">+</button><button class="mais">+</button><form><input name="image_id" value=""><div class="card"><img alt="destaque"><button type="button" data-type="image">Editar</button></div></form><input id="datatableMultipleUploadImages" type="file"><div role="dialog" aria-label="Imagem de Destaque" hidden><div id="system_datatable_wrapper"><div class="dataTables_filter"><input></div></div><article class="dt-card-item" data-id="42"><span class="card-title-item">foto.jpg</span><img src="https://cdn.test/images/foto.jpg"></article></div><div id="inpModalImagemBox" hidden><input id="inpModalImagemBoxLegenda" value="Antiga"><input id="inpModalImagemBoxCreditos" value="Crédito anterior"><input id="inpModalImagemBoxUpdateGlobal" type="checkbox" checked><button class="btn-success">Salvar</button></div><script>const endpoint='https://redacao.tribunaweb.com.br/images/save';const banco=document.querySelector('[role=dialog]');document.querySelector('.mais').onclick=()=>banco.hidden=false;document.querySelector('#datatableMultipleUploadImages').onchange=()=>fetch(endpoint,{method:'POST'});document.querySelector('.dt-card-item img').onclick=()=>{document.querySelector('[name=image_id]').value='42';banco.hidden=true;};const modal=document.querySelector('#inpModalImagemBox');document.querySelector('[data-type=image]').onclick=()=>modal.hidden=false;modal.querySelector('button').onclick=async()=>{await fetch(endpoint,{method:'POST'});modal.hidden=true;};</script>`}));
  await pagina.route('https://redacao.tribunaweb.com.br/images/save',async rota=>{
    if(!uploads){uploads++;await rota.fulfill({status:200,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:'{"image_id":42}'});}
    else{metadados++;await rota.fulfill({status:200,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:'{"ok":true}'});}
  });
  await pagina.goto('https://manual.test/news/add');
  const preparar=criarPreparadorFotos({ler:async()=>({buscarFotosAutomaticamente:true,pastaFotos:pasta,fotosClima:{}})});
  const resultado=await preparar(pagina,{fotoCaminho:arquivo,campos:{tipoRadar:'noticias',titulo:'Título final',legendaImagem:'Legenda final',creditoImagem:''}});
  assert.equal(resultado.estado,'foto-e-metadados-confirmados'); assert.equal(resultado.publicada,false);
  assert.equal(uploads,1); assert.equal(metadados,1);
  assert.equal(await pagina.locator('input[name="image_id"]').inputValue(),'42');
  assert.equal(await pagina.locator('#inpModalImagemBoxLegenda').inputValue(),'Legenda final');
  assert.equal(await pagina.locator('#inpModalImagemBoxCreditos').inputValue(),'Crédito anterior');
  assert.equal(await pagina.locator('#inpModalImagemBoxUpdateGlobal').isChecked(),false);
});

async function paginaSelecaoManual(navegador) {
  const pagina=await navegador.newPage();
  await pagina.route('https://manual.test/news/add',rota=>rota.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8">
    <button type="button">+</button><button type="button">+</button>
    <form><input name="image_id" value=""><div class="card"><img alt="destaque"><button type="button" data-type="image">Editar</button></div></form>
    <div role="dialog" aria-label="Imagem de Destaque" hidden>
      <article class="dt-card-item" data-id="42"><span class="card-title-item">foto.jpg</span><img alt="Foto 42"></article>
      <article class="dt-card-item" data-id="43"><span class="card-title-item">alternativa.jpg</span><img alt="Foto 43"></article>
      <button type="button" id="cancelar">Cancelar</button>
    </div>
    <div id="inpModalImagemBox" hidden><input id="inpModalImagemBoxLegenda" value="Legenda original"><input id="inpModalImagemBoxCreditos" value="Crédito original"><input id="inpModalImagemBoxUpdateGlobal" type="checkbox" checked><button class="btn-success">Salvar</button></div>
    <script>
      const banco=document.querySelector('[role=dialog]'), id=document.querySelector('[name=image_id]');
      document.querySelectorAll('button')[0].onclick=()=>banco.hidden=false;
      banco.querySelectorAll('article').forEach(item=>item.querySelector('img').onclick=()=>{id.value=item.dataset.id;banco.hidden=true;});
      document.querySelector('#cancelar').onclick=()=>banco.hidden=true;
      const modal=document.querySelector('#inpModalImagemBox');
      document.querySelector('[data-type=image]').onclick=()=>modal.hidden=false;
      modal.querySelector('button').onclick=async()=>{await fetch('/images/save',{method:'POST'});modal.hidden=true;};
    </script>`}));
  await pagina.route('https://manual.test/images/save',rota=>rota.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
  await pagina.goto('https://manual.test/news/add');
  return pagina;
}

test('seleção manual aplica somente legenda e crédito informados e não observa trocas posteriores',async t=>{
  const navegador=await chromium.launch({channel:'msedge',headless:true}); t.after(()=>navegador.close());
  const casos=[
    {legendaImagem:'Legenda nova com ação e ç',creditoImagem:'João Silva/Assessoria',legenda:'Legenda nova com ação e ç',credito:'João Silva/Assessoria'},
    {legendaImagem:'Somente legenda',creditoImagem:'',legenda:'Somente legenda',credito:'Crédito original'},
    {legendaImagem:'',creditoImagem:'Somente crédito/Agência',legenda:'Legenda original',credito:'Somente crédito/Agência'}
  ];
  for(const caso of casos) {
    const pagina=await paginaSelecaoManual(navegador);
    const preparar=criarPreparadorFotos({ler:async()=>({buscarFotosAutomaticamente:false,pastaFotos:'',fotosClima:{}})});
    const processamento=preparar(pagina,{campos:{tipoRadar:'noticias',titulo:'Título',...caso}});
    const banco=pagina.getByRole('dialog',{name:'Imagem de Destaque'});
    await banco.waitFor({state:'visible'});
    await banco.getByAltText('Foto 42').click();
    const resultado=await processamento;
    assert.equal(resultado.estado,'foto-e-metadados-confirmados');
    assert.equal(resultado.selecaoManual,true); assert.equal(resultado.publicada,false);
    assert.equal(await pagina.locator('#inpModalImagemBoxLegenda').inputValue(),caso.legenda);
    assert.equal(await pagina.locator('#inpModalImagemBoxCreditos').inputValue(),caso.credito);
    assert.equal(await pagina.locator('#inpModalImagemBoxUpdateGlobal').isChecked(),false);
    await pagina.locator('[data-type="image"]').click();
    await pagina.locator('#inpModalImagemBoxLegenda').fill('Legenda revisada manualmente');
    await pagina.locator('#inpModalImagemBoxCreditos').fill('Crédito revisado manualmente');
    await pagina.locator('#inpModalImagemBox .btn-success').click();
    await pagina.locator('#inpModalImagemBox').waitFor({state:'hidden'});
    await pagina.getByRole('button',{name:'+',exact:true}).first().click();
    await banco.getByAltText('Foto 43').click();
    assert.equal(await pagina.locator('#inpModalImagemBoxLegenda').inputValue(),'Legenda revisada manualmente');
    assert.equal(await pagina.locator('#inpModalImagemBoxCreditos').inputValue(),'Crédito revisado manualmente');
    await pagina.close();
  }
});

test('campos vazios não abrem o banco nem substituem metadados',async t=>{
  const navegador=await chromium.launch({channel:'msedge',headless:true}); t.after(()=>navegador.close());
  const pagina=await paginaSelecaoManual(navegador);
  const preparar=criarPreparadorFotos({ler:async()=>({buscarFotosAutomaticamente:false,pastaFotos:'',fotosClima:{}})});
  const resultado=await preparar(pagina,{campos:{tipoRadar:'noticias',titulo:'Título',legendaImagem:'',creditoImagem:''}});
  assert.equal(resultado.estado,'sem-foto-automatica');
  assert.equal(await pagina.getByRole('dialog',{name:'Imagem de Destaque'}).isVisible(),false);
  assert.equal(await pagina.locator('#inpModalImagemBoxLegenda').inputValue(),'Legenda original');
  assert.equal(await pagina.locator('#inpModalImagemBoxCreditos').inputValue(),'Crédito original');
});

test('cancelamento da seleção não aplica metadados nem publica',async t=>{
  const navegador=await chromium.launch({channel:'msedge',headless:true}); t.after(()=>navegador.close());
  const pagina=await paginaSelecaoManual(navegador);
  const preparar=criarPreparadorFotos({ler:async()=>({buscarFotosAutomaticamente:false,pastaFotos:'',fotosClima:{}})});
  const processamento=preparar(pagina,{campos:{tipoRadar:'noticias',titulo:'Título',legendaImagem:'Legenda nova',creditoImagem:'Crédito novo'}});
  const banco=pagina.getByRole('dialog',{name:'Imagem de Destaque'}); await banco.waitFor({state:'visible'});
  await pagina.locator('#cancelar').click();
  const resultado=await processamento;
  assert.equal(resultado.estado,'foto-pendente'); assert.equal(resultado.publicada,undefined);
  assert.equal(await pagina.locator('#inpModalImagemBoxLegenda').inputValue(),'Legenda original');
  assert.equal(await pagina.locator('#inpModalImagemBoxCreditos').inputValue(),'Crédito original');
});
