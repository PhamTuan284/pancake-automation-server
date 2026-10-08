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

    // click the pencil/edit icon in the first row's "Thao tác" column
    const editClicked = await browser.execute(() => {
      const rows = document.querySelectorAll('table tbody tr, .table tbody tr');
      if (!rows.length) return 'no-rows';
      const firstRow = rows[0];
      const svgs = firstRow.querySelectorAll('svg, button, a');
      for (let i = 0; i < svgs.length; i++) {
        const el = svgs[i] as HTMLElement;
        // pencil icon is usually 2nd action icon; try clicking elements with title/aria containing edit, else click by position
      }
      return { rowHtml: firstRow.outerHTML.slice(0, 2000) };
    });
    console.log('editRowInfo', JSON.stringify(editClicked).slice(0, 2500));

    fs.writeFileSync('./tmp-row-debug.html', await browser.getPageSource());
  } finally {
    await disposePancakeBrowserSession(session);
  }
})().catch((e) => { console.error('ERR', e); process.exit(1); });
