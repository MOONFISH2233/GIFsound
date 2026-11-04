/**
 * 跨格式 / 跨浏览器：动画图像的「当前帧」对 JavaScript 是否可观测？
 *
 * 对每种（浏览器 × 格式）测三件事：
 *   1. 屏幕上是否真的在动        → 两次元素截图哈希是否不同
 *   2. drawImage 能否读到当前帧  → 连续取样，去重后有几个值
 *   3. createImageBitmap 同上
 *
 * 测试素材每帧底部有 12 位条码，编码帧号；能读到当前帧就会得到不同的值。
 *
 * 运行：node tools/probe-observability.js
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { loadPlaywright } from './load-playwright.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 240, H = 180, BARCODE_Y = 168, BLOCK_W = 20, BITS = 12;
const URL_BASE = process.env.FRAME_AUD_BASE || 'http://localhost:8080';

const FORMATS = [
  { name: 'GIF', url: '/assets/demo.gif' },
  { name: 'APNG', url: '/assets/demo.png' },
  { name: 'WebP', url: '/assets/demo.webp' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);

// 在页面里执行：连续取样，返回读到的帧号列表
async function sampleVia(page, kind) {
  return page.evaluate(async (cfg) => {
    const { kind, W, H, BY, BW, BITS } = cfg;
    const img = document.getElementById('p');
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });

    function read() {
      const d = g.getImageData(0, BY, W, 1).data;
      let v = 0;
      for (let j = 0; j < BITS; j++) {
        const px = (j * BW + (BW >> 1)) * 4;
        if ((d[px] + d[px + 1] + d[px + 2]) / 3 > 128) v |= (1 << j);
      }
      return v - 1;
    }

    const out = [];
    for (let i = 0; i < 7; i++) {
      g.clearRect(0, 0, W, H);
      if (kind === 'drawImage') {
        g.drawImage(img, 0, 0);
      } else {
        try {
          const bmp = await createImageBitmap(img);
          g.drawImage(bmp, 0, 0);
          bmp.close();
        } catch (e) {
          return { error: String(e) };
        }
      }
      out.push(read());
      await new Promise(r => setTimeout(r, 180));
    }
    return { values: out };
  }, { kind, W, H, BY: BARCODE_Y, BW: BLOCK_W, BITS });
}

(async () => {
  const pw = await loadPlaywright();
  const rows = [];

  for (const bname of ['chromium', 'firefox', 'webkit']) {
    let browser;
    try {
      browser = await pw[bname].launch();
    } catch (e) {
      rows.push({ browser: bname, format: '-', error: 'launch failed: ' + e.message.split('\n')[0] });
      continue;
    }

    for (const fmt of FORMATS) {
      const page = await browser.newPage({ viewport: { width: 300, height: 240 }, deviceScaleFactor: 1 });
      try {
        // 必须从同源页面加载，否则 drawImage 后读像素会因跨域被污染
        await page.goto(`${URL_BASE}/web/probe.html?src=${encodeURIComponent(fmt.url)}`);
        await page.waitForFunction(() => {
          const i = document.getElementById('p');
          return i && i.complete && i.naturalWidth > 0;
        }, null, { timeout: 8000 });

        // 1) 屏幕上是否在动
        const probe = page.locator('#p');
        const a = await probe.screenshot({ type: 'png' });
        await sleep(700);
        const b = await probe.screenshot({ type: 'png' });
        const animating = hash(Buffer.from(a)) !== hash(Buffer.from(b));

        // 2)/3) 两种读取方式
        const viaDraw = await sampleVia(page, 'drawImage');
        const viaBmp = await sampleVia(page, 'createImageBitmap');

        const distinct = v => v?.values ? new Set(v.values).size : null;
        rows.push({
          browser: bname,
          format: fmt.name,
          animatingOnScreen: animating,
          drawImageDistinctFrames: distinct(viaDraw),
          drawImageValues: viaDraw?.values,
          bitmapDistinctFrames: distinct(viaBmp),
          bitmapValues: viaBmp?.values,
        });
      } catch (e) {
        rows.push({ browser: bname, format: fmt.name, error: e.message.split('\n')[0] });
      } finally {
        await page.close();
      }
    }
    await browser.close();
  }

  fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'results', 'observability.json'), JSON.stringify(rows, null, 2));

  console.log('浏览器    格式   屏幕在动    drawImage 可读帧数    createImageBitmap 可读帧数');
  for (const r of rows) {
    if (r.error) { console.log(`${r.browser.padEnd(9)} ${String(r.format).padEnd(5)}  ERROR: ${r.error}`); continue; }
    console.log(
      `${r.browser.padEnd(9)} ${r.format.padEnd(5)}  ${String(r.animatingOnScreen).padEnd(9)}  ` +
      `${String(r.drawImageDistinctFrames).padEnd(20)} ${String(r.bitmapDistinctFrames)}`
    );
  }
  console.log('\n写入 results/observability.json');
})();
