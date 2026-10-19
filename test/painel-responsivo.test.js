const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { criarPainelManual } = require('../painel-manual');

test('painel unificado ocupa a janela e mantém matérias, links e ações legíveis', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 900 } });
  const titulo = 'Uma matéria publicada por Enviar Matérias com título extenso para verificar se todas as palavras continuam legíveis ao reduzir a janela do AutoXS';
  const url = 'https://www.tribunadosertao.com.br/noticias/2026/10/19/123456-uma-materia-publicada-com-url-muito-longa-para-conferir-quebra-de-linha-e-acesso-aos-botoes';
  let responsavelId = 'inicial-1';
  const historico = {
    consultar: async () => ({
      estatisticas: { concluidas: 1, atualizacoesAutomaticas: 0, finalizadasManualmente: 0, adicionadas: 1, aguardandoRevisao: 0, erros: 0 },
      compartilh: [{ id: 'materia-1', titulo, concluidoEm: '2026-10-19T15:00:00.000Z', urlOriginal: url, responsavelId }],
      responsaveis: [{ id: 'inicial-1', nome: 'Vladimir', ativo: true }, { id: 'inicial-2', nome: 'Cinara', ativo: true }]
    }),
    materiasPorResponsavel: async () => ({
      dia: { total: responsavelId ? 1 : 0, grupos: responsavelId ? [{ nome: 'Vladimir', quantidade: 1 }] : [] },
      periodo: { total: responsavelId ? 1 : 0, grupos: responsavelId ? [{ nome: 'Vladimir', quantidade: 1 }] : [] }
    }),
    relatorio: async () => ({ texto: '', semResponsavel: [], semUrl: [], duplicados: [] }),
    responsavel: async (_id, novoId) => { responsavelId = novoId; return {}; }
  };
  try {
    const page = await criarPainelManual(context, async () => { throw new Error('Automação editorial não deve iniciar'); }, null, undefined, historico);
    const frame = page.frameLocator('iframe[title="Produção AutoXS"]');
    await frame.locator('#alternar-links').click();
    await frame.getByRole('button', { name: `Expandir ${titulo}` }).click();
    assert.equal(await frame.locator('.materia-titulo').textContent(), titulo);
    assert.equal(await frame.locator('.url a').textContent(), url);

    for (const width of [1920, 1300, 900, 600, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const outer = await page.evaluate(() => ({
        viewport: innerWidth,
        scroll: document.documentElement.scrollWidth,
        central: document.querySelector('.central').getBoundingClientRect().width,
        margins: innerWidth - document.querySelector('.central').getBoundingClientRect().width
      }));
      const inner = await frame.locator('body').evaluate(body => ({
        viewport: innerWidth,
        scroll: document.documentElement.scrollWidth,
        card: body.querySelector('.materia').getBoundingClientRect().width,
        title: getComputedStyle(body.querySelector('.materia-titulo')).whiteSpace
      }));
      assert.ok(outer.scroll <= outer.viewport, `rolagem horizontal na janela de ${width}px`);
      assert.ok(inner.scroll <= inner.viewport, `rolagem horizontal na produção de ${width}px`);
      assert.ok(outer.margins <= 40, `espaço lateral excessivo na janela de ${width}px`);
      assert.ok(inner.card < inner.viewport, `cartão cortado na janela de ${width}px`);
      assert.equal(inner.title, 'normal');
      assert.equal(await frame.getByRole('button', { name: 'Copiar compartilhável' }).isVisible(), true);
      assert.equal(await frame.getByRole('button', { name: 'Desfazer seleção' }).isVisible(), true);
    }

    await page.setViewportSize({ width: 900, height: 900 });
    for (const zoom of ['125%', '150%']) {
      await page.evaluate(value => { document.documentElement.style.zoom = value; }, zoom);
      const widths = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(widths.scroll <= widths.viewport, `rolagem horizontal com escala de ${zoom}`);
      assert.equal(await frame.getByRole('button', { name: 'Copiar compartilhável' }).isVisible(), true);
    }
    await page.evaluate(() => { document.documentElement.style.zoom = ''; });

    await frame.getByRole('button', { name: `Recolher ${titulo}` }).click();
    assert.equal(await frame.locator('.materia-detalhes').isHidden(), true);
    assert.equal(await frame.locator('.materia-titulo').textContent(), titulo);
    await frame.getByRole('button', { name: `Expandir ${titulo}` }).click();
    await frame.getByRole('button', { name: 'Desfazer seleção' }).click();
    assert.equal(responsavelId, null);
    assert.equal(await frame.getByRole('group', { name: `Responsável por ${titulo}` }).getByRole('button', { name: 'Cinara' }).isVisible(), true);
  } finally {
    await context.close();
    await browser.close();
  }
});
