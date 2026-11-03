const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

test('central mostra prévia, cancela sem gravar e só importa após confirmação', async () => {
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  const chamadas = [];
  await pagina.exposeFunction('configuracoesAutoXS', async () => ({ ok:true,
    preferencias:{ tema:'automatico', tamanho:'normal', logsDetalhados:false, confirmacoes:true, pastaVideos:'' }, versao:'1.0.0' }));
  await pagina.exposeFunction('dadosAutoXS', async pedido => {
    chamadas.push(pedido.acao);
    if (pedido.acao === 'prever') return { ok:true, token:'teste', previa:{
      novos:1, atualizados:0, repetidos:1, expirados:1, invalidos:0, ambiguos:0,
      titulosNovos:['Matéria de hoje'] } };
    if (pedido.acao === 'confirmar') return { ok:true, resultado:{ novos:1, atualizados:0 } };
    return { ok:true, resultado:{ cancelado:true } };
  });
  try {
    await pagina.goto(pathToFileURL(path.join(__dirname, '..', 'painel-manual.html')).href);
    await pagina.getByRole('button', { name:'Configurações' }).click();
    await pagina.getByRole('button', { name:'Dados e Sincronização' }).click();
    assert.equal(await pagina.getByText('Google Sheets').isVisible(), true);
    async function selecionarArquivo() {
      await pagina.locator('#dados-arquivo').setInputFiles({ name:'hoje.json',
        mimeType:'application/json', buffer:Buffer.from('{"versao":1}') });
      await pagina.locator('#dados-previa').waitFor({ state:'visible' });
    }
    await selecionarArquivo();
    assert.match(await pagina.locator('#dados-resumo').textContent(), /1 novo/);
    assert.equal(chamadas.filter(acao => acao === 'confirmar').length, 0);
    await pagina.locator('#dados-cancelar').click();
    assert.equal(await pagina.locator('#dados-previa').isVisible(), false);
    assert.equal(chamadas.filter(acao => acao === 'confirmar').length, 0);
    await selecionarArquivo();
    pagina.once('dialog', dialog => dialog.dismiss());
    await pagina.locator('#dados-confirmar').click();
    assert.equal(chamadas.filter(acao => acao === 'confirmar').length, 0);
    pagina.once('dialog', dialog => dialog.accept());
    await pagina.locator('#dados-confirmar').click();
    await pagina.getByText(/Histórico anterior preservado/).waitFor();
    assert.equal(chamadas.filter(acao => acao === 'confirmar').length, 1);
  } finally { await contexto.close(); await browser.close(); }
});
