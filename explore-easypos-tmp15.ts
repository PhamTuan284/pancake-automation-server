import './features/pancake-einvoice/loadServerEnv';
import { connectPancakeBrowser, disposePancakeBrowserSession } from './features/pancake-einvoice/automation/pancakeBrowser';
import fs from 'fs';

async function closeModalIfAny(browser: any) {
  for (let i = 0; i < 5; i++) {
    const closeBtn = await browser.$('.btn-close');
    if (await closeBtn.isExisting() && await closeBtn.isDisplayed()) { try { await closeBtn.click(); } catch {} await browser.pause(400); continue; }
    const nextBtn = await browser.$('*=Tiếp theo');
    if (await nextBtn.isExisting() && await nextBtn.isDisplayed()) {
      // dismiss tour by clicking the X if present, else click backdrop isn't ideal; try pressing Escape
      await browser.keys('Escape');
      await browser.pause(300);
      continue;
    }
    break;
  }
}

(async () => {
  const session = await connectPancakeBrowser();
  const { browser } = session;
  try {
    await browser.url(process.env.EASYPOS_LOGIN_URL!);
    await browser.pause(1500);
    const user = await browser.$('input[name="username"]');
    await user.waitForDisplayed({ timeout: 10000 });
    await user.setValue(process.env.EASYPOS_USERNAME!);
    const pwd = await browser.$('input[name="password"]');
    await pwd.setValue(process.env.EASYPOS_PASSWORD!);
    const submit = await browser.$('button[type="submit"]');
    await submit.click();
    await browser.pause(4000);
    await closeModalIfAny(browser);

    const sanTmdt = await browser.$('*=Sàn TMĐT');
    await sanTmdt.click();
    await browser.pause(1000);
    await closeModalIfAny(browser);

    const hddt = await browser.$('*=Hóa đơn điện tử');
    await hddt.click();
    await browser.pause(2500);
    await closeModalIfAny(browser);
    console.log('URL:', await browser.getUrl());
    fs.writeFileSync('./tmp-hddt.html', await browser.getPageSource());
    await browser.saveScreenshot('./tmp-hddt.png');

    const tab = await browser.$('*=Hóa đơn chưa phát hành');
    if (await tab.isExisting()) {
      await tab.click();
      await browser.pause(2500);
      await closeModalIfAny(browser);
    }
    console.log('URL2:', await browser.getUrl());
    fs.writeFileSync('./tmp-hddt-chuaphathanh.html', await browser.getPageSource());
    await browser.saveScreenshot('./tmp-hddt-chuaphathanh.png');
  } finally {
    await disposePancakeBrowserSession(session);
  }
})().catch((e) => { console.error('ERR', e); process.exit(1); });
