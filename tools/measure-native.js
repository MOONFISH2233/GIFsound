/**
 * 实验 A：测量「浏览器原生 GIF 播放器」的真实帧时序。
 *
 * 背景：浏览器没有暴露「当前显示第几帧」的 API。
 * 本仓库已实测确认 drawImage / createImageBitmap 都只返回首帧，
 * 因此唯一可靠的真值是**合成器输出**。
 * Chromium 走 CDP Page.startScreencast（epoch 时间戳）。
 *
 * 采样精度：若页面只有 GIF 在变，合成器只在 GIF 换帧时出图（~10fps）。
 * 因此额外放一个 60fps 的小方块强制合成器持续出帧，把采样率拉到刷新率。
 *
 * 两个基线：
 *   B1-oracle      用「最优相位」拟合——现实中页面拿不到，只作理论上限
 *   B1-realistic   用 img.onload 当时钟锚点——页面真正能拿到的东西
 *
 * 扰动模式 --hide：中途把图片 display:none 两秒再恢复，
 * 检验原生播放器会不会"掉队"，而音频时钟不会。
 *
 * 运行：node tools/measure-native.js [chromium|firefox|webkit] [毫秒] [hide]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { loadPlaywright } from './load-playwright.js';
import { decodePng, luminance } from './png-decode.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 240, H = 180, BARCODE_Y = 168, BLOCK_W = 20, BITS = 12;
const VW = 240, VH = 220; // 视口比图片高 40px，留给 60fps ticker
const PATTERN = [80, 100, 120, 60, 140, 100, 90, 110];
const FRAME_COUNT = 40;
const DELAYS = Array.from({ length: FRAME_COUNT }, (_, i) => PATTERN[i % PATTERN.length]);
const NOMINAL_CYCLE = DELAYS.reduce((a, b) => a + b, 0); // 4000ms

const browserName = process.argv[2] || 'chromium';
const DURATION = Number(process.argv[3] || 20000);
const HIDE = process.argv[4] === 'hide';
const HIDE_MS = 2000;
const URL_BASE = process.env.FRAME_AUD_BASE || 'http://localhost:8080';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function readBarcode(png) {
  // 1:1 截取，坐标直接对应 CSS 像素
  const sx = png.width / VW;
  const sy = png.height / VH;
  let v = 0;
  for (let j = 0; j < BITS; j++) {
    const x = Math.round((j * BLOCK_W + BLOCK_W / 2) * sx);
    const y = Math.round(BARCODE_Y * sy);
    if (luminance(png, x, y) > 128) v |= (1 << j);
  }
  return v - 1;
}

function frameStartsOf(delays) {
  const s = [0];
  for (let i = 1; i < delays.length; i++) s.push(s[i - 1] + delays[i - 1]);
  return s;
}

const FS0 = frameStartsOf(DELAYS);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pct = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const r2 = n => (n === null || n === undefined || Number.isNaN(n)) ? null : Math.round(n * 100) / 100;

function frameAtTicks(x) {
  let k = 0;
  for (let i = 0; i < FS0.length; i++) if (FS0[i] <= x) k = i;
  return k;
}
function wrappedDiffMs(a, b) {
  let d = FS0[a] - FS0[b];
  if (d > NOMINAL_CYCLE / 2) d -= NOMINAL_CYCLE;
  if (d < -NOMINAL_CYCLE / 2) d += NOMINAL_CYCLE;
  return d;
}
const wrapCycle = x => ((x % NOMINAL_CYCLE) + NOMINAL_CYCLE) % NOMINAL_CYCLE;

function scoreAgainst(samples, anchorMs) {
  return samples.map(s => {
    const est = frameAtTicks(wrapCycle(s.epochMs - anchorMs));
    return { est, actual: s.frame, errMs: Math.abs(wrappedDiffMs(est, s.frame)), mismatch: est !== s.frame };
  });
}

function summarizeErrors(errs) {
  const abs = errs.map(e => e.errMs);
  return {
    samples: errs.length,
    mismatchRate: errs.length ? errs.filter(e => e.mismatch).length / errs.length : null,
    meanAbsErrMs: mean(abs),
    p95AbsErrMs: pct(abs, 0.95),
    maxAbsErrMs: Math.max(0, ...abs),
  };
}

/* ------------------------- 采集：CDP screencast ------------------------- */

async function collectChromium(page, context, durationMs) {
  const client = await context.newCDPSession(page);
  await client.send('Page.enable');

  const raw = [];
  client.on('Page.screencastFrame', async (ev) => {
    raw.push({ epochMs: ev.metadata.timestamp * 1000, data: ev.data });
    try { await client.send('Page.screencastFrameAck', { sessionId: ev.sessionId }); } catch {}
  });

  await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: VW, maxHeight: VH });

  let hiddenAt = null, shownAt = null;
  if (HIDE) {
    await sleep(durationMs * 0.4);
    hiddenAt = Date.now();
    await page.evaluate(() => { document.getElementById('wrap').style.display = 'none'; });
    await sleep(HIDE_MS);
    await page.evaluate(() => { document.getElementById('wrap').style.display = ''; });
    shownAt = Date.now();
    await sleep(durationMs * 0.4);
  } else {
    await sleep(durationMs);
  }

  await client.send('Page.stopScreencast');
  await client.detach();

  return {
    samples: raw.map(f => ({ epochMs: f.epochMs, frame: readBarcode(decodePng(Buffer.from(f.data, 'base64'))) })),
    hiddenAt, shownAt,
  };
}

async function collectScreenshot(page, durationMs) {
  const probe = page.locator('#probe');
  const out = [];
  const t0 = performance.now();
  while (performance.now() - t0 < durationMs) {
    const shot = await probe.screenshot({ type: 'png' });
    out.push({ epochMs: Date.now(), frame: readBarcode(decodePng(Buffer.from(shot))) });
  }
  return { samples: out, hiddenAt: null, shownAt: null };
}

/* --------------------------------- 主流程 --------------------------------- */

(async () => {
  const pw = await loadPlaywright();
  const engine = pw[browserName];
  if (!engine) { console.error('未知浏览器 ' + browserName); process.exit(1); }

  const browser = await engine.launch();
  const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  await page.setContent(`
    <style>
      html,body { margin:0; padding:0; background:#000; overflow:hidden; }
      #wrap { width:${W}px; height:${H}px; }
      #probe { display:block; width:${W}px; height:${H}px; image-rendering: pixelated; }
      #ticker { position:absolute; left:0; top:${H + 10}px; width:20px; height:20px; }
    </style>
    <div id="wrap"><img id="probe" src="${URL_BASE}/assets/demo-audio.gif?t=${Date.now()}"
        onload="window.__loadEpoch = Date.now();"></div>
    <canvas id="ticker" width="20" height="20"></canvas>
    <script>
      const tc = document.getElementById('ticker').getContext('2d');
      let k = 0;
      (function loop() {
        k = (k + 1) % 256;
        tc.fillStyle = 'rgb(' + k + ',0,0)';
        tc.fillRect(0, 0, 20, 20);
        requestAnimationFrame(loop);
      })();
    </script>
  `);
  await page.waitForFunction(() => {
    const i = document.getElementById('probe');
    return i && i.complete && i.naturalWidth > 0 && window.__loadEpoch;
  }, null, { timeout: 10000 });

  const userAgent = await page.evaluate(() => navigator.userAgent);
  const loadEpochMs = await page.evaluate(() => window.__loadEpoch);

  const collected = browserName === 'chromium'
    ? await collectChromium(page, context, DURATION)
    : await collectScreenshot(page, DURATION);

  await browser.close();

  const raw = collected.samples.filter(s => s.frame >= 0 && s.frame < FRAME_COUNT);
  if (raw.length < 10) { console.error('采样不足: ' + raw.length); process.exit(2); }

  /* ---------------------------- 分析 ---------------------------- */

  const t0 = raw[0].epochMs;
  const samples = raw.map(s => ({ ...s, t: s.epochMs - t0 }));

  const cycleDurations = [];
  let lastZero = null, prev = null;
  for (const s of samples) {
    if (prev === FRAME_COUNT - 1 && s.frame === 0) {
      if (lastZero !== null) cycleDurations.push(s.epochMs - lastZero);
      lastZero = s.epochMs;
    }
    prev = s.frame;
  }

  const firstZero = samples.find(s => s.frame === 0);
  const phaseOffsetMs = firstZero ? wrapCycle(firstZero.epochMs - loadEpochMs) : null;

  const evalSamples = samples.filter(s => s.epochMs > loadEpochMs + 200);

  let oracle = null;
  for (let phase = 0; phase < NOMINAL_CYCLE; phase += 4) {
    const errs = scoreAgainst(evalSamples, t0 + phase);
    const cost = mean(errs.map(e => e.errMs));
    if (!oracle || cost < oracle.cost) oracle = { cost, anchorMs: t0 + phase, errs };
  }

  const realisticErrs = scoreAgainst(evalSamples, loadEpochMs);

  const result = {
    browser: browserName,
    userAgent,
    durationMs: DURATION,
    hidden: HIDE,
    samples: samples.length,
    sampleIntervalMs: (samples[samples.length - 1].t - samples[0].t) / (samples.length - 1),
    distinctFramesObserved: new Set(samples.map(s => s.frame)).size,
    observedCycleMs: mean(cycleDurations),
    observedCycleCount: cycleDurations.length,
    cycleDriftMs: cycleDurations.length ? mean(cycleDurations) - NOMINAL_CYCLE : null,
    cycleStdDevMs: cycleDurations.length
      ? Math.sqrt(mean(cycleDurations.map(c => (c - mean(cycleDurations)) ** 2))) : null,
    phaseOffsetFromLoadMs: phaseOffsetMs,
    b1Oracle: summarizeErrors(oracle.errs),
    b1Realistic: summarizeErrors(realisticErrs),
  };

  // 隐藏扰动：分别看隐藏前 / 恢复后，B1-realistic 的误差
  if (HIDE && collected.hiddenAt && collected.shownAt) {
    const before = evalSamples.filter(s => s.epochMs < collected.hiddenAt);
    const after = evalSamples.filter(s => s.epochMs > collected.shownAt + 150);

    // 恢复瞬间的实际落后量：按墙钟应多走多少，实际只走了多少
    const atShow = after[0];
    const lagAtResumeMs = atShow
      ? wrapCycle(atShow.epochMs - loadEpochMs) - FS0[atShow.frame]
      : null;

    result.perturbation = {
      hiddenMs: collected.shownAt - collected.hiddenAt,
      beforeHide: summarizeErrors(scoreAgainst(before, loadEpochMs)),
      afterShow: summarizeErrors(scoreAgainst(after, loadEpochMs)),
      lagAtResumeMs: lagAtResumeMs > NOMINAL_CYCLE / 2 ? lagAtResumeMs - NOMINAL_CYCLE : lagAtResumeMs,
    };
  }

  for (const k of Object.keys(result)) {
    if (typeof result[k] === 'number') result[k] = r2(result[k]);
  }
  const round = o => { for (const k of Object.keys(o)) if (typeof o[k] === 'number') o[k] = r2(o[k]); return o; };
  round(result.b1Oracle); round(result.b1Realistic);
  if (result.perturbation) {
    round(result.perturbation.beforeHide); round(result.perturbation.afterShow);
    result.perturbation.hiddenMs = r2(result.perturbation.hiddenMs);
    result.perturbation.lagAtResumeMs = r2(result.perturbation.lagAtResumeMs);
  }

  fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
  const tag = HIDE ? `native-${browserName}-hide` : `native-${browserName}`;
  const out = path.join(ROOT, 'results', `${tag}.json`);
  fs.writeFileSync(out, JSON.stringify({ result, rawSamples: samples }, null, 2));

  console.log(JSON.stringify(result, null, 2));
  console.log('\n写入 ' + out);
})();
