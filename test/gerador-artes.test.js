const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { criarPainelManual } = require('../painel-manual');

let browser;
before(async () => { browser = await chromium.launch({ channel:'msedge', headless:true }); });
after(async () => { await browser?.close(); });

async function abrir(geradorMaterias = { listar:async()=>[], preparar:async()=>{ throw new Error('Nenhuma matéria de teste.'); } }) {
  const context = await browser.newContext({ acceptDownloads:true });
  const painel = await criarPainelManual(context, async () => {
    throw new Error('Atualização editorial não deve ser iniciada pelo gerador.');
  }, undefined, undefined, null, null, null, geradorMaterias);
  await painel.getByRole('button', { name:'Gerador de Artes' }).click();
  await painel.waitForFunction(() => !document.querySelector('#gerador-artes').disabled);
  const gerador = context.pages().find(page => page !== painel);
  assert.ok(gerador, await painel.locator('#status').textContent());
  await gerador.getByRole('heading', { name:'Gerador de Artes' }).waitFor();
  return { context, painel, gerador };
}

async function carregarFoto(gerador) {
  const base64 = await gerador.evaluate(() => {
    const teste = document.createElement('canvas');
    teste.width = 1600; teste.height = 900;
    const pincel = teste.getContext('2d');
    const degradê = pincel.createLinearGradient(0, 0, 1600, 900);
    degradê.addColorStop(0, '#e23b35'); degradê.addColorStop(1, '#1d67d4');
    pincel.fillStyle = degradê; pincel.fillRect(0, 0, 1600, 900);
    return teste.toDataURL('image/png').split(',')[1];
  });
  await gerador.locator('#foto').setInputFiles({ name:'foto-de-teste.png', mimeType:'image/png',
    buffer:Buffer.from(base64, 'base64') });
  await gerador.waitForFunction(() => !document.querySelector('#aviso').textContent.includes('Escolha uma fotografia'));
}

test('painel abre e reutiliza o Gerador de Artes sem iniciar automação editorial', async () => {
  const { context, painel, gerador } = await abrir();
  try {
    assert.match(gerador.url(), /gerador-artes\.html$/);
    assert.equal(await gerador.locator('canvas').getAttribute('width'), '1080');
    assert.equal(await gerador.locator('canvas').getAttribute('height'), '1350');
    await painel.getByRole('button', { name:'Gerador de Artes' }).click();
    assert.equal(context.pages().length, 2);
    assert.equal(await painel.getByRole('button', { name:'Atualizar', exact:true }).isEnabled(), true);
  } finally { await context.close(); }
});

test('foto, enquadramento e textos atualizam a mesma prévia sem deslocar elementos fixos', async () => {
  const { context, gerador } = await abrir();
  try {
    await carregarFoto(gerador);
    await gerador.locator('#chapeu').fill('Política');
    await gerador.locator('#titulo').fill('Hugo Wanderley e Dr. Wanderley emergem das urnas como nova força política');
    assert.equal(await gerador.locator('#exportar').isEnabled(), true);
    await gerador.locator('#arte').screenshot({ path:path.join(__dirname, '..', 'work', 'gerador-artes-previa.png') });
    const antes = await gerador.locator('#arte').evaluate(canvas => canvas.toDataURL());
    await gerador.locator('#zoom').fill('40');
    await gerador.locator('#posicao-x').fill('60');
    await gerador.locator('#posicao-y').fill('-40');
    const depois = await gerador.locator('#arte').evaluate(canvas => canvas.toDataURL());
    assert.notEqual(depois, antes);
    const fixos = await gerador.locator('#arte').evaluate(canvas => {
      const c = canvas.getContext('2d');
      const amostra = (x,y) => [...c.getImageData(x,y,1,1).data];
      return { faixa:amostra(10,200), rodape:amostra(500,1300), foto:amostra(500,200) };
    });
    assert.deepEqual(fixos.faixa.slice(0,3), [3,158,56]);
    assert.deepEqual(fixos.rodape.slice(0,3), [0,0,0]);
    assert.notDeepEqual(fixos.foto.slice(0,3), [255,116,31]);
    const caixa = await gerador.locator('#arte').boundingBox();
    await gerador.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
    await gerador.mouse.down();
    await gerador.mouse.move(caixa.x + caixa.width / 2 + 65, caixa.y + caixa.height / 2 + 35, { steps:5 });
    await gerador.mouse.up();
    assert.notEqual(await gerador.locator('#posicao-x').inputValue(), '60');
    await gerador.locator('#restaurar').click();
    assert.equal(await gerador.locator('#zoom').inputValue(), '0');
    assert.equal(await gerador.locator('#zoom-valor').innerText(), '0%');
    assert.equal(await gerador.locator('#posicao-x').inputValue(), '0');
    assert.equal(await gerador.locator('#posicao-y').inputValue(), '0');
    await gerador.locator('#foto').setInputFiles({ name:'arquivo.txt', mimeType:'text/plain', buffer:Buffer.from('inválido') });
    assert.equal(await gerador.locator('#exportar').isDisabled(), true);
    assert.match(await gerador.locator('#aviso').textContent(), /JPG, PNG ou WebP/);
  } finally { await context.close(); }
});

test('título excessivo impede exportação e PNG válido tem resolução final', async () => {
  const { context, gerador } = await abrir();
  try {
    await carregarFoto(gerador);
    await gerador.locator('#chapeu').fill('Política');
    await gerador.locator('#titulo').fill('Uma notícia importante ' .repeat(35));
    assert.equal(await gerador.locator('#exportar').isDisabled(), true);
    assert.match(await gerador.locator('#aviso').textContent(), /longo demais|ultrapassa/i);
    await gerador.locator('#titulo').fill('Notícia de teste para a arte');
    assert.equal(await gerador.locator('#exportar').isEnabled(), true);
    const download = gerador.waitForEvent('download');
    await gerador.locator('#exportar').click();
    const arquivo = await download;
    assert.match(arquivo.suggestedFilename(), /\.png$/);
    const fs = require('node:fs/promises');
    const bytes = await fs.readFile(await arquivo.path());
    assert.equal(bytes.toString('hex',0,8), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), 1080);
    assert.equal(bytes.readUInt32BE(20), 1350);
  } finally { await context.close(); }
});

test('zoom negativo reduz a foto, mostra branco, permite mover e exporta a prévia exata', async () => {
  const { context, gerador } = await abrir();
  try {
    await carregarFoto(gerador);
    await gerador.locator('#chapeu').fill('POLÍTICA');
    await gerador.locator('#titulo').fill('Título de teste para a arte');
    assert.equal(await gerador.locator('#zoom').inputValue(), '0');
    assert.equal(await gerador.locator('#zoom-valor').innerText(), '0%');
    const pixels=()=>gerador.locator('#arte').evaluate(canvas=>{
      const ctx=canvas.getContext('2d');
      const cor=(x,y)=>[...ctx.getImageData(x,y,1,1).data];
      return {alto:cor(500,10), cem:cor(500,100), trezentos:cor(500,300),
        centro:cor(500,675), faixa:cor(10,200), rodape:cor(500,1300)};
    });
    assert.notDeepEqual((await pixels()).alto,[255,255,255,255]);
    for(const [zoom,ponto] of [['-10','alto'],['-25','cem'],['-50','trezentos']]){
      await gerador.locator('#zoom').fill(zoom);
      assert.equal(await gerador.locator('#zoom-valor').innerText(),`${zoom}%`);
      const atual=await pixels();
      assert.deepEqual(atual[ponto],[255,255,255,255]);
      assert.notDeepEqual(atual.centro,[255,255,255,255]);
      assert.deepEqual(atual.faixa.slice(0,3),[3,158,56]);
      assert.deepEqual(atual.rodape.slice(0,3),[0,0,0]);
    }
    await gerador.locator('#posicao-y').fill('100');
    assert.notDeepEqual((await pixels()).alto,[255,255,255,255]);
    await gerador.locator('#posicao-y').fill('0');
    const caixa=await gerador.locator('#arte').boundingBox();
    const x=caixa.x+caixa.width/2,y=caixa.y+caixa.height/2;
    await gerador.mouse.move(x,y);
    await gerador.mouse.down();
    await gerador.mouse.move(x,y+45,{steps:5});
    await gerador.mouse.up();
    assert.notEqual(await gerador.locator('#posicao-y').inputValue(),'0');
    await gerador.locator('#zoom').fill('40');
    assert.equal(await gerador.locator('#zoom-valor').innerText(),'40%');
    assert.notDeepEqual((await pixels()).alto,[255,255,255,255]);
    await gerador.locator('#zoom').fill('-50');
    await gerador.locator('#posicao-y').fill('0');
    assert.equal(await gerador.locator('#exportar').isEnabled(),true);
    const previo=Buffer.from((await gerador.locator('#arte').evaluate(c=>c.toDataURL('image/png'))).split(',')[1],'base64');
    await gerador.evaluate(()=>{window.showSaveFilePicker=async()=>({createWritable:async()=>({
      write:async blob=>{window.__pngExportado=await new Promise((resolve,reject)=>{
        const leitor=new FileReader();leitor.onload=()=>resolve(leitor.result.split(',')[1]);
        leitor.onerror=()=>reject(leitor.error);leitor.readAsDataURL(blob);
      });},close:async()=>{}
    })});});
    await gerador.locator('#exportar').click();
    await gerador.waitForFunction(()=>Boolean(window.__pngExportado),null,{timeout:60000});
    const salvo=Buffer.from(await gerador.evaluate(()=>window.__pngExportado),'base64');
    assert.deepEqual(salvo,previo);
    assert.match(await gerador.locator('#aviso').innerText(),/PNG salvo/);
    assert.equal(await gerador.locator('#titulo').inputValue(),'Título de teste para a arte');
    assert.equal(await gerador.locator('#chapeu').inputValue(),'POLÍTICA');
  } finally { await context.close(); }
});

test('Últimas atualiza a lista e importa só a matéria selecionada para a prévia editável', async () => {
  const urlA='https://www.tribunadosertao.com.br/politica/2026/10/25/10001-noticia-a';
  const urlB='https://www.tribunadosertao.com.br/esportes/2026/10/25/10002-noticia-b';
  let consultas=0, escolhidas=[], fotoDataUrl='';
  const fonte={
    listar:async()=>{consultas++;return [
      {url:urlA,titulo:'Notícia A',chapeu:'POLÍTICA',data:'25/10/2026'},
      {url:urlB,titulo:'Notícia B',chapeu:'ESPORTES',data:'25/10/2026'}];},
    preparar:async url=>{escolhidas.push(url);return {url,titulo:url===urlB?'Notícia B':'Notícia A',
      chapeu:url===urlB?'ESPORTES':'POLÍTICA',fotoDataUrl:url===urlB?fotoDataUrl:'',
      avisoFoto:url===urlA?'Foto indisponível; escolha manualmente.':''};}
  };
  const {context,gerador}=await abrir(fonte);
  try {
    await gerador.getByRole('heading',{name:'Últimas matérias publicadas'}).waitFor();
    await gerador.getByRole('button',{name:'Gerar Arte: Notícia B'}).waitFor();
    assert.equal(await gerador.locator('.materia-recente').count(),2);
    assert.equal(consultas,1);
    await gerador.getByRole('button',{name:'Atualizar lista'}).click();
    await gerador.waitForFunction(()=>document.querySelector('#estado-ultimas')?.textContent.includes('2 matérias'));
    assert.equal(consultas,2);
    fotoDataUrl=await gerador.evaluate(()=>{
      const c=document.createElement('canvas');c.width=600;c.height=400;
      const x=c.getContext('2d');x.fillStyle='#4a77a1';x.fillRect(0,0,600,400);
      return c.toDataURL('image/png');
    });
    await gerador.getByRole('button',{name:'Gerar Arte: Notícia B'}).click();
    assert.deepEqual(escolhidas,[urlB]);
    assert.equal(await gerador.locator('#zoom').inputValue(),'0');
    assert.equal(await gerador.locator('#zoom-valor').innerText(),'0%');
    assert.equal(await gerador.locator('#titulo').inputValue(),'Notícia B');
    assert.equal(await gerador.locator('#chapeu').inputValue(),'ESPORTES');
    assert.equal(await gerador.locator('#exportar').isEnabled(),true);
    const antes=await gerador.locator('#arte').evaluate(c=>c.toDataURL());
    await gerador.locator('#titulo').fill('Título ajustado manualmente');
    assert.notEqual(await gerador.locator('#arte').evaluate(c=>c.toDataURL()),antes);
    await gerador.getByRole('button',{name:'Gerar Arte: Notícia A'}).click();
    assert.deepEqual(escolhidas,[urlB,urlA]);
    assert.equal(await gerador.locator('#titulo').inputValue(),'Notícia A');
    assert.equal(await gerador.locator('#exportar').isDisabled(),true);
    assert.match(await gerador.locator('#estado-ultimas').innerText(),/Foto indisponível/);
    await carregarFoto(gerador);
    assert.equal(await gerador.locator('#exportar').isEnabled(),true);
  } finally { await context.close(); }
});

test('erro na lista ou na matéria aparece sem importar dados de outra publicação', async () => {
  const url='https://www.tribunadosertao.com.br/politica/2026/10/25/10001-noticia-a';
  let tentativas=0;
  const fonte={listar:async()=>{
    if(++tentativas===1)throw new Error('Listagem temporariamente indisponível.');
    return [{url,titulo:'Notícia A',chapeu:'POLÍTICA'}];
  },preparar:async()=>{throw new Error('Falha de carregamento da página.');}};
  const {context,gerador}=await abrir(fonte);
  try {
    await gerador.waitForFunction(()=>document.querySelector('#estado-ultimas')?.textContent.includes('Listagem temporariamente indisponível'));
    await gerador.getByRole('button',{name:'Atualizar lista'}).click();
    await gerador.getByRole('button',{name:'Gerar Arte: Notícia A'}).click();
    assert.match(await gerador.locator('#estado-ultimas').innerText(),/Falha de carregamento/);
    assert.equal(await gerador.locator('#titulo').inputValue(),'');
    assert.equal(await gerador.locator('#exportar').isDisabled(),true);
  } finally { await context.close(); }
});
