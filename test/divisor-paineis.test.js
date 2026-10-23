const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { criarPainelManual } = require('../painel-manual');

let browser;
before(async () => { browser = await chromium.launch({ channel:'msedge', headless:true }); });
after(async () => { await browser?.close(); });

const dimensoes = pagina => pagina.evaluate(() => {
  const esquerda = document.querySelector('#coluna-automacao').getBoundingClientRect();
  const direita = document.querySelector('#coluna-producao').getBoundingClientRect();
  return { esquerda:esquerda.width, direita:direita.width, x:esquerda.x,
    central:document.querySelector('.central').getBoundingClientRect().width,
    rolagem:document.documentElement.scrollWidth, viewport:innerWidth };
});

async function arrastar(pagina, destino) {
  const caixa = await pagina.locator('#divisor-paineis').boundingBox();
  const x = caixa.x + caixa.width / 2;
  const y = caixa.y + Math.min(90, caixa.height / 2);
  await pagina.mouse.move(x, y);
  await pagina.mouse.down();
  await pagina.mouse.move(destino, y, { steps:8 });
  await pagina.mouse.up();
}

test('divisor arrasta nos dois sentidos, respeita mínimos, persiste e restaura o padrão', async () => {
  const context = await browser.newContext({ viewport:{ width:1360, height:850 } });
  const pagina = await context.newPage();
  try {
    await pagina.goto(pathToFileURL(path.join(__dirname, '..', 'painel-manual.html')).href);
    const divisor = pagina.getByRole('separator', { name:'Ajustar largura dos painéis' });
    assert.equal(await divisor.getAttribute('aria-orientation'), 'vertical');
    assert.equal(await divisor.evaluate(el => getComputedStyle(el).cursor), 'col-resize');
    const inicial = await dimensoes(pagina);
    assert.ok(Math.abs(inicial.esquerda - 440) <= 1);

    await arrastar(pagina, inicial.x + 350);
    const menor = await dimensoes(pagina);
    assert.ok(menor.esquerda < inicial.esquerda && menor.direita > inicial.direita);
    await arrastar(pagina, inicial.x + 560);
    const maior = await dimensoes(pagina);
    assert.ok(maior.esquerda > menor.esquerda && maior.direita < menor.direita);

    await arrastar(pagina, inicial.x + 100);
    assert.ok(Math.abs((await dimensoes(pagina)).esquerda - 320) <= 1);
    await arrastar(pagina, inicial.x + inicial.central - 5);
    const limiteDireito = await dimensoes(pagina);
    assert.ok(limiteDireito.direita >= 480);
    assert.ok(limiteDireito.esquerda >= 320);
    assert.ok(limiteDireito.rolagem <= limiteDireito.viewport);

    await pagina.reload();
    assert.ok(Math.abs((await dimensoes(pagina)).esquerda - limiteDireito.esquerda) <= 2);
    assert.ok(await pagina.evaluate(() => Boolean(localStorage.getItem('autoxs-divisor-paineis-v1'))));
    await divisor.dblclick();
    assert.ok(Math.abs((await dimensoes(pagina)).esquerda - 440) <= 1);
    assert.equal(await pagina.evaluate(() => localStorage.getItem('autoxs-divisor-paineis-v1')), null);

    await divisor.focus();
    await pagina.keyboard.press('ArrowRight');
    assert.ok(Math.abs((await dimensoes(pagina)).esquerda - 456) <= 1);
    await pagina.keyboard.press('ArrowLeft');
    assert.ok(Math.abs((await dimensoes(pagina)).esquerda - 440) <= 1);
    await pagina.keyboard.press('Home');
    assert.ok(Math.abs((await dimensoes(pagina)).esquerda - 320) <= 1);
    await pagina.keyboard.press('End');
    assert.ok((await dimensoes(pagina)).direita >= 480);

    await pagina.setViewportSize({ width:1050, height:800 });
    await pagina.waitForFunction(() => {
      const esquerda = document.querySelector('#coluna-automacao').getBoundingClientRect();
      const direita = document.querySelector('#coluna-producao').getBoundingClientRect();
      return esquerda.width >= 319.5 && direita.width >= 479.5;
    });
    const reduzida = await dimensoes(pagina);
    assert.ok(reduzida.esquerda >= 319.5 && reduzida.direita >= 479.5);
    assert.ok(reduzida.rolagem <= reduzida.viewport);
    await pagina.setViewportSize({ width:750, height:800 });
    assert.equal(await divisor.isVisible(), false);
    const empilhada = await pagina.evaluate(() => {
      const esquerda = document.querySelector('#coluna-automacao').getBoundingClientRect();
      const direita = document.querySelector('#coluna-producao').getBoundingClientRect();
      return { abaixo:direita.top >= esquerda.bottom, rolagem:document.documentElement.scrollWidth, viewport:innerWidth };
    });
    assert.equal(empilhada.abaixo, true);
    assert.ok(empilhada.rolagem <= empilhada.viewport);
    await pagina.setViewportSize({ width:1360, height:850 });
    assert.equal(await divisor.isVisible(), true);
    await pagina.waitForFunction(esperada =>
      Math.abs(document.querySelector('#coluna-automacao').getBoundingClientRect().width - esperada) <= 2,
    limiteDireito.esquerda);
    assert.ok(Math.abs((await dimensoes(pagina)).esquerda - limiteDireito.esquerda) <= 2);
  } finally { await context.close(); }
});

test('divisor preserva botões, estatísticas e links da página inicial unificada', async () => {
  const context = await browser.newContext({ viewport:{ width:1300, height:850 } });
  let atualizacoes = 0;
  let compartilhamentos = 0;
  const titulo = 'Notícia do teste local';
  const url = 'https://www.tribunadosertao.com.br/cidades/2026/10/15/1234-noticia';
  const historico = {
    consultar:async()=>({
      estatisticas:{ concluidas:1, atualizacoesAutomaticas:0, finalizadasManualmente:1,
        adicionadas:1, aguardandoRevisao:0, erros:0 },
      compartilh:[{ id:'teste-1', titulo, concluidoEm:new Date().toISOString(), urlOriginal:url, responsavelId:null }],
      responsaveis:[]
    }),
    materiasPorResponsavel:async()=>({ dia:{total:0,grupos:[]}, periodo:{total:0,grupos:[]} }),
    relatorio:async()=>({ texto:url, semResponsavel:[], semUrl:[], duplicados:[] })
  };
  const buscador = { procurarPendentes:async()=>{}, observar:()=>()=>{}, ativas:()=>[],
    procurar:async()=>({ recuperadas:0 }), cancelar:()=>false };
  try {
    const pagina = await criarPainelManual(context, async()=>{
      atualizacoes++;
      return { abertas:0, enviadas:0, pendentes:0, erros:0 };
    }, null, undefined, historico, { abrir:async()=>{ compartilhamentos++; } }, buscador);
    const producao = pagina.frameLocator('iframe[title="Produção AutoXS"]');
    await producao.getByText('Matérias concluídas').waitFor();
    await arrastar(pagina, (await dimensoes(pagina)).x + 550);
    assert.equal(await pagina.getByRole('button', { name:'Atualizar', exact:true }).isVisible(), true);
    assert.equal(await pagina.getByRole('button', { name:'Adicionar matérias', exact:true }).isVisible(), true);
    assert.equal(await pagina.getByRole('button', { name:'Links de matérias', exact:true }).isVisible(), true);
    await pagina.getByRole('button', { name:'Atualizar', exact:true }).click();
    await pagina.getByRole('button', { name:'Página 1' }).click();
    await pagina.waitForFunction(() => document.querySelector('#etapa')?.textContent.includes('concluída'));
    assert.equal(atualizacoes, 1);
    await pagina.getByRole('button', { name:'Links de matérias', exact:true }).click();
    assert.equal(compartilhamentos, 1);
    await producao.locator('#alternar-links').click();
    await producao.getByRole('heading', { name:titulo }).waitFor();
    await producao.locator('#alternar-relatorio').click();
    assert.match(await producao.locator('#texto-relatorio').innerText(), /Nenhum relatório gerado/);
    await producao.getByRole('button', { name:'Gerar relatório' }).click();
    await producao.locator('#texto-relatorio').getByText(/tribunadosertao\.com\.br/).waitFor();
    assert.match(await producao.locator('#texto-relatorio').innerText(), /tribunadosertao\.com\.br/);
    assert.equal(context.pages().length, 1);
  } finally { await context.close(); }
});
