const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

test('painéis adicionais aparecem sob demanda e se reorganizam sem rolagem horizontal', async () => {
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  try {
    const page = await browser.newPage({ viewport:{ width:1920, height:900 } });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'adicionar-painel.html')).href);
    const grade = page.locator('#grade-materias');
    assert.equal(await grade.getAttribute('data-quantidade'), '1');
    assert.equal(await grade.locator('.editor-materia').count(), 1);
    for (let quantidade = 2; quantidade <= 4; quantidade++) {
      await page.getByRole('button', { name:'Adicionar +1' }).click();
      assert.equal(await grade.getAttribute('data-quantidade'), String(quantidade));
    }
    let caixas = await grade.locator('.editor-materia').evaluateAll(itens => itens.map(item => {
      const area = item.getBoundingClientRect(); return { x:area.x, y:area.y, largura:area.width };
    }));
    assert.equal(caixas.length, 4);
    assert.equal(new Set(caixas.map(item => Math.round(item.y))).size, 2);
    assert.ok(caixas.every(item => item.largura >= 300));
    await grade.locator('.editor-materia').first().locator('[data-ref="texto-bruto"]').fill('Primeira matéria');
    await page.setViewportSize({ width:800, height:700 });
    assert.equal(await grade.evaluate(el => el.scrollWidth > el.clientWidth), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await grade.locator('.editor-materia').first().locator('[data-ref="texto-bruto"]').inputValue(), 'Primeira matéria');
    assert.equal(await grade.locator('.editor-materia').count(), 4);
    await page.setViewportSize({ width:500, height:700 });
    assert.equal(await grade.evaluate(el => el.scrollWidth > el.clientWidth), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await grade.locator('.editor-materia').last().getByRole('button', { name:/Liberar e ocultar painel/ }).click();
    assert.equal(await grade.locator('.editor-materia').count(), 3);
  } finally { await browser.close(); }
});
