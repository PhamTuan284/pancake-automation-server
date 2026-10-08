import './features/pancake-einvoice/loadServerEnv';
import { connectPancakeBrowser, disposePancakeBrowserSession } from './features/pancake-einvoice/automation/pancakeBrowser';
import fs from 'fs';

async function closeModalIfAny(browser: any) {
  for (let i = 0; i < 5; i++) {
    const closeBtn = await browser.$('.btn-close');
    if (await closeBtn.isExisting() && await closeBtn.isDisplayed()) { try { await closeBtn.click(); } catch {} await browser.pause(400); continue; }
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

    await browser.url('https://app.easypos.vn/easy-pos/ecommerce/e-commerce-invoice?page=1&size=10');
    await browser.pause(2500);
    await closeModalIfAny(browser);
    const tab = await browser.$('*=Hóa đơn chưa phát hành');
    if (await tab.isExisting()) { await tab.click(); await browser.pause(2000); await closeModalIfAny(browser); }

    const editIcons = await browser.$$('span[data-action-key="edit"]');
    console.log('editIcons count', editIcons.length);
    if (editIcons.length) {
      await editIcons[0].click();
      await browser.pause(2000);
      await closeModalIfAny(browser);
    }
    fs.writeFileSync('./tmp-edit-modal.html', await browser.getPageSource());
    await browser.saveScreenshot('./tmp-edit-modal.png');
  } finally {
    await disposePancakeBrowserSession(session);
  }
})().catch((e) => { console.error('ERR', e); process.exit(1); });
