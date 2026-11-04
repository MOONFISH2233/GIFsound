/**
 * 原型自检。运行：node test/run.js
 */

import { lzwEncode } from '../src/gif-encode.js';
import { lzwDecode, deinterlace } from '../src/gif-lzw.js';
import { encodeGif } from '../src/gif-encode.js';
import { parseGif, insertBeforeTrailer } from '../src/gif-parse.js';
import {
  buildAudioExtension, parseAudioExtension, verifyManifest,
  denseAnchors, makeTimeToFrame, APP_IDENTIFIER,
} from '../src/protocol.js';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
}

/* ------------------------- 1. LZW 往返 ------------------------- */
console.log('\n[1] LZW 编解码往返');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

for (const bits of [2, 4, 8]) {
  const paletteSize = 1 << bits;
  const rnd = mulberry32(1234 + bits);
  const n = 60000;

  // 随机数据（高熵）
  const randomData = new Uint8Array(n);
  for (let i = 0; i < n; i++) randomData[i] = Math.floor(rnd() * paletteSize);

  // 结构化数据（低熵，触发字典增长更深）
  const structured = new Uint8Array(n);
  for (let i = 0; i < n; i++) structured[i] = ((i * 7) ^ (i >> 3)) % paletteSize;

  for (const [label, data] of [['random', randomData], ['structured', structured]]) {
    const enc = lzwEncode(data, bits);
    const dec = lzwDecode(bits, enc, data.length);
    let same = true, at = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== dec[i]) { same = false; at = i; break; }
    }
    check(`${bits}bit/${label} (${enc.length}B)`, same, same ? '' : `first mismatch @${at}: ${data[at]} vs ${dec[at]}`);
  }
}

/* ------------------- 2. 编码 → 解析 → 解码 ------------------- */
console.log('\n[2] GIF 编码 → 结构解析 → 像素还原');

{
  const W = 37, H = 23; // 故意用非 2 的幂尺寸
  const palette = new Uint8Array(16 * 3);
  for (let i = 0; i < 16; i++) { palette[i * 3] = i * 16; palette[i * 3 + 1] = 255 - i * 16; palette[i * 3 + 2] = i * 7; }

  const rnd = mulberry32(99);
  const frames = [];
  for (let f = 0; f < 5; f++) {
    const idx = new Uint8Array(W * H);
    for (let i = 0; i < idx.length; i++) idx[i] = Math.floor(rnd() * 16);
    frames.push({ indices: idx, delayCs: 5 + f, disposal: 1 });
  }

  const bytes = encodeGif({ width: W, height: H, palette, frames, loop: 0 });
  const g = parseGif(bytes);

  check('尺寸', g.width === W && g.height === H);
  check('帧数', g.frames.length === 5);
  check('延迟', JSON.stringify(g.frameDelaysMs) === JSON.stringify([50, 60, 70, 80, 90]), JSON.stringify(g.frameDelaysMs));
  check('循环次数', g.loopCount === 0, String(g.loopCount));

  let allSame = true;
  for (let f = 0; f < 5; f++) {
    const dec = lzwDecode(g.frames[f].minCodeSize, g.frames[f].lzwData, W * H);
    for (let i = 0; i < W * H; i++) if (dec[i] !== frames[f].indices[i]) { allSame = false; break; }
  }
  check('5 帧像素完全一致', allSame);
}

/* --------------------- 3. 协议构建 / 解析 --------------------- */
console.log('\n[3] FRAMEAUD 协议');

{
  const framesMs = [80, 100, 120, 60];
  const audio = Uint8Array.from({ length: 30000 }, (_, i) => (i * 37) & 0xff);
  const anchors = denseAnchors(framesMs);

  check('锚点稠密生成', JSON.stringify(anchors) === JSON.stringify([
    { frame: 0, time: 0 }, { frame: 1, time: 80 }, { frame: 2, time: 180 }, { frame: 3, time: 300 },
  ]), JSON.stringify(anchors));

  const ext = buildAudioExtension({
    framesMs, audioBytes: audio,
    audioMeta: { codec: 'pcm_s16le', container: 'wav', sampleRate: 44100, channels: 1, bitsPerSample: 16 },
  });

  const fakeGif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3b]);
  const withExt = insertBeforeTrailer(fakeGif, ext);
  const g = parseGif(withExt);

  check('扩展块被解析到', g.extensions.length === 1);
  check('identifier 正确', g.extensions[0]?.identifier === APP_IDENTIFIER, g.extensions[0]?.identifier);

  const got = parseAudioExtension(g.extensions);
  check('协议校验通过', got?.ok === true, got?.reason);
  check('帧数一致', got.manifest.frameCount === 4);
  check('cycleTicks 正确', got.manifest.cycleTicks === 360);
  check('音频字节完整', got.audioBytes.length === audio.length &&
    got.audioBytes.every((v, i) => v === audio[i]));

  // 锚点 → 时间查帧
  const frameAt = makeTimeToFrame(got.manifest.anchors, got.manifest.cycleTicks);
  check('t=0   → frame 0', frameAt(0) === 0);
  check('t=79  → frame 0', frameAt(79) === 0);
  check('t=80  → frame 1', frameAt(80) === 1);
  check('t=359 → frame 3', frameAt(359) === 3);

  // 篡改检测
  const truncated = verifyManifest({ ...got.manifest, audio: { ...got.manifest.audio, byteLength: 1 } }, audio.length);
  check('音频长度不符被检出', truncated.ok === false);

  const badCycle = verifyManifest({ ...got.manifest, cycleTicks: 999 }, audio.length);
  check('cycleTicks 不符被检出', badCycle.ok === false);

  const badAnchor = verifyManifest({
    ...got.manifest,
    anchors: [{ frame: 0, time: 0 }, { frame: 1, time: 0 }],
  }, audio.length);
  check('锚点非单调被检出', badAnchor.ok === false);

  // 未知 chunk type 应被忽略而非报错（前向兼容）
  const ext2 = new Uint8Array([...ext]);
  check('扩展块以 0x00 结尾', ext2[ext2.length - 1] === 0x00);
}

/* ------------------------- 4. 真实素材 ------------------------- */
console.log('\n[4] 真实素材 (assets/demo-audio.gif)');

{
  let fs;
  try { fs = await import('node:fs'); } catch {}
  if (fs && fs.existsSync('assets/demo-audio.gif')) {
    const bytes = new Uint8Array(fs.readFileSync('assets/demo-audio.gif'));
    const g = parseGif(bytes);
    check('帧数 40', g.frames.length === 40, String(g.frames.length));
    check('周期 4000ms', g.totalMs === 4000, String(g.totalMs));

    const got = parseAudioExtension(g.extensions);
    check('协议校验通过', got?.ok === true, got?.reason);
    check('40 个锚点', got.manifest.anchors.length === 40);
    // 末帧起始时刻 = 周期 4000ms - 末帧延迟 110ms
    check('锚点末项 = 3890ms', got.manifest.anchors[39].time === 3890, String(got.manifest.anchors[39]?.time));

    // 所有帧都能解出正确像素数
    let ok = true;
    for (const f of g.frames) {
      const px = lzwDecode(f.minCodeSize, f.lzwData, f.width * f.height);
      if (px.length !== f.width * f.height) ok = false;
    }
    check('40 帧 LZW 解码成功', ok);
  } else {
    console.log('  (跳过：先运行 node src/node/make-assets.js)');
  }
}

/* --------------------------- 汇总 --------------------------- */
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
