/**
 * 生成测试素材：
 *   1. assets/demo.gif        40 帧、延迟不均匀、底部带机器可读的帧号条码
 *   2. assets/demo.wav        与一个播放周期等长的音频，在特定帧边界放提示音
 *   3. assets/demo-audio.gif  把 (1) 和 (2) 合成为一个带帧锚定音频的 GIF
 *
 * 条码规则（lab 页面据此还原「浏览器此刻实际显示的是第几帧」）：
 *   底部 y=168 一行，12 个 20px 宽色块，色块 j 为白色表示 (frame+1) 的第 j 位为 1。
 *
 * 运行：node src/node/make-assets.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeGif } from '../gif-encode.js';
import { parseGif, insertBeforeTrailer } from '../gif-parse.js';
import { buildAudioExtension, parseAudioExtension } from '../protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ASSETS = path.join(ROOT, 'assets');

const W = 240;
const H = 180;
const BARCODE_Y = 156;
const BLOCK_W = 20;
const BLOCK_H = 24;
const BITS = 12;

// 不均匀的帧延迟：证明时序模型不依赖「每一帧等长」
const DELAY_PATTERN = [80, 100, 120, 60, 140, 100, 90, 110];
const FRAME_COUNT = 40;
const delaysMs = Array.from({ length: FRAME_COUNT }, (_, i) => DELAY_PATTERN[i % DELAY_PATTERN.length]);
const cycleMs = delaysMs.reduce((a, b) => a + b, 0);

/* ------------------------------ 调色板 ------------------------------ */

function buildPalette() {
  const p = new Uint8Array(128 * 3);
  const set = (i, r, g, b) => { p[i * 3] = r; p[i * 3 + 1] = g; p[i * 3 + 2] = b; };
  set(0, 0, 0);        // 黑
  set(1, 255, 255, 255); // 白
  for (let i = 0; i < 64; i++) {
    const h = i / 64;
    // 简单的 HSV→RGB，饱和度 0.75、明度 0.85，保证相邻帧颜色肉眼可分
    const f = (n) => {
      const k = (n + h * 6) % 6;
      return 0.85 * (1 - 0.75 * Math.max(0, Math.min(k, 4 - k, 1)));
    };
    set(2 + i, Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255));
  }
  return p;
}

/* ------------------------------ 帧内容 ------------------------------ */

function buildFrame(i) {
  const idx = new Uint8Array(W * H);
  const bg = 2 + (i % 64);
  idx.fill(bg);

  // 运动方块：位置随帧号变化，肉眼可见
  const bx = (i * 5) % (W - 40);
  const by = 40;
  for (let y = by; y < by + 40; y++) {
    for (let x = bx; x < bx + 40; x++) idx[y * W + x] = 1;
  }

  // 底部条码
  const value = i + 1;
  for (let y = BARCODE_Y; y < BARCODE_Y + BLOCK_H && y < H; y++) {
    for (let j = 0; j < BITS; j++) {
      const bit = (value >> j) & 1;
      const color = bit ? 1 : 0;
      for (let x = j * BLOCK_W; x < (j + 1) * BLOCK_W && x < W; x++) {
        idx[y * W + x] = color;
      }
    }
  }
  return idx;
}

/* ------------------------------- WAV ------------------------------- */

function makeWav({ sampleRate = 44100, durationMs, events }) {
  const n = Math.round((sampleRate * durationMs) / 1000);
  const data = new Float32Array(n);

  // 低电平底噪（220Hz），让音频在整段都存在，便于判断「是否在播」
  for (let i = 0; i < n; i++) {
    data[i] = 0.05 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
  }

  // 事件：在指定毫秒处叠加一段 1kHz 短音，带 2ms 线性淡入避免爆音
  for (const ev of events) {
    const start = Math.round((ev.atMs * sampleRate) / 1000);
    const len = Math.round((ev.durMs * sampleRate) / 1000);
    const fade = Math.round((2 * sampleRate) / 1000);
    for (let k = 0; k < len && start + k < n; k++) {
      const env = Math.min(1, k / fade) * (1 - k / len);
      data[start + k] += ev.amp * env * Math.sin((2 * Math.PI * ev.freq * k) / sampleRate);
    }
  }

  // 转 16bit PCM
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767)));
  }

  const dataBytes = new Uint8Array(pcm.buffer);
  const header = new ArrayBuffer(44);
  const dv = new DataView(header);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };

  writeStr(0, 'RIFF');
  dv.setUint32(4, 36 + dataBytes.length, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);       // PCM
  dv.setUint16(22, 1, true);       // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  writeStr(36, 'data');
  dv.setUint32(40, dataBytes.length, true);

  const out = new Uint8Array(44 + dataBytes.length);
  out.set(new Uint8Array(header), 0);
  out.set(dataBytes, 44);
  return out;
}

/** 帧起始时刻（毫秒），相对周期起点 */
function frameStartTimes(delays) {
  const t = [0];
  for (let i = 1; i < delays.length; i++) t.push(t[i - 1] + delays[i - 1]);
  return t;
}

/* ------------------------------- 主流程 ------------------------------- */

fs.mkdirSync(ASSETS, { recursive: true });

// 1) GIF
const palette = buildPalette();
const gifBytes = encodeGif({
  width: W, height: H, palette,
  loop: 0,
  frames: delaysMs.map((d, i) => ({ indices: buildFrame(i), delayCs: d / 10, disposal: 1 })),
});
const gifPath = path.join(ASSETS, 'demo.gif');
fs.writeFileSync(gifPath, gifBytes);
console.log(`[1/3] ${gifPath}  ${gifBytes.length} bytes  ${FRAME_COUNT} frames  cycle=${cycleMs}ms`);

// 2) WAV —— 在帧 0/10/20/30 起点放提示音
const starts = frameStartTimes(delaysMs);
const events = [0, 10, 20, 30].map(f => ({
  atMs: starts[f], durMs: 15, freq: 1000, amp: 0.55,
}));
const wavBytes = makeWav({ durationMs: cycleMs, events });
const wavPath = path.join(ASSETS, 'demo.wav');
fs.writeFileSync(wavPath, wavBytes);
console.log(`[2/3] ${wavPath}  ${wavBytes.length} bytes  ${cycleMs}ms  beeps@${[0, 10, 20, 30].map(f => starts[f]).join(',')}ms`);

// 3) 注入
const parsed = parseGif(gifBytes);
if (parsed.frames.length !== FRAME_COUNT) throw new Error('frame count mismatch');
const actualDelays = parsed.frameDelaysMs;
console.log(`      解析到的帧延迟: ${actualDelays.slice(0, 8).join(',')} ... (cycle=${parsed.totalMs}ms)`);

const ext = buildAudioExtension({
  framesMs: actualDelays,
  audioBytes: wavBytes,
  audioMeta: { codec: 'pcm_s16le', container: 'wav', sampleRate: 44100, channels: 1, bitsPerSample: 16 },
});
const withAudio = insertBeforeTrailer(gifBytes, ext);
const outPath = path.join(ASSETS, 'demo-audio.gif');
fs.writeFileSync(outPath, withAudio);
console.log(`[3/3] ${outPath}  ${withAudio.length} bytes  (+${withAudio.length - gifBytes.length} bytes, ${((withAudio.length / gifBytes.length) * 100).toFixed(1)}%)`);

// 自检：重新解析注入结果
const reparsed = parseGif(withAudio);
const got = parseAudioExtension(reparsed.extensions);
if (!got || !got.ok) {
  console.error('自检失败:', got && got.reason);
  process.exit(1);
}
console.log(`      自检通过: frameCount=${got.manifest.frameCount}, anchors=${got.manifest.anchors.length}, audio=${got.audioBytes.length}B`);
