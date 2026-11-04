/**
 * 极简 GIF89a 编码器（与运行环境无关）。
 * 用途：生成可控的测试素材（精确的调色板、精确的帧延迟、可机器识别的帧号条码）。
 * 不追求压缩率，追求确定性。
 */

import { concatBytes } from './protocol.js';

/* ---------------------------- LZW 编码 ---------------------------- */

export function lzwEncode(indices, minCodeSize) {
  const CLEAR = 1 << minCodeSize;
  const EOI = CLEAR + 1;

  const bytes = [];
  let bitBuf = 0;
  let bitCnt = 0;
  let codeSize = minCodeSize + 1;

  const emit = (code) => {
    bitBuf |= code << bitCnt;
    bitCnt += codeSize;
    while (bitCnt >= 8) {
      bytes.push(bitBuf & 0xff);
      bitBuf >>>= 8;
      bitCnt -= 8;
    }
  };

  let dict = new Map();
  let next = CLEAR + 2;

  emit(CLEAR);

  if (indices.length === 0) {
    emit(EOI);
  } else {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      const found = dict.get(key);
      if (found !== undefined) {
        prefix = found;
        continue;
      }
      emit(prefix);
      if (next < 4096) {
        dict.set(key, next++);
        // 注意：解码器的字典恒比编码器落后一个条目（首个码不建表），
        // 因此码宽增长的判据是 next > 2^codeSize，而不是 next === 2^codeSize。
        if (next > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        emit(CLEAR);
        dict = new Map();
        next = CLEAR + 2;
        codeSize = minCodeSize + 1;
      }
      prefix = k;
    }
    emit(prefix);
    emit(EOI);
  }

  if (bitCnt > 0) bytes.push(bitBuf & 0xff);
  return Uint8Array.from(bytes);
}

/* ---------------------------- 文件写出 ---------------------------- */

function u16le(n) {
  return [n & 0xff, (n >> 8) & 0xff];
}

function writeSubBlocks(data) {
  const out = [];
  for (let i = 0; i < data.length; i += 255) {
    const piece = data.subarray(i, Math.min(i + 255, data.length));
    out.push(Uint8Array.from([piece.length]), piece);
  }
  out.push(Uint8Array.from([0]));
  return concatBytes(out);
}

function paletteSizeFor(count) {
  let n = 2;
  while (n < count && n < 256) n <<= 1;
  return n;
}

/**
 * @param {object} opt
 * @param {number} opt.width
 * @param {number} opt.height
 * @param {Uint8Array} opt.palette         RGB 三元组平铺，长度 = n*3
 * @param {{indices: Uint8Array, delayCs: number, disposal?: number}[]} opt.frames
 * @param {number} [opt.loop]              0 = 无限循环；缺省不写循环扩展
 * @returns {Uint8Array}
 */
export function encodeGif(opt) {
  const { width, height, palette, frames } = opt;
  const colors = palette.length / 3;
  const gctSize = paletteSizeFor(colors);
  const gctBits = Math.log2(gctSize) - 1;
  const minCodeSize = Math.max(2, Math.log2(gctSize) || 1);

  const padded = new Uint8Array(gctSize * 3);
  padded.set(palette);

  const parts = [];
  parts.push(Uint8Array.from([
    ...'GIF89a'.split('').map(c => c.charCodeAt(0)),
    ...u16le(width), ...u16le(height),
    0x80 | 0x70 | gctBits, // GCT 存在 + 8bit 色深
    0, 0,
  ]));
  parts.push(padded);

  if (opt.loop !== undefined) {
    parts.push(Uint8Array.from([
      0x21, 0xff, 0x0b,
      ...'NETSCAPE2.0'.split('').map(c => c.charCodeAt(0)),
      0x03, 0x01, ...u16le(opt.loop), 0x00,
    ]));
  }

  for (const f of frames) {
    const disposal = f.disposal ?? 1;
    const delayCs = f.delayCs;
    parts.push(Uint8Array.from([
      0x21, 0xf9, 0x04,
      (disposal << 2),
      ...u16le(delayCs),
      0, 0x00,
    ]));

    parts.push(Uint8Array.from([
      0x2c,
      ...u16le(0), ...u16le(0),
      ...u16le(width), ...u16le(height),
      0x00,
      minCodeSize,
    ]));

    parts.push(writeSubBlocks(lzwEncode(f.indices, minCodeSize)));
  }

  parts.push(Uint8Array.from([0x3b]));
  return concatBytes(parts);
}
