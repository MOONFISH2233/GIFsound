/**
 * playwright 装在了全局（npm root -g），但 ESM 的裸导入只查本地 node_modules。
 * 这里先试本地，失败再退到全局路径。
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let cached = null;

export async function loadPlaywright() {
  if (cached) return cached;

  let mod;
  try {
    mod = await import('playwright');
  } catch {
    // 本地没有，退到全局安装
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const entry = path.join(globalRoot, 'playwright', 'index.js');
    mod = await import(pathToFileURL(entry).href);
  }

  // playwright 是 CJS 包：按路径动态导入时，具名导出不一定被静态分析出来，
  // 真身通常挂在 default 上。
  cached = (mod.chromium ? mod : mod.default) ?? mod;
  return cached;
}
