/**
 * 实验 B：测量「帧锚定自绘播放器」。
 *
 * 与实验 A 使用完全相同的真值来源（合成器截图 + 底部条码），
 * 因此两边的数字可以直接对比。
 *
 * 测三件事：
 *   1. 屏幕上实际显示的帧 是否等于 音频时间轴认为该显示的帧（应恒等）
 *   2. 帧切换相对理想边界的滞后（受限于刷新率）
 *   3. 热切入时音频偏移 是否精确落在当前帧的时间窗内
 *
 * 运行：node tools/measure-player.js [chromium] [毫秒]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPlaywright } from './load-playwright.js';
import { decodePng, luminance } from './png-decode.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 240, H = 180, VW = 240, VH = 220, BARCODE_Y = 168, BLOCK_W = 20, BITS = 12;
const URL_BASE = process.env.FRAME_AUD_BASE || 'http://localhost:8080';

const browserName = process.argv[2] || 'chromium';
const DURATION = Number(process.argv[3] || 16000);
const PREDICT = Number(process.argv[4] || 0);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pct = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const r2 = n => (n === null || n === undefined || Number.isNaN(n)) ? null : Math.round(n * 100) / 100;

function readBarcode(png) {
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

(async () => {
  const pw = await loadPlaywright();
  const browser = await pw[browserName].launch();
  const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  await page.goto(`${URL_BASE}/web/player-probe.html?predict=${PREDICT}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 10000 });

  const userAgent = await page.evaluate(() => navigator.userAgent);

  // 1) 无声自播（模拟页面加载后 GIF 已经在动）
  await page.click('#go');
  await page.waitForFunction(() => window.__started === true);

  // 2) 1.3 秒后用户点击解锁音频 —— 真正意义上的热切入
  await sleep(1300);
  await page.click('#unlock');
  await page.waitForFunction(() => window.__hotJoin !== undefined);

  const client = await context.newCDPSession(page);
  await client.send('Page.enable');

  const raw = [];
  client.on('Page.screencastFrame', async (ev) => {
    raw.push({ epochMs: ev.metadata.timestamp * 1000, data: ev.data });
    try { await client.send('Page.screencastFrameAck', { sessionId: ev.sessionId }); } catch {}
  });
  await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: VW, maxHeight: VH });
  await sleep(DURATION);
  await client.send('Page.stopScreencast');
  await client.detach();

  // 采集结束后一次性问页面：每个截图时刻，播放器认为应该显示哪一帧
  const epochs = raw.map(f => f.epochMs);
  const probe = await page.evaluate(es => window.__probeBatch(es), epochs);
  const hotJoin = await page.evaluate(() => window.__hotJoin);
  await browser.close();

  const samples = raw
    .map((f, i) => ({
      epochMs: f.epochMs,
      actual: readBarcode(decodePng(Buffer.from(f.data, 'base64'))),
      expected: probe.frames[i],
      pos: probe.positions[i],
    }))
    .filter(s => s.actual >= 0);

  if (samples.length < 10) { console.error('采样不足: ' + samples.length); process.exit(2); }

  /* --------------------- 1. 显示帧 vs 音频时间轴 --------------------- */

  let mismatch = 0;
  for (const s of samples) if (s.actual !== s.expected) mismatch++;

  /* --------------------- 2. 帧切换滞后 --------------------- */

  // 观测到的切换时刻 vs 理想边界（t0 + frameStarts[f] + k*cycle）
  const lags = [];
  let prev = null;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    if (b.actual === a.actual) continue;
    const idealPos = probe.frameStartsMs[b.actual];
    let lag = b.pos - idealPos;
    if (lag < -probe.cycleMs / 2) lag += probe.cycleMs;
    if (lag > probe.cycleMs / 2) lag -= probe.cycleMs;
    if (lag >= 0 && lag < 500) lags.push(lag);
    prev = b.actual;
  }

  const sampleInterval = (samples[samples.length - 1].epochMs - samples[0].epochMs) / (samples.length - 1);

  // 与实验 A 同量纲的绝对时间误差：显示帧 与 音频时间轴该显示的帧 差多少毫秒
  const cycle = probe.cycleMs;
  const absErrs = samples.map(s => {
    let d = probe.frameStartsMs[s.expected] - probe.frameStartsMs[s.actual];
    if (d > cycle / 2) d -= cycle;
    if (d < -cycle / 2) d += cycle;
    return Math.abs(d);
  });

  const result = {
    browser: browserName,
    userAgent,
    durationMs: DURATION,
    samples: samples.length,
    sampleIntervalMs: sampleInterval,
    displayMatchesAudioTimeline: {
      mismatches: mismatch,
      rate: mismatch / samples.length,
      meanAbsErrMs: mean(absErrs),
      p95AbsErrMs: pct(absErrs, 0.95),
      maxAbsErrMs: Math.max(0, ...absErrs),
    },
    frameSwitchLagMs: {
      samples: lags.length,
      mean: mean(lags),
      p95: pct(lags, 0.95),
      max: Math.max(0, ...lags),
    },
    predictMs: PREDICT,
    hotJoin,
    clock: {
      cycleMs: probe.cycleMs,
      stats: probe.stats,
    },
  };

  for (const k of Object.keys(result)) if (typeof result[k] === 'number') result[k] = r2(result[k]);
  result.sampleIntervalMs = r2(result.sampleIntervalMs);
  for (const k of Object.keys(result.displayMatchesAudioTimeline)) {
    result.displayMatchesAudioTimeline[k] = r2(result.displayMatchesAudioTimeline[k]);
  }
  for (const k of Object.keys(result.frameSwitchLagMs)) {
    result.frameSwitchLagMs[k] = r2(result.frameSwitchLagMs[k]);
  }

  fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
  const out = path.join(ROOT, 'results', `player-${browserName}-predict${PREDICT}.json`);
  fs.writeFileSync(out, JSON.stringify({ result, samples }, null, 2));

  console.log(JSON.stringify(result, null, 2));
  console.log('\n写入 ' + out);
})();
