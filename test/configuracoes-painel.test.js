const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { validarPreferencias } = require('../preferencias-autoxs');

test('engrenagem abre central, aplica tema/tamanho e restaura ao recarregar', async () => {
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  const contexto = await browser.newContext({ viewport:{ width:1100, height:760 } });
  const pagina = await contexto.newPage();
  let salvas = validarPreferencias({});
  await pagina.exposeFunction('configuracoesAutoXS', async pedido => {
    if (pedido.acao === 'obter') return { ok:true, preferencias:salvas, versao:'1.0.0' };
    if (pedido.acao === 'salvar') salvas = validarPreferencias(pedido.preferencias);
    if (pedido.acao === 'restaurar') salvas = validarPreferencias({});
    return { ok:true, preferencias:salvas };
  });
  try {
    await pagina.goto(pathToFileURL(path.join(__dirname, '..', 'painel-manual.html')).href);
    const engrenagem = pagina.getByRole('button', { name:'Configurações' });
    const posicao = await engrenagem.boundingBox();
    assert.ok(posicao.width >= 27 && posicao.width <= 29);
    assert.ok(posicao.x > 1050 && posicao.y > 710);
    await engrenagem.click();
    assert.equal(await pagina.locator('#configuracoes').evaluate(el => el.open), true);
    await pagina.screenshot({ path:path.join(__dirname, '..', 'work', 'configuracoes-painel.png') });
    await pagina.locator('#config-tema').selectOption('claro');
    await pagina.waitForFunction(() => document.documentElement.dataset.tema === 'claro');
    await pagina.evaluate(() => { document.querySelector('.coluna-producao iframe').src = 'painel-producao.html?integrado=1'; });
    await pagina.frameLocator('iframe[title="Produção AutoXS"]').locator('html').waitFor();
    await pagina.frameLocator('iframe[title="Produção AutoXS"]').locator('html[data-tema="claro"]').waitFor();
    await pagina.locator('#config-tamanho').selectOption('ampliado');
    await pagina.waitForFunction(() => document.documentElement.dataset.tamanho === 'ampliado');
    await pagina.getByRole('button', { name:'Geral', exact:true }).click();
    await pagina.locator('#config-logs').check();
    await pagina.locator('#config-confirmacoes').check();
    await pagina.waitForFunction(() => document.querySelector('#config-estado').textContent.includes('salvas'));
    await pagina.evaluate(() => window.exibirProgresso('Mensagem local de teste'));
    await pagina.getByRole('button', { name:'Diagnósticos' }).click();
    assert.match(await pagina.locator('#config-registros').textContent(), /Mensagem local de teste/);
    await pagina.locator('#fechar-configuracoes').click();
    await pagina.reload();
    await pagina.waitForFunction(() => document.documentElement.dataset.tema === 'claro');
    assert.equal(await pagina.locator('#atualizar').isVisible(), true);
    assert.equal(await pagina.locator('#compartilhar').isVisible(), true);
    assert.equal(salvas.tamanho, 'ampliado');
    assert.equal(salvas.confirmacoes, true);
    for (const largura of [1100, 760, 390]) {
      await pagina.setViewportSize({ width:largura, height:760 });
      const posicaoAtual = await engrenagem.boundingBox();
      assert.ok(posicaoAtual.x + posicaoAtual.width <= largura);
      assert.ok(posicaoAtual.y + posicaoAtual.height <= 760);
      assert.equal(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
  } finally { await contexto.close(); await browser.close(); }
});
