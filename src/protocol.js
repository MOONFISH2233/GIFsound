/**
 * FRAMEAUD v0.1 — 帧锚定音频扩展 (Frame-Anchored Audio Extension for GIF89a)
 *
 * 容器层：GIF89a Application Extension
 *   0x21 0xFF 0x0B "FRAMEAUD" "0.1"  <子块链>  0x00
 *
 * 子块链中每个子块首字节是 chunk type：
 *   0x01 = MANIFEST  (UTF-8 JSON，可跨多个子块，按出现顺序拼接)
 *   0x02 = AUDIO     (原始音频容器字节，例如完整 WAV 文件，可跨多个子块)
 *
 * 子块长度字节包含 type 字节，因此每块最大 255，净载荷最大 254。
 *
 * 本模块与运行环境无关（Node / 浏览器通用）。
 */

export const APP_NAME = 'FRAMEAUD'; // 8 字节
export const APP_AUTH = '0.1';      // 3 字节
export const APP_IDENTIFIER = APP_NAME + APP_AUTH; // 11 字节，与 GIF 规范一致

export const CHUNK_MANIFEST = 0x01;
export const CHUNK_AUDIO = 0x02;

export const PROTOCOL_VERSION = 1;
export const MAX_SUBBLOCK_PAYLOAD = 254; // 255 - 1 (type byte)

/* ------------------------------------------------------------------ */
/* 字节工具                                                            */
/* ------------------------------------------------------------------ */

export function concatBytes(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function splitChunks(type, bytes) {
  const blocks = [];
  for (let i = 0; i < bytes.length; i += MAX_SUBBLOCK_PAYLOAD) {
    const piece = bytes.subarray(i, i + MAX_SUBBLOCK_PAYLOAD);
    const block = new Uint8Array(piece.length + 2);
    block[0] = piece.length + 1; // 子块长度（含 type）
    block[1] = type;
    block.set(piece, 2);
    blocks.push(block);
  }
  // 空载荷也要写一个头，便于解析端知道该 chunk 存在
  if (bytes.length === 0) blocks.push(new Uint8Array([1, type]));
  return blocks;
}

/* ------------------------------------------------------------------ */
/* 时序模型                                                            */
/* ------------------------------------------------------------------ */

/**
 * 由帧延迟生成稠密锚点：每个帧的开始时刻都成为一个锚点。
 * time 是该帧在播放周期内的呈现时间（ticks，timescale 见 manifest）。
 */
export function denseAnchors(framesMs) {
  const anchors = [];
  let t = 0;
  for (let i = 0; i < framesMs.length; i++) {
    anchors.push({ frame: i, time: t });
    t += framesMs[i];
  }
  return anchors;
}

/**
 * 校验锚点表：帧号严格递增、时间严格递增、首锚点为 0 时刻。
 * 返回 { ok, reason }
 */
export function validateAnchors(anchors, frameCount) {
  if (!Array.isArray(anchors) || anchors.length === 0) {
    return { ok: false, reason: 'anchors empty' };
  }
  if (anchors[0].frame !== 0 || anchors[0].time !== 0) {
    return { ok: false, reason: 'first anchor must be frame 0 @ time 0' };
  }
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i], b = anchors[i - 1];
    if (!(a.frame > b.frame)) return { ok: false, reason: `anchor frame not increasing at ${i}` };
    if (!(a.time > b.time)) return { ok: false, reason: `anchor time not increasing at ${i}` };
    if (a.frame >= frameCount) return { ok: false, reason: `anchor frame ${a.frame} >= frameCount` };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* 构建扩展块                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {object} opt
 * @param {number[]} opt.framesMs       每帧延迟（毫秒），必须与 GIF GCE 中的 delay 一致
 * @param {Uint8Array} opt.audioBytes   音频容器字节（通常是完整 WAV）
 * @param {object} opt.audioMeta        { codec, sampleRate, channels, bitsPerSample }
 * @param {object[]} [opt.anchors]      帧锚点表，缺省则由 framesMs 生成稠密锚点
 * @param {object} [opt.policy]         { onLoop, onDetach }
 * @returns {Uint8Array} 完整 Application Extension 块字节（含 0x21 0xFF ... 0x00）
 */
export function buildAudioExtension(opt) {
  const {
    framesMs,
    audioBytes,
    audioMeta,
    anchors = denseAnchors(framesMs),
    policy = { onLoop: 'restart', onDetach: 'silent' },
  } = opt;

  const v = validateAnchors(anchors, framesMs.length);
  if (!v.ok) throw new Error('invalid anchors: ' + v.reason);

  const cycleTicks = framesMs.reduce((a, b) => a + b, 0);

  const manifest = {
    v: PROTOCOL_VERSION,
    frameCount: framesMs.length,
    timescale: 1000,
    cycleTicks,
    frames: framesMs.slice(),
    anchors: anchors.map(a => ({ frame: a.frame, time: a.time })),
    audio: {
      ...audioMeta,
      byteLength: audioBytes.length,
    },
    policy,
  };

  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));

  const blocks = [
    new Uint8Array([0x21, 0xFF, 0x0B]),
    new TextEncoder().encode(APP_IDENTIFIER),
    ...splitChunks(CHUNK_MANIFEST, manifestBytes),
    ...splitChunks(CHUNK_AUDIO, audioBytes),
    new Uint8Array([0x00]), // block terminator
  ];
  return concatBytes(blocks);
}

/* ------------------------------------------------------------------ */
/* 解析扩展块                                                          */
/* ------------------------------------------------------------------ */

/**
 * 从 GIF 解析结果中取出 FRAMEAUD 扩展。
 * @param {{identifier: string, subBlocks: Uint8Array[]}[]} extensions
 * @returns {null | {manifest: object, audioBytes: Uint8Array, ok: boolean, reason?: string}}
 */
export function parseAudioExtension(extensions) {
  const ext = extensions.find(e => e.identifier === APP_IDENTIFIER);
  if (!ext) return null;

  const manifestParts = [];
  const audioParts = [];
  for (const sb of ext.subBlocks) {
    if (sb.length === 0) continue;
    const type = sb[0];
    const payload = sb.subarray(1);
    if (type === CHUNK_MANIFEST) manifestParts.push(payload);
    else if (type === CHUNK_AUDIO) audioParts.push(payload);
    // 未知 chunk type 按前向兼容规则忽略
  }

  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(concatBytes(manifestParts)));
  } catch (e) {
    return { manifest: null, audioBytes: new Uint8Array(0), ok: false, reason: 'manifest JSON parse failed' };
  }

  const audioBytes = concatBytes(audioParts);
  const check = verifyManifest(manifest, audioBytes.length);
  return { manifest, audioBytes, ok: check.ok, reason: check.reason };
}

/**
 * 结构性校验：任何一项不满足都说明文件被裁剪/重编码过，协议失效，播放器应降级。
 */
export function verifyManifest(manifest, audioByteLength) {
  if (!manifest || manifest.v !== PROTOCOL_VERSION) {
    return { ok: false, reason: 'unsupported protocol version' };
  }
  if (!Array.isArray(manifest.frames) || !Array.isArray(manifest.anchors)) {
    return { ok: false, reason: 'manifest missing frames/anchors' };
  }
  if (manifest.frames.length !== manifest.frameCount) {
    return { ok: false, reason: 'frameCount mismatch' };
  }
  const cycle = manifest.frames.reduce((a, b) => a + b, 0);
  if (cycle !== manifest.cycleTicks) {
    return { ok: false, reason: 'cycleTicks != sum(frames)' };
  }
  const av = validateAnchors(manifest.anchors, manifest.frameCount);
  if (!av.ok) return av;
  if (manifest.audio?.byteLength !== audioByteLength) {
    return { ok: false, reason: `audio byteLength mismatch (${manifest.audio?.byteLength} vs ${audioByteLength})` };
  }
  return { ok: true };
}

/**
 * 把锚点表反演成「按时间查帧」的函数（二分）。
 * 返回 (ticks) => frameIndex，ticks 应在 [0, cycleTicks) 内。
 */
export function makeTimeToFrame(anchors, cycleTicks) {
  const times = anchors.map(a => a.time);
  const frames = anchors.map(a => a.frame);
  return function frameAt(ticks) {
    let lo = 0, hi = times.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= ticks) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return frames[ans];
  };
}
