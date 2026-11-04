/**
 * GIF89a 结构解析器（与运行环境无关）。
 *
 * 只做「结构级」解析：切出每个图像块、图形控制扩展、应用扩展、LZW 压缩数据。
 * 像素解码在 gif-lzw.js，帧合成在浏览器侧。
 */

import { concatBytes } from './protocol.js';

function u16(b, i) { return b[i] | (b[i + 1] << 8); }

function readColorTable(bytes, pos, size) {
  const n = size * 3;
  if (pos + n > bytes.length) throw new Error('color table out of range');
  return { table: bytes.subarray(pos, pos + n), next: pos + n };
}

function readSubBlocks(bytes, pos) {
  const parts = [];
  while (pos < bytes.length) {
    const len = bytes[pos++];
    if (len === 0) break;
    const end = pos + len;
    if (end > bytes.length) throw new Error('sub-block out of range');
    parts.push(bytes.subarray(pos, end));
    pos = end;
  }
  return { data: concatBytes(parts), raw: parts, next: pos };
}

/**
 * @param {Uint8Array} bytes
 */
export function parseGif(bytes) {
  if (bytes.length < 13) throw new Error('too short for GIF');
  const sig = String.fromCharCode(...bytes.subarray(0, 6));
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('bad signature: ' + sig);

  const width = u16(bytes, 6);
  const height = u16(bytes, 8);
  const packed = bytes[10];
  const backgroundIndex = bytes[11];
  const aspect = bytes[12];
  let pos = 13;

  let globalColorTable = null;
  if (packed & 0x80) {
    const size = 1 << ((packed & 0x07) + 1);
    const ct = readColorTable(bytes, pos, size);
    globalColorTable = ct.table;
    pos = ct.next;
  }

  const frames = [];
  const extensions = [];
  const comments = [];
  let loopCount = null;
  let pendingGCE = null;

  while (pos < bytes.length) {
    const introducer = bytes[pos++];
    if (introducer === 0x3b) break; // trailer

    if (introducer === 0x21) {
      const label = bytes[pos++];
      if (label === 0xf9) {
        // Graphic Control Extension
        const len = bytes[pos++];
        const blockPacked = bytes[pos];
        const delayCs = u16(bytes, pos + 1);
        const transparentIndex = bytes[pos + 3];
        pos += len;
        const term = bytes[pos++];
        if (term !== 0) throw new Error('GCE not terminated');
        pendingGCE = {
          disposal: (blockPacked >> 2) & 0x07,
          userInput: !!(blockPacked & 0x02),
          transparent: !!(blockPacked & 0x01),
          transparentIndex,
          delayCs,
        };
      } else if (label === 0xff) {
        // Application Extension
        const len = bytes[pos++];
        const identifier = String.fromCharCode(...bytes.subarray(pos, pos + len));
        pos += len;
        const sub = readSubBlocks(bytes, pos);
        pos = sub.next;
        extensions.push({ identifier, subBlocks: sub.raw, at: 'app' });

        if (identifier === 'NETSCAPE2.0' || identifier === 'ANIMEXTS1.0') {
          const d = sub.data;
          if (d.length >= 3 && d[0] === 0x01) loopCount = d[1] | (d[2] << 8);
        }
      } else if (label === 0xfe) {
        const sub = readSubBlocks(bytes, pos);
        pos = sub.next;
        comments.push(new TextDecoder().decode(sub.data));
      } else {
        // Plain Text 0x01 / 其他：跳过子块
        const sub = readSubBlocks(bytes, pos);
        pos = sub.next;
        extensions.push({ identifier: `label:0x${label.toString(16)}`, subBlocks: sub.raw, at: 'other' });
      }
      continue;
    }

    if (introducer === 0x2c) {
      const left = u16(bytes, pos); pos += 2;
      const top = u16(bytes, pos); pos += 2;
      const fw = u16(bytes, pos); pos += 2;
      const fh = u16(bytes, pos); pos += 2;
      const fpacked = bytes[pos++];

      let colorTable = null;
      if (fpacked & 0x80) {
        const size = 1 << ((fpacked & 0x07) + 1);
        const ct = readColorTable(bytes, pos, size);
        colorTable = ct.table;
        pos = ct.next;
      }

      const minCodeSize = bytes[pos++];
      const sub = readSubBlocks(bytes, pos);
      pos = sub.next;

      frames.push({
        left, top, width: fw, height: fh,
        interlaced: !!(fpacked & 0x40),
        colorTable,
        minCodeSize,
        lzwData: sub.data,
        gce: pendingGCE || { disposal: 0, userInput: false, transparent: false, transparentIndex: 0, delayCs: 0 },
      });
      pendingGCE = null;
      continue;
    }

    throw new Error(`unknown block introducer 0x${introducer.toString(16)} at ${pos - 1}`);
  }

  return {
    signature: sig,
    width, height,
    backgroundIndex, aspect,
    globalColorTable,
    frames,
    extensions,
    comments,
    loopCount,
    /** 帧延迟（毫秒）。GIF 以 1/100 秒为单位。 */
    frameDelaysMs: frames.map(f => f.gce.delayCs * 10),
    totalMs: frames.reduce((a, f) => a + f.gce.delayCs * 10, 0),
  };
}

/**
 * 在 GIF trailer (0x3B) 之前插入一段任意块字节。
 * 返回新的 Uint8Array，不修改输入。
 */
export function insertBeforeTrailer(bytes, blockBytes) {
  let end = bytes.length - 1;
  while (end >= 0 && bytes[end] !== 0x3b) end--;
  if (end < 0) throw new Error('no GIF trailer found');
  const out = new Uint8Array(bytes.length + blockBytes.length);
  out.set(bytes.subarray(0, end), 0);
  out.set(blockBytes, end);
  out.set(bytes.subarray(end), end + blockBytes.length);
  return out;
}
