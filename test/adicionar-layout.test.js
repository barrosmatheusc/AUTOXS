const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

test('quadros de Adicionar matérias ficam em uma fileira e rolam horizontalmente em janela estreita', async () => {
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  try {
    const page = await browser.newPage({ viewport:{ width:1920, height:900 } });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'adicionar-painel.html')).href);
    const grade = page.locator('#grade-materias');
    assert.equal(await grade.getAttribute('data-quantidade'), '1');
    for (let quantidade = 2; quantidade <= 4; quantidade++) {
      await page.getByRole('button', { name:'Adicionar +1' }).click();
      assert.equal(await grade.getAttribute('data-quantidade'), String(quantidade));
      const caixas = await grade.locator('.editor-materia').evaluateAll(itens => itens.map(item => {
        const area = item.getBoundingClientRect(); return { x:area.x, y:area.y, largura:area.width };
      }));
      assert.equal(caixas.length, quantidade);
      assert.ok(caixas.every(item => Math.abs(item.y - caixas[0].y) < 1));
      assert.ok(caixas.every(item => item.largura >= 320));
      assert.ok(caixas.every((item, indice) => indice === 0 || item.x > caixas[indice - 1].x));
    }
    await grade.locator('.editor-materia').first().locator('[data-ref="texto-bruto"]').fill('Primeira matéria');
    await page.setViewportSize({ width:800, height:700 });
    assert.equal(await grade.evaluate(el => el.scrollWidth > el.clientWidth), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await grade.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    assert.equal(await grade.locator('.editor-materia').first().locator('[data-ref="texto-bruto"]').inputValue(), 'Primeira matéria');
    assert.equal(await grade.locator('.editor-materia').count(), 4);
    await page.setViewportSize({ width:500, height:700 });
    assert.equal(await grade.evaluate(el => el.scrollWidth > el.clientWidth), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  } finally { await browser.close(); }
});
