/**
 * 分发鲁棒性测试：常见的 GIF 重新编码链路，会保留什么、丢掉什么？
 *
 * 关注三件事：
 *   1. 逐帧延迟是否幸存（决定「时序」还能不能用）
 *   2. FRAMEAUD 扩展块是否幸存（决定「音频」还在不在）
 *   3. 文件体积如何变化
 *
 * 运行：node tools/test-distribution.js
 * 依赖：ffmpeg（PATH 中）；gifsicle / magick 存在时会一并测试
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseGif } from '../src/gif-parse.js';
import { parseAudioExtension } from '../src/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets', 'demo-audio.gif');
const OUT = path.join(ROOT, 'assets');

function has(cmd) {
  try { execFileSync(cmd, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
function hasAny(cmd, args) {
  try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; }
}

function inspect(file) {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const g = parseGif(bytes);
  const ext = parseAudioExtension(g.extensions);
  return {
    file: path.basename(file),
    bytes: bytes.length,
    width: g.width,
    height: g.height,
    frames: g.frames.length,
    cycleMs: g.totalMs,
    delaysFirst8: g.frameDelaysMs.slice(0, 8),
    identifiers: g.extensions.map(e => e.identifier),
    hasFrameAud: !!ext,
  };
}

const pipelines = [];

// 1) ffmpeg 直接重编码
pipelines.push({
  name: 'ffmpeg 重编码',
  out: path.join(OUT, 'roundtrip-ffmpeg.gif'),
  run: () => execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', SRC, '-f', 'gif', path.join(OUT, 'roundtrip-ffmpeg.gif')]),
});

// 2) ffmpeg 缩放 + 重新量化（更接近真实平台转码）
pipelines.push({
  name: 'ffmpeg 缩放+重量化',
  out: path.join(OUT, 'roundtrip-scaled.gif'),
  run: () => execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', SRC,
    '-vf', 'scale=120:90:flags=neighbor,split[a][b];[a]palettegen[p];[b][p]paletteuse',
    '-f', 'gif', path.join(OUT, 'roundtrip-scaled.gif')]),
});

// 3) gifsicle（若已安装）
if (has('gifsicle')) {
  pipelines.push({
    name: 'gifsicle -O3',
    out: path.join(OUT, 'roundtrip-gifsicle.gif'),
    run: () => execFileSync('gifsicle', ['-O3', SRC, '-o', path.join(OUT, 'roundtrip-gifsicle.gif')]),
  });
}

const results = [inspect(SRC)];

for (const p of pipelines) {
  try {
    p.run();
    const r = inspect(p.out);
    r.pipeline = p.name;
    results.push(r);
  } catch (e) {
    results.push({ pipeline: p.name, error: e.message.split('\n')[0] });
  }
}

fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'results', 'distribution.json'), JSON.stringify(results, null, 2));

console.log('链路'.padEnd(22), '帧数', '周期', '延迟前8项一致', 'FRAMEAUD', '体积');
const base = results[0];
for (const r of results) {
  if (r.error) { console.log(r.pipeline.padEnd(22), 'ERROR', r.error); continue; }
  const sameDelays = JSON.stringify(r.delaysFirst8) === JSON.stringify(base.delaysFirst8);
  console.log(
    (r.pipeline || '原始').padEnd(22),
    String(r.frames).padEnd(4),
    String(r.cycleMs + 'ms').padEnd(8),
    (sameDelays ? '是' : '否').padEnd(14),
    (r.hasFrameAud ? '存在' : '剥离').padEnd(9),
    (r.bytes + 'B')
  );
}
console.log('\n写入 results/distribution.json');
if (!has('gifsicle')) console.log('（gifsicle 未安装，已跳过该链路）');
