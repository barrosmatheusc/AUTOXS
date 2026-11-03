const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {criarPainelManual} = require('../painel-manual');
const {validarUrlInstagram} = require('../gerador-videos-processamento');

let browser;
before(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});});
after(async()=>{await browser?.close();});

function processador(ajustes={}) {
  const estado={abertas:0,cancelamentos:0,chamadas:0};
  return {
    estado,
    obterPastaDestino:async()=> 'C:\\Videos de teste',
    escolherPastaDestino:async()=>({pasta:'C:\\Outra pasta',cancelado:false}),
    abrirPastaVideo:async()=>{estado.abertas++;return {pasta:'C:\\Outra pasta'};},
    iniciar:async url=>{
      estado.chamadas++;
      validarUrlInstagram(url);
      if(ajustes.iniciar) return ajustes.iniciar(url);
      return {caminho:'C:\\Outra pasta\\Instagram_ABC_123.mp4',
        transcricao:'João não autorizou a publicação.',erroTranscricao:null};
    },
    tentarTranscricao:async()=>({transcricao:'Transcrição corrigida.',idioma:'pt'}),
    cancelar:()=>{estado.cancelamentos++;ajustes.cancelar?.();return true;}
  };
}

async function abrir(servico=processador()) {
  const context=await browser.newContext({acceptDownloads:true});
  const painel=await criarPainelManual(context,async()=>{
    throw new Error('A automação editorial não deve começar por Download e Transcrição.');
  },undefined,undefined,undefined,undefined,undefined,undefined,servico);
  await painel.getByRole('button',{name:'Download e Transcrição'}).click();
  await painel.waitForFunction(()=>!document.querySelector('#gerador-videos').disabled);
  const pagina=context.pages().find(item=>item!==painel);
  assert.ok(pagina,await painel.locator('#status').innerText());
  await pagina.getByRole('heading',{name:'Download e Transcrição'}).waitFor();
  return {context,painel,pagina,servico};
}

test('botão do painel abre e reutiliza a ferramenta sem iniciar o CMS',async()=>{
  const {context,painel,pagina}=await abrir();
  try {
    assert.match(pagina.url(),/gerador-videos\.html$/);
    assert.equal(await pagina.locator('#pasta-destino').innerText(),'C:\\Videos de teste');
    assert.equal(await pagina.locator('#exportar-videos').count(),0);
    assert.equal(await pagina.locator('#templates').count(),0);
    await painel.getByRole('button',{name:'Download e Transcrição'}).click();
    assert.equal(context.pages().length,2);
    assert.equal(await painel.getByRole('button',{name:'Atualizar',exact:true}).isEnabled(),true);
  } finally {await context.close();}
});

test('escolha de pasta, download, transcrição e abertura da pasta',async()=>{
  const {context,pagina,servico}=await abrir();
  try {
    await pagina.getByRole('button',{name:'Escolher pasta'}).click();
    assert.equal(await pagina.locator('#pasta-destino').innerText(),'C:\\Outra pasta');
    await pagina.locator('#url-instagram').fill('https://www.instagram.com/reel/ABC_123/');
    await pagina.locator('#baixar-transcrever').click();
    await pagina.waitForFunction(()=>document.querySelector('#arquivo-salvo').textContent.includes('Instagram_ABC_123.mp4'));
    assert.equal(await pagina.locator('#transcricao').inputValue(),'João não autorizou a publicação.');
    assert.equal(await pagina.locator('#abrir-pasta-video').isVisible(),true);
    await pagina.locator('#abrir-pasta-video').click();
    assert.equal(servico.estado.abertas,1);
    assert.equal(servico.estado.chamadas,1);
  } finally {await context.close();}
});

test('transcrição editável pode ser copiada e salva em TXT UTF-8',async()=>{
  const {context,pagina}=await abrir();
  try {
    const frase='João não autorizou a publicação. Relação, coração, êxito.';
    await pagina.locator('#transcricao').fill(frase);
    await pagina.evaluate(()=>{
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
        writeText:async texto=>{window.__textoCopiado=texto;}
      }});
    });
    await pagina.locator('#copiar-transcricao').click();
    assert.equal(await pagina.evaluate(()=>window.__textoCopiado),frase);
    const download=pagina.waitForEvent('download');
    await pagina.locator('#salvar-transcricao').click();
    const arquivo=await download;
    assert.equal(arquivo.suggestedFilename(),'transcricao-video.txt');
    assert.deepEqual(await require('node:fs/promises').readFile(await arquivo.path()),Buffer.from(frase,'utf8'));
  } finally {await context.close();}
});

test('falha da transcrição preserva vídeo e permite tentar novamente',async()=>{
  const servico=processador({iniciar:async()=>({
    caminho:'C:\\Outra pasta\\Instagram_ABC_123.mp4',transcricao:'',
    erroTranscricao:'Modelo indisponível.'
  })});
  const {context,pagina}=await abrir(servico);
  try {
    await pagina.locator('#url-instagram').fill('https://www.instagram.com/reel/ABC_123/');
    await pagina.locator('#baixar-transcrever').click();
    await pagina.locator('#repetir-transcricao').waitFor({state:'visible'});
    assert.equal(await pagina.locator('#abrir-pasta-video').isVisible(),true);
    await pagina.locator('#repetir-transcricao').click();
    assert.equal(await pagina.locator('#transcricao').inputValue(),'Transcrição corrigida.');
    assert.equal(await pagina.locator('#repetir-transcricao').isVisible(),false);
  } finally {await context.close();}
});

test('link inválido mostra erro e cancelamento interrompe processamento',async()=>{
  let interromper;
  const servico=processador({iniciar:async url=>{
    validarUrlInstagram(url);
    return new Promise((_,reject)=>{interromper=()=>reject(new Error('Processamento cancelado.'));});
  },cancelar:()=>interromper?.()});
  const {context,pagina}=await abrir(servico);
  try {
    await pagina.locator('#url-instagram').fill('https://example.com/video');
    await pagina.locator('#baixar-transcrever').click();
    await pagina.waitForFunction(()=>document.querySelector('#status-download').textContent.includes('Use um link HTTPS'));
    await pagina.locator('#url-instagram').fill('https://www.instagram.com/reel/ABC_123/');
    await pagina.locator('#baixar-transcrever').click();
    await pagina.evaluate(()=>window.atualizarProcessamentoVideos('✅ Vídeo salvo: C:\\Outra pasta\\Instagram_ABC_123.mp4'));
    await pagina.locator('#cancelar-processamento').click();
    await pagina.waitForFunction(()=>document.querySelector('#status-transcricao').textContent.includes('Processamento cancelado'));
    assert.equal(servico.estado.cancelamentos,1);
    assert.equal(await pagina.locator('#abrir-pasta-video').isVisible(),true);
  } finally {await context.close();}
});
