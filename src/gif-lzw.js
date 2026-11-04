/**
 * GIF LZW 解码器（与运行环境无关）。
 * 输入：minCodeSize + 已拼接的子块数据；输出：调色板索引数组。
 */

export function lzwDecode(minCodeSize, input, pixelCount) {
  const out = new Uint8Array(pixelCount);
  let op = 0;

  const CLEAR = 1 << minCodeSize;
  const EOI = CLEAR + 1;

  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  for (let i = 0; i < CLEAR; i++) suffix[i] = i;

  let avail = CLEAR + 2;
  let codeSize = minCodeSize + 1;
  let bitBuf = 0;
  let bitCnt = 0;
  let ip = 0;
  let old = -1;
  let firstChar = 0;

  const readCode = () => {
    while (bitCnt < codeSize) {
      if (ip >= input.length) return EOI;
      bitBuf |= input[ip++] << bitCnt;
      bitCnt += 8;
    }
    const c = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>= codeSize;
    bitCnt -= codeSize;
    return c;
  };

  while (op < pixelCount) {
    const code = readCode();
    if (code === EOI) break;

    if (code === CLEAR) {
      codeSize = minCodeSize + 1;
      avail = CLEAR + 2;
      old = -1;
      continue;
    }

    if (old < 0) {
      if (code >= CLEAR) break; // 流必须以根代码开头
      out[op++] = code;
      old = code;
      firstChar = code;
      continue;
    }

    let sp = 0;
    let c = code;

    if (code === avail) {
      // KwKwK 情形
      stack[sp++] = firstChar;
      c = old;
    } else if (code > avail) {
      break; // 码流损坏
    }

    while (c >= CLEAR) {
      if (sp >= 4096) break;
      stack[sp++] = suffix[c];
      c = prefix[c];
    }
    firstChar = c;
    stack[sp++] = firstChar;

    while (sp > 0 && op < pixelCount) out[op++] = stack[--sp];

    if (avail < 4096) {
      prefix[avail] = old;
      suffix[avail] = firstChar;
      avail++;
      if (avail === (1 << codeSize) && codeSize < 12) codeSize++;
    }

    old = code;
  }

  return out;
}

/**
 * 行交错（interlace）重排：GIF 的 4-pass 交错。
 * 返回按行顺序排列的索引数组。
 */
export function deinterlace(indices, width, height) {
  const out = new Uint8Array(indices.length);
  const passes = [
    [0, 8], [4, 8], [2, 4], [1, 2],
  ];
  let src = 0;
  for (const [start, step] of passes) {
    for (let y = start; y < height; y += step) {
      out.set(indices.subarray(src * width, src * width + width), y * width);
      src++;
    }
  }
  return out;
}
