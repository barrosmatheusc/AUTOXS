const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

test('Visível é o padrão em cada rodada e Discreto depende de escolha explícita', async () => {
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  const page = await browser.newPage();
  const chamadas = [];
  try {
    await page.exposeBinding('atualizarMaterias', (_, escolha) => {
      chamadas.push(escolha);
      return { ok:true, resumo:{ enviadas:0, pendentes:0, abertas:0 } };
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'painel-manual.html')).href);
    await page.locator('#atualizar').click();
    assert.equal(await page.locator('#atualizacao-discreta').isChecked(), false);
    await page.locator('[data-pagina="1"]').click();
    await page.waitForFunction(() => document.querySelector('#atualizar').disabled === false);
    assert.deepEqual(chamadas[0], { pagina:1, modo:'visivel' });
    await page.evaluate(() => {
      const materia = { titulo:'Matéria em revisão', url:'https://redacao.tribunaweb.com.br/news/edit/123' };
      window.registrarProblemaMateria({ materia, numero:1, codigo:'logo', descricao:'Agência Brasil: HTML do formulário diverge; revisão manual necessária.', situacao:'Erro técnico' });
      window.registrarProblemaMateria({ materia, numero:1, codigo:'categoria', descricao:'Revisão editorial: categoria Esportes, mas o título indica cultura.', situacao:'Revisão necessária' });
    });
    assert.equal(await page.locator('#problemas-materias').isVisible(), true);
    assert.equal(await page.locator('#contador-problemas').textContent(), '1');
    assert.match(await page.locator('#lista-problemas').innerText(), /HTML do formulário diverge/);
    assert.match(await page.locator('#lista-problemas').innerText(), /título indica cultura/);

    await page.locator('#atualizar').click();
    await page.locator('#atualizacao-discreta').check();
    await page.locator('[data-pagina="2"]').click();
    await page.waitForFunction(() => document.querySelector('#atualizar').disabled === false);
    assert.equal(await page.locator('#problemas-materias').isVisible(), false);
    assert.deepEqual(chamadas[1], { pagina:2, modo:'discreto' });

    await page.reload();
    await page.locator('#atualizar').click();
    assert.equal(await page.locator('#atualizacao-discreta').isChecked(), false);
    await page.locator('[data-pagina="1"]').click();
    await page.waitForFunction(() => document.querySelector('#atualizar').disabled === false);
    assert.deepEqual(chamadas[2], { pagina:1, modo:'visivel' });
  } finally { await browser.close(); }
});
