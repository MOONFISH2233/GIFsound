/**
 * 对照实验：同一个页面里，三种「会动的媒体」对 JS 的状态暴露程度。
 *
 *   <video>        —— currentTime / requestVideoFrameCallback
 *   CSS 动画        —— element.getAnimations()[0].currentTime
 *   动画图像 <img>  —— ？
 *
 * 运行：node tools/probe-controls.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPlaywright } from './load-playwright.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_BASE = process.env.FRAME_AUD_BASE || 'http://localhost:8080';

(async () => {
  const pw = await loadPlaywright();
  const out = {};

  for (const bname of ['chromium', 'firefox', 'webkit']) {
    let browser;
    try { browser = await pw[bname].launch(); } catch { continue; }
    const page = await browser.newPage({ viewport: { width: 300, height: 600 } });

    try {
      await page.goto(`${URL_BASE}/web/controls.html`);
      await page.waitForTimeout(1200);

      out[bname] = await page.evaluate(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const sample = async (fn) => {
          const vals = [];
          for (let i = 0; i < 6; i++) { vals.push(await fn()); await sleep(150); }
          return vals;
        };

        const v = document.getElementById('v');
        const cssAnim = document.getElementById('box').getAnimations()[0] || null;

        return {
          video: {
            distinct: new Set(await sample(() => v.currentTime)).size,
            hasCurrentTime: typeof v.currentTime === 'number',
            hasRVFC: typeof v.requestVideoFrameCallback === 'function',
            values: await sample(() => Math.round(v.currentTime * 1000) / 1000),
          },
          cssAnimation: {
            supported: !!cssAnim,
            distinct: cssAnim ? new Set(await sample(() => Math.round(cssAnim.currentTime))).size : 0,
            hasGetAnimations: typeof document.getAnimations === 'function',
          },
          animatedImage: {
            // 动画图像没有任何等价的属性
            hasCurrentTime: 'currentTime' in document.getElementById('p'),
            hasGetAnimations: document.getAnimations().some(a => a.effect?.target?.id === 'p'),
            note: 'CurrentSrc/animation state 无对应 API',
          },
        };
      });
    } catch (e) {
      out[bname] = { error: e.message.split('\n')[0] };
    } finally {
      await page.close();
      await browser.close();
    }
  }

  fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'results', 'controls.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log('\n写入 results/controls.json');
})();
