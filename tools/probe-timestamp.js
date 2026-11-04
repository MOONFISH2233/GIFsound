import { loadPlaywright } from './load-playwright.js';

const pw = await loadPlaywright();
const browser = await pw.chromium.launch();
const context = await browser.newContext({ viewport: { width: 240, height: 180 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.setContent('<img id="p" src="http://localhost:8080/assets/demo.gif">');

const client = await context.newCDPSession(page);
await client.send('Page.enable');

const got = [];
client.on('Page.screencastFrame', async (ev) => {
  got.push({ cdp: ev.metadata.timestamp, dateNow: Date.now() / 1000, perfNow: await page.evaluate(() => performance.now()).catch(() => null) });
  try { await client.send('Page.screencastFrameAck', { sessionId: ev.sessionId }); } catch {}
});
await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
await new Promise(r => setTimeout(r, 600));
await client.send('Page.stopScreencast');
await browser.close();

console.log('样本数', got.length);
console.log('前 3 条:', JSON.stringify(got.slice(0, 3), null, 2));
if (got.length) {
  const a = got[0];
  console.log('cdp 与 Date.now/1000 的差 (秒):', (a.cdp - a.dateNow).toFixed(3));
  console.log('cdp 量级:', a.cdp > 1e12 ? '毫秒' : '秒', a.cdp);
}
