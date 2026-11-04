# FRAMEAUD

给动画 GIF 携带音频，并在浏览器里做到**时间轴可控**的有声播放。

一个可运行的端到端原型 + 一套以**合成器输出为真值**的同步测量工具。

> ⚠️ **先读这个**：本方向已有大量公开现有技术。容器层被 Habr 2012、audiogif 2019、
> gifed 2023 草案、SoundGIF 2026 层层覆盖。**不要据此申请专利而不做正式检索**。
> 详见 [`docs/01-prior-art.md`](docs/01-prior-art.md)。

---

## 它解决什么

把音频写进 GIF 的 Application Extension 早有人做。真正的问题是：

**浏览器不允许 JS 知道当前显示的是第几帧。**

本仓库实测确认：`drawImage()` 和 `createImageBitmap()` 对动画 GIF **都只返回首帧**，
而屏幕上确实在动。这不是精度问题，是信息根本不可得。

**而且这不是 GIF 独有的。** 同一段动画导出成 APNG、动画 WebP，在 Chromium 下结果完全一致：

| 格式 | 屏幕上在动 | `drawImage` 能读到几个不同帧 |
|---|---|---|
| GIF | 是 | 1 |
| APNG | 是 | 1 |
| 动画 WebP | 是 | 1 |

这是**动画图像这一整类载体**的共性：浏览器只渲染，不暴露状态。

因此「让音频去追原生 `<img>` 播放器」这条路对所有这些格式都走不通。可行的架构只有一种：
**自己渲染，自己拥有时钟**。代价是放弃 `<img>` 原生渲染；收益是同步可以做到可测量、可补偿、可切入。

---

## 实测结果

测试环境：Windows 11 / HeadlessChrome 151 / 合成素材（40 帧，延迟不均匀）。

### 原生播放器 + 延迟模型（B1）

| 指标 | Chromium 151 | Firefox 153 |
|---|---|---|
| 实测周期 | 3999.95 ms | 3998.33 ms |
| **周期标准差** | **0.25 ms** | **13.12 ms** |
| 帧级错配率（锚定 `img.onload`） | 10.0% | **14.0%** |
| P95 绝对误差 | 110 ms | 110 ms |
| 最大绝对误差 | 140 ms | 140 ms |
| 同上，但给予 oracle 相位 | 0 ms | **4% 错配 / 140 ms** |

Chromium 的原生播放器**很准**，误差主要来自相位不可观测。
**Firefox 更抖**：周期标准差是 Chromium 的 50 倍，而且即使给 oracle 相位，
仍有 4% 的帧错配——误差还来自播放器自身的抖动与丢帧，这对 JS 同样不可观测、不可补偿。

**结论：「用 delay 模型追原生播放器」不可移植。**

### 帧锚定自绘（本方案）

| 指标 | 无补偿 | 补偿 27 ms |
|---|---|---|
| 帧切换滞后 平均 | 26.02 ms | **4.43 ms** |
| 帧切换滞后 最大 | 32.82 ms | 27.56 ms |
| 热切入偏移是否落在当前帧窗口 | **是** | 是 |

### 负面结果（如实记录）

元素 `display:none` 隐藏 2 秒后恢复，原生播放仅落后 **7.52 ms**。
Chromium 不会因此暂停动画。**「切后台必然失步」在本实验中没有得到支持。**

---

## 快速开始

```bash
npm run assets    # 生成测试素材并注入音频
npm test          # 32 项自检
npm run serve     # 起静态服务
```

然后打开：

- `http://localhost:8080/` —— 演示页（左：原生 `<img>`；右：JS 解码器）
- `http://localhost:8080/web/lab.html` —— 交互式实验台

测量（需要 `playwright`，全局或本地均可）：

```bash
node tools/measure-native.js chromium 16000      # 原生播放器时序
node tools/measure-player.js chromium 14000 27   # 自绘播放器（补偿 27ms）
```

---

## 结构

```
src/
  protocol.js      FRAMEAUD 扩展块：构建 / 解析 / 校验 / 锚点反演
  gif-parse.js     GIF89a 结构解析、扩展提取、trailer 前插入
  gif-lzw.js       LZW 解码 + 隔行重排
  gif-encode.js    GIF 编码 + LZW 编码（生成可控测试素材用）
  node/
    make-assets.js 生成 demo.gif / demo.wav / demo-audio.gif
web/
  player.js        浏览器侧同步解码器（自绘 + Web Audio）
  index.html       演示页
  lab.html         交互式实验台
  player-probe.html 自动化测量用页面
tools/
  serve.js         静态服务器
  measure-native.js 实验 A：原生播放器
  measure-player.js 实验 B：自绘播放器
  png-decode.js    截图 PNG 解码（读帧号条码）
test/
  run.js           32 项自检
docs/
  01-prior-art.md   现有技术对比报告
  02-technical-report.md 技术可行性与实测
  03-patent-claims.md    权利要求素材（含风险标注）
  04-paper-plan.md       论文大纲与实验计划
  05-strategy.md         能不能发论文/申专利，以及往哪发散
```

---

## 协议

```
0x21 0xFF 0x0B
"FRAMEAUD"     8 字节 App Identifier
"0.1"          3 字节 Auth Code
[0x01][JSON]   MANIFEST（可跨子块）
[0x02][bytes]  AUDIO（可跨子块）
0x00
```

`manifest.anchors` 把帧号与音频时间轴显式绑定：

```json
{ "frameCount": 40, "timescale": 1000, "cycleTicks": 4000,
  "anchors": [ { "frame": 0, "time": 0 }, { "frame": 1, "time": 80 }, ... ],
  "audio": { "container": "wav", "sampleRate": 44100, "byteLength": 352844 } }
```

`verifyManifest()` 交叉校验帧数、周期、音频长度；任一不符即判定映射失效并静音降级。

---

## 已知限制

单浏览器、无头模式、合成素材、无感知实验。完整清单见
[`docs/02-technical-report.md`](docs/02-technical-report.md) §7。

## 许可

原型代码用于研究与开发记录。使用前请自行确认第三方格式（audiogif / SoundGIF / gifed）
的许可条款。
