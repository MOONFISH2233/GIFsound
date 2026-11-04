/**
 * 浏览器侧帧锚定同步播放器。
 *
 * 关键设计：**播放器自己拥有渲染时钟**。
 *   - 用自研 LZW 解码 + canvas 合成，逐帧显示；
 *   - 视觉与音频由同一个时间轴驱动；
 *   - 音频通过 getOutputTimestamp() 桥接到 performance 时基，
 *     使「音频听到的时刻」与「画面显示的时刻」共用一把尺子。
 *
 * 对照模式（用于实验）：
 *   mode: 'canvas'   —— 本方案 (P)
 *   mode: 'native'   —— 原生 <img> 播放，JS 只在旁边算「应该是第几帧」(B0/B1)
 */

import { parseGif } from '../src/gif-parse.js';
import { lzwDecode, deinterlace } from '../src/gif-lzw.js';
import { parseAudioExtension, makeTimeToFrame, verifyManifest } from '../src/protocol.js';

/* ------------------------------------------------------------------ */
/* GIF → 可绘制的帧位图                                                 */
/* ------------------------------------------------------------------ */

export async function decodeGif(bytes) {
  const g = parseGif(bytes);
  const W = g.width;
  const H = g.height;
  const ct0 = g.globalColorTable;
  if (!ct0 && !g.frames.every(f => f.colorTable)) {
    throw new Error('GIF 缺少调色板');
  }

  let base = new Uint8ClampedArray(W * H * 4);
  const frames = [];

  for (const f of g.frames) {
    const palette = f.colorTable || ct0;
    const saved = f.gce.disposal === 3 ? new Uint8ClampedArray(base) : null;

    let idx = lzwDecode(f.minCodeSize, f.lzwData, f.width * f.height);
    if (f.interlaced) idx = deinterlace(idx, f.width, f.height);

    const transparent = f.gce.transparent ? f.gce.transparentIndex : -1;

    for (let y = 0; y < f.height; y++) {
      const dy = f.top + y;
      if (dy < 0 || dy >= H) continue;
      const srcRow = y * f.width;
      const dstRow = dy * W;
      for (let x = 0; x < f.width; x++) {
        const dx = f.left + x;
        if (dx < 0 || dx >= W) continue;
        const ci = idx[srcRow + x];
        if (ci === transparent) continue;
        const p = (dstRow + dx) * 4;
        base[p] = palette[ci * 3];
        base[p + 1] = palette[ci * 3 + 1];
        base[p + 2] = palette[ci * 3 + 2];
        base[p + 3] = 255;
      }
    }

    const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(base), W, H));
    frames.push({ bitmap, delayMs: f.gce.delayCs * 10 });

    if (f.gce.disposal === 2) {
      for (let y = f.top; y < Math.min(f.top + f.height, H); y++) {
        for (let x = f.left; x < Math.min(f.left + f.width, W); x++) {
          const p = (y * W + x) * 4;
          base[p] = base[p + 1] = base[p + 2] = base[p + 3] = 0;
        }
      }
    } else if (f.gce.disposal === 3 && saved) {
      base = saved;
    }
  }

  return { width: W, height: H, frames, gif: g };
}

/* ------------------------------------------------------------------ */
/* 播放器                                                              */
/* ------------------------------------------------------------------ */

export class FrameAudPlayer {
  /**
   * @param {HTMLCanvasElement} canvas   canvas 模式下的绘制目标
   * @param {object} opt
   * @param {'canvas'|'native'} [opt.mode]
   * @param {HTMLImageElement} [opt.img] native 模式下由页面提供的 <img>
   * @param {number} [opt.leadMs]        音频调度提前量
   */
  constructor(canvas, opt = {}) {
    this.canvas = canvas;
    this.ctx2d = canvas?.getContext('2d', { alpha: true }) || null;
    this.mode = opt.mode || 'canvas';
    this.img = opt.img || null;
    this.leadMs = opt.leadMs ?? 60;
    /**
     * 合成器呈现延迟补偿（毫秒）。
     * 帧是在第 T 帧的 rAF 里绘制的，但用户要等到 T+呈现延迟才看到，
     * 而音频是按时间轴准点听到的。因此画面天然落后音频约一个刷新周期。
     * 把取帧位置前移这么多，就能让「看到的帧」对上「听到的时刻」。
     */
    this.predictMs = opt.predictMs ?? 0;

    this.audioCtx = null;
    this.buffer = null;
    this.gain = null;
    this.sources = [];

    this.decoded = null;
    this.manifest = null;
    this.frameAt = null;
    this.cycleMs = 0;
    this.frameStarts = null;

    this.t0 = 0;             // 时间轴起点（performance 时基）
    this.playing = false;
    this.pausedPosMs = 0;
    this.lastFrame = -1;
    this.rafId = 0;

    this.scheduledCycle = -1;
    this.audioUnlocked = false;

    /** 供实验页读取 */
    this.stats = {
      frameChanges: 0,
      lastFrameChangePerf: 0,
      lastFrameDurationMs: 0,
      audioStartPerf: 0,
      audioOffsetMs: 0,
      schedulingErrorMs: 0,
      clockSource: 'perf',
    };

    this._onFrame = null;
    this._loop = this._loop.bind(this);
  }

  onFrame(cb) { this._onFrame = cb; }

  /* ---------------------------- 载入 ---------------------------- */

  async load(url) {
    const resp = await fetch(url, { cache: 'force-cache' });
    if (!resp.ok) throw new Error(`加载失败 ${resp.status}: ${url}`);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    return this.loadFromBytes(bytes);
  }

  async loadFromBytes(bytes) {
    this.bytes = bytes;
    this.decoded = await decodeGif(bytes);

    if (this.canvas && this.mode === 'canvas') {
      this.canvas.width = this.decoded.width;
      this.canvas.height = this.decoded.height;
    }

    const ext = parseAudioExtension(this.decoded.gif.extensions);
    if (ext && ext.ok) {
      this.manifest = ext.manifest;
      this.audioBytes = ext.audioBytes;
    } else {
      this.manifest = null;
      this.audioBytes = null;
      this.audioError = ext ? ext.reason : '未找到 FRAMEAUD 扩展';
    }

    // 时间轴以 manifest 为准；缺失则退回 GIF 自身的 GCE 延迟
    const delays = this.manifest ? this.manifest.frames : this.decoded.frames.map(f => f.delayMs);
    this.frameStarts = [];
    let t = 0;
    for (const d of delays) { this.frameStarts.push(t); t += d; }
    this.cycleMs = t;

    if (this.manifest) {
      const mismatch = this.manifest.frames.length !== this.decoded.frames.length;
      if (mismatch) {
        this.audioError = `manifest 帧数(${this.manifest.frames.length}) 与文件帧数(${this.decoded.frames.length}) 不一致，已降级`;
        this.manifest = null;
      }
      const v = this.manifest ? verifyManifest(this.manifest, this.audioBytes.length) : { ok: false };
      if (!v.ok) { this.audioError = v.reason; this.manifest = null; }
    }
    this.frameAt = makeTimeToFrame(
      this.manifest ? this.manifest.anchors : this.frameStarts.map((s, i) => ({ frame: i, time: s })),
      this.cycleMs,
    );

    return this;
  }

  /* ---------------------------- 时钟 ---------------------------- */

  /**
   * 音频时钟 → performance 时基的映射。
   * getOutputTimestamp 告诉我们「此刻正被听到的是哪个 contextTime」，
   * 因此它对输出延迟已经做了补偿。
   */
  _audioTimeAtPerfSec(perfMs) {
    const ts = this.audioCtx.getOutputTimestamp?.();
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
      return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    }
    // 退路：假定 contextTime 与 performance 同速，用当前差值近似
    return this.audioCtx.currentTime + (perfMs - performance.now()) / 1000;
  }

  /**
   * 当前时间轴位置（毫秒）。
   *
   * 主时钟固定用 performance.now()，音频作为**从属**被挂到这条时间轴上。
   *
   * 为什么不反过来把 AudioContext 当主时钟：getOutputTimestamp() 的
   * (contextTime, performanceTime) 二元组在部分环境（例如无音频输出设备的
   * 无头浏览器）会与 performance 时基产生数百毫秒的偏差，一旦拿它当主时钟，
   * 整条时间轴就会跳变。主时钟用单调的 performance.now()，再用
   * getOutputTimestamp() 把「要播的音频时刻」映射成 contextTime 去调度，
   * 音频仍然是采样级精确的；并且每个周期重新锚定，误差不会跨周期累积。
   */
  _timelineNowMs() {
    this.stats.clockSource = this.audioUnlocked ? 'perf→audio' : 'perf';
    return performance.now() - this.t0;
  }

  positionMs() {
    const p = this._timelineNowMs();
    return ((p % this.cycleMs) + this.cycleMs) % this.cycleMs;
  }

  /**
   * 给定一个 epoch 毫秒（Date.now 时基），换算成周期内位置。
   * 供实验脚本把「合成器截图的时刻」对到播放器时间轴上。
   */
  positionAtEpochMs(epochMs) {
    const perfMs = epochMs - performance.timeOrigin;
    return ((perfMs - this.t0) % this.cycleMs + this.cycleMs) % this.cycleMs;
  }


  currentFrame() {
    return this.frameAt(this.positionMs());
  }

  /* ---------------------------- 音频 ---------------------------- */

  /** 必须在用户手势中调用 */
  async unlockAudio() {
    if (this.audioCtx) {
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
      return this.audioCtx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('浏览器不支持 Web Audio API');
    this.audioCtx = new AC({ latencyHint: 'interactive' });
    await this.audioCtx.resume();

    this.gain = this.audioCtx.createGain();
    this.gain.connect(this.audioCtx.destination);

    if (this.audioBytes) {
      // decodeAudioData 会 detach 传入的 buffer，必须给副本
      const copy = this.audioBytes.slice().buffer;
      this.buffer = await this.audioCtx.decodeAudioData(copy);
    }
    this.audioUnlocked = true;

    if (this.playing) {
      this._hotJoin();
    }
    return this.audioCtx;
  }

  /** 从当前播放位置热切入音频：位置已知，因此不需要"猜"帧 */
  _hotJoin() {
    this._stopSources();
    const nowPerf = performance.now();
    const posMs = this.positionMs();
    const whenNow = this._audioTimeAtPerfSec(nowPerf);
    const startAt = Math.max(this.audioCtx.currentTime, whenNow) + 0.005;
    this._startSource(startAt, posMs / 1000, null);

    this.stats.audioStartPerf = nowPerf;
    this.stats.audioOffsetMs = posMs;
    this.stats.schedulingErrorMs = (startAt - whenNow) * 1000;
  }

  /**
   * @param {number} when   contextTime 起播时刻
   * @param {number} offset 从音频的哪一秒开始
   * @param {number|null} duration
   */
  _startSource(when, offset, duration) {
    if (!this.buffer) return;
    const src = this.audioCtx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    const dur = duration ?? Math.max(0, Math.min(this.buffer.duration - offset, this.cycleMs / 1000));
    if (dur <= 0.001) return;
    src.start(when, offset, dur);
    src.onended = () => {
      const i = this.sources.indexOf(src);
      if (i >= 0) this.sources.splice(i, 1);
    };
    this.sources.push(src);
  }

  _stopSources() {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* already stopped */ }
    }
    this.sources = [];
  }

  /**
   * 每个播放周期单独锚定一次音频。
   * 好处：即使音频总长与动画周期不严格相等，误差也不会跨周期累积。
   */
  _ensureScheduled(posMs) {
    if (!this.buffer || !this.audioUnlocked) return;
    const cycleIndex = Math.floor((this._timelineNowMs()) / this.cycleMs);
    if (cycleIndex <= this.scheduledCycle) return;

    const cycleStartPerf = this.t0 + cycleIndex * this.cycleMs;
    const when = this._audioTimeAtPerfSec(cycleStartPerf);
    const nowCtx = this.audioCtx.currentTime;

    if (when >= nowCtx + 0.005) {
      // 本周期还没开始 → 精确调度到周期起点
      this._startSource(when, 0, this.cycleMs / 1000);
      this.stats.schedulingErrorMs = 0;
    } else if (this.playing) {
      // 已经进入本周期（例如刚解锁）→ 从当前位置切入
      const elapsed = this.audioCtx.currentTime - when;
      if (elapsed < this.cycleMs / 1000) {
        this._startSource(nowCtx + 0.005, elapsed, (this.cycleMs / 1000) - elapsed);
      }
    }
    this.scheduledCycle = cycleIndex;
  }

  /* ---------------------------- 播放 ---------------------------- */

  async play() {
    if (this.playing) return;
    this.playing = true;
    this.t0 = performance.now() - this.pausedPosMs;
    this.scheduledCycle = -1;
    this.lastFrame = -1;
    if (this.audioUnlocked) this._hotJoin();
    this.rafId = requestAnimationFrame(this._loop);
  }

  pause() {
    if (!this.playing) return;
    this.pausedPosMs = this.positionMs();
    this.playing = false;
    cancelAnimationFrame(this.rafId);
    this._stopSources();
  }

  seek(ms) {
    this.pausedPosMs = ((ms % this.cycleMs) + this.cycleMs) % this.cycleMs;
    if (this.playing) {
      this.t0 = performance.now() - this.pausedPosMs;
      this.scheduledCycle = -1;
      this._hotJoin();
    }
  }

  _loop() {
    if (!this.playing) return;
    const pos = this.positionMs();

    if (this.mode === 'canvas') {
      // 取帧位置前移，补偿合成器呈现延迟
      const drawPos = pos + this.predictMs;
      const f = this.frameAt(drawPos);
      if (f !== this.lastFrame) {
        const perfNow = performance.now();
        this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx2d.drawImage(this.decoded.frames[f].bitmap, 0, 0);
        this.lastFrame = f;
        this.stats.frameChanges++;
        this.stats.lastFrameDurationMs = this.stats.lastFrameChangePerf
          ? perfNow - this.stats.lastFrameChangePerf : 0;
        this.stats.lastFrameChangePerf = perfNow;
        if (this._onFrame) this._onFrame(f, pos, perfNow);
      }
    }

    this._ensureScheduled(pos);
    this.rafId = requestAnimationFrame(this._loop);
  }

  /** 仅供实验：按「delay 累积模型」估算的帧号 */
  estimateFrameByDelay(posMs) {
    return this.frameAt(posMs);
  }

  setVolume(v) {
    if (this.gain) this.gain.gain.value = v;
  }
}
