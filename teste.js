const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });

  const page = await browser.newPage();

  await page.goto('https://google.com');

  console.log('Navegador abriu corretamente.');

  await page.waitForTimeout(10000);

  await browser.close();
})();