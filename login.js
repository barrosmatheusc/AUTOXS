const { chromium } = require('playwright');

(async () => {
  const context = await chromium.launchPersistentContext('./perfil-playwright', {
    headless: false,
    viewport: null
  });

  const pages = context.pages();
  const page = pages.length ? pages[0] : await context.newPage();

  await page.goto('https://redacao.tribunaweb.com.br/login');

  console.log('Faça login normalmente no Tribuna Web.');

  // deixa tempo suficiente para você entrar e chegar ao painel
  await page.waitForTimeout(120000);

  await context.close();
})();