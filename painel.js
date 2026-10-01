const { chromium } = require('playwright');

(async () => {
  const context = await chromium.launchPersistentContext('./perfil-playwright', {
    headless: false,
    viewport: null
  });

  const pages = context.pages();
  const page = pages.length ? pages[0] : await context.newPage();

  await page.goto('https://redacao.tribunaweb.com.br/');

  console.log('Abrindo o Tribuna Web com o perfil salvo.');

  await page.waitForTimeout(30000);

  await context.close();
})();