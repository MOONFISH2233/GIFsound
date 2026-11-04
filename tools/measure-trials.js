/**
 * 多轮重复实验：单次测量的结果波动很大（实测同一配置下帧错配率在 0% 与 14% 之间跳），
 * 论文不能建立在一次运行上。这个脚本做 N 次独立加载，给出分布。
 *
 * 每轮都是全新的浏览器上下文 + 全新的 GIF URL（cache-bust），
 * 模拟「用户每次打开页面」的独立情形。
 *
 * 运行：node tools/measure-trials.js [浏览器] [轮数] [每轮毫秒]
 *   node tools/measure-trials.js chromium 12 8000
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browserName = process.argv[2] || 'chromium';
const TRIALS = Number(process.argv[3] || 12);
const PER_TRIAL = Number(process.argv[4] || 8000);

const median = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const q = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const r2 = n => (n === null || n === undefined || Number.isNaN(n)) ? null : Math.round(n * 100) / 100;

const rows = [];

for (let i = 0; i < TRIALS; i++) {
  const tag = `trial${String(i).padStart(2, '0')}`;
  process.stdout.write(`第 ${i + 1}/${TRIALS} 轮…`);
  try {
    execFileSync(process.execPath, ['tools/measure-native.js', browserName, String(PER_TRIAL)], {
      cwd: ROOT,
      env: { ...process.env, FRAME_AUD_TAG: tag },
      stdio: 'ignore',
      timeout: PER_TRIAL + 60000,
    });
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'results', `native-${browserName}-${tag}.json`), 'utf8'));
    const r = j.result;
    rows.push({
      trial: i,
      mismatchRate: r.b1Realistic.mismatchRate,
      meanAbsErrMs: r.b1Realistic.meanAbsErrMs,
      p95AbsErrMs: r.b1Realistic.p95AbsErrMs,
      maxAbsErrMs: r.b1Realistic.maxAbsErrMs,
      oracleMismatchRate: r.b1Oracle.mismatchRate,
      phaseOffsetMs: r.phaseOffsetFromLoadMs,
      cycleStdDevMs: r.cycleStdDevMs,
      samples: r.samples,
    });
    console.log(` 错配 ${(r.b1Realistic.mismatchRate * 100).toFixed(1)}%  平均 ${r.b1Realistic.meanAbsErrMs}ms`);
  } catch (e) {
    rows.push({ trial: i, error: String(e.message).split('\n')[0] });
    console.log(' 失败: ' + e.message.split('\n')[0]);
  }
}

const ok = rows.filter(r => !r.error);
const mismatch = ok.map(r => r.mismatchRate);
const meanErr = ok.map(r => r.meanAbsErrMs);
const phase = ok.map(r => r.phaseOffsetMs);

const summary = {
  browser: browserName,
  trials: TRIALS,
  perTrialMs: PER_TRIAL,
  successful: ok.length,
  b1RealisticMismatchRate: {
    median: r2(median(mismatch)),
    min: r2(Math.min(...mismatch)),
    max: r2(Math.max(...mismatch)),
    p25: r2(q(mismatch, 0.25)),
    p75: r2(q(mismatch, 0.75)),
  },
  b1RealisticMeanErrMs: {
    median: r2(median(meanErr)),
    min: r2(Math.min(...meanErr)),
    max: r2(Math.max(...meanErr)),
  },
  phaseOffsetFromLoadMs: {
    median: r2(median(phase)),
    min: r2(Math.min(...phase)),
    max: r2(Math.max(...phase)),
  },
  rows,
};

fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'results', `trials-${browserName}.json`), JSON.stringify(summary, null, 2));

console.log('\n=== 汇总 ===');
console.log(JSON.stringify({
  browser: summary.browser,
  successful: summary.successful,
  mismatchRate: summary.b1RealisticMismatchRate,
  meanErrMs: summary.b1RealisticMeanErrMs,
  phaseOffsetMs: summary.phaseOffsetFromLoadMs,
}, null, 2));
console.log('\n写入 results/trials-' + browserName + '.json');
