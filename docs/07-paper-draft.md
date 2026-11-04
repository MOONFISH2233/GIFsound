# 论文草稿

> **说明**：中文稿，便于修改；投稿需翻译成英文。
> 英文题目与摘要已给出。标 `【待补】` 的地方是还没做的实验，不要当作已有结论。
> 所有数字可追溯到 `results/*.json`。

---

**Title**

*Unspecified Frame Observability in Animated Images: A Cross-Engine Measurement Study and Its Consequences for Audio-Visual Synchronization*

**Abstract (EN draft)**

Animated images (GIF, APNG, animated WebP) are the only widely distributed
moving-image format with no standardized notion of playback state. This paper
measures, across three browser engines and three formats, whether a web page can
determine which frame of an animated image is currently displayed. We find the
behavior is **specified nowhere and implemented inconsistently**: `drawImage()`
returns the first frame in all three engines, `createImageBitmap()` returns the
first frame in Chromium and Firefox but the *current* frame in WebKit. In the
same page, `<video>` exposes `currentTime` and `requestVideoFrameCallback`, and
CSS animations expose `currentTime` — evidence that the limitation is an API
gap, not a rendering limitation. We then quantify the cost of this gap for
audio-visual synchronization: with the only anchor a page can obtain
(`img.onload`), a delay-accumulation model mispredicts 10.0% / 14.0% of frames
(Chromium/Firefox; P95 error 110 ms, max 140 ms), while an oracle phase yields
0% / 4%. Finally, we evaluate a self-rendered alternative that owns the clock,
achieving bounded switch latency (26.0 ms, compensable to 4.4 ms) and exact
mid-stream audio join. We conclude that portable, deterministic A/V
synchronization over animated images requires the page to own the render clock.

**中文摘要**

动画图像（GIF / APNG / 动画 WebP）是唯一没有标准化「播放状态」概念的主流运动图像格式。
本文在三个浏览器引擎、三种格式上测量了一个网页能否判断动画图像当前显示的是哪一帧。
结果是：**规范未定义，实现分裂**——`drawImage()` 三家都返回首帧，
`createImageBitmap()` 在 Chromium/Firefox 返回首帧、在 WebKit 返回**当前帧**。
同一页面中，`<video>` 有 `currentTime` 与 `requestVideoFrameCallback`，
CSS 动画有 `currentTime`，说明这是 API 空白而非渲染限制。
我们进一步量化了该空白对音画同步的代价，并评估了一种「自己拥有时钟」的自绘替代方案。

**关键词**：动画 GIF；帧可观测性；音画同步；Web API；浏览器一致性

---

## 1. 引言

### 1.1 问题

在网页上让动画图像「有声音且对得上」这件事，看起来只需要把音频放进文件里。
但如果音频要在**任意时刻切入**，就必须知道画面此刻在第几帧。

浏览器的自动播放策略决定了这一点无法回避：带声音的媒体必须由用户手势启动，
而动画图像从页面加载起就一直在播。所以「音频和动画同时开始」在真实场景中**不成立**，
所有实现都必须做**中途切入（hot join）**。

中途切入需要知道当前播放位置。本文的第一个问题就是：**这个位置，网页拿得到吗？**

### 1.2 贡献

1. **跨引擎、跨格式的可观测性测量**（§3）。首次系统地说明：
   这不是「谁都读不到」，而是**规范未定义、引擎分裂**。
2. **同页面对照实验**（§3.4）。`<video>` 与 CSS 动画都能读到播放位置，
   证明渲染管线做得到，缺的是 API。
3. **不可观测性的代价量化**（§4）。在真实可得的锚点下，延迟累积模型的
   帧级错配率为 10% / 14%（Chromium / Firefox），P95 误差 110 ms。
   **即使给出 oracle 相位，Firefox 仍有 4% 错配、最大 140 ms**——
   误差不只来自相位未知，还来自播放器自身的抖动。
4. **一个可行但需付出代价的替代架构**（§5）。自绘渲染 + 单一时间轴，
   切换延迟 26.0 ms，可补偿到 4.4 ms；中途切入精确。
5. **分发链路的实测**（§6）。ffmpeg 往返会**保留逐帧延迟**但**丢弃自定义扩展块**。

### 1.3 不声称什么

- 不声称「首次给 GIF 加音频」（Habr 2012、audiogif 2019 已有）
- 不声称「首次提出帧-音频映射」（gifed 2023 草案已有）
- 不声称「切后台必然失步」（实测不支持，见 §4.5）

---

## 2. 背景与相关工作

### 2.1 GIF89a 的扩展机制

GIF89a 的 Application Extension（`0x21 0xFF`，11 字节标识符，子块链，`0x00` 终止）
允许第三方携带任意数据。三家引擎对未知标识符的处理都是「跳过并继续解码」
（Firefox `nsGIFDecoder2.cpp`、WebKit `GIFImageReader.cpp`、Chromium 经 Skia/Wuffs），
因此注入扩展不会破坏图像显示。

本仓库实测：注入 345 KB 音频扩展后，`<img>` 正常加载并动画，ffmpeg 交叉验证
40 帧 / 4.000 s 无差错。

### 2.2 已有路线

| 路线 | 代表 | 载体 | 帧-音频映射 |
|---|---|---|---|
| 像素域隐写 | Djaziri-Larbi et al. 2016 | 帧像素亮度 | 无 |
| 自建容器 | CN105261054A（已驳回） | 外层文件 | 无 |
| 扩展块 | Habr 2012 / audiogif 2019 / SoundGIF 2026 | Application Extension | 无 |
| 扩展块 + 帧关联 | gifed 2023 草案（未实现） | Application Extension | 有 |
| 运行时换算 | CN110505511B（已授权） | JPG 序列 + 外部音频 | 播放时按比例算 |

> ⚠ **核验状态**：Habr 2012 与 gifed 2023 草案所在的域名在检索时被网络策略拦截，
> 两条描述来自检索层摘录，**未直接核验原文**。定稿前必须补验，否则不要写进正式稿。

**本文的问题与前人不同**：我们不问「音频能不能装进去」，
而问「装进去之后，播放端能不能确定性地对齐」。

### 2.3 规范现状

WebP 容器规范中 `audio` / `sound` 出现 0 次；APNG（PNG 第三版，2025）只有
`acTL` / `fcTL` / `fdAT`，无音频块；MNG 官方明确表示不打算整合音频。
未检索到任何 W3C / WHATWG 关于「动画图像 + 音频」的工作项。

---

## 3. 帧可观测性实验

### 3.1 方法

测试素材为 40 帧动画，每帧底部编码一条 12 位条码（黑/白方块）表示帧号。
真值来自**合成器输出**：Chromium 用 CDP `Page.startScreencast` 获取带时间戳的合成器帧，
其余引擎用元素截图。截图中读出条码即可知道「此刻屏幕上真实显示的是第几帧」。

对同一素材测试两种 JS 读取方式：
`ctx.drawImage(img, 0, 0)` 与 `await createImageBitmap(img)`。

### 3.2 结果

| 引擎 | `drawImage` | `createImageBitmap` |
|---|---|---|
| Chromium 151 | `[0,0,0,0,0,0,0]` | `[0,0,0,0,0,0,0]` |
| Firefox 153 | `[0,0,0,0,0,0,0]` | `[0,0,0,0,0,0,0]` |
| **WebKit** | `[0,0,0,0,0,0,0]` | **`[23,25,27,29,31,33,35]`** |

（7 次采样，间隔 180 ms；GIF / APNG / 动画 WebP 三种格式结果一致）

WebKit 的取值单调递增且与动画同步推进，确认是**当前帧**而非噪声。

### 3.3 解释

结论不是「无法观测」，而是：

> **动画图像的帧可观测性在规范中没有定义，导致引擎实现分裂，
> 网页无法编写可移植的同步代码。**

这对工程的含义尤其糟糕：失败是**静默的**。`createImageBitmap` 在 Chromium/Firefox 上
不报错，只是永远返回首帧。开发者若不做能力探测，会在 WebKit 上测试通过、
在其他引擎上悄悄错位。

### 3.4 对照实验

同一页面内放三种会动的媒体：

| 媒体 | 读取方式 | 不同取值数 |
|---|---|---|
| `<video>` | `currentTime` | 6 / 6 |
| CSS 动画 | `getAnimations()[0].currentTime` | 6 / 6 |
| 动画图像 `<img>` | 无规格化 API | 0（Chromium/Firefox）/ 7（WebKit 偶发） |

`<video>` 还有 `requestVideoFrameCallback`，可精确到「这一帧何时被呈现」。
**渲染管线完全做得到，动画图像这条路径没有提供 API。**

---

## 4. 不可观测性的代价

### 4.1 基线定义

**B1（延迟累积模型）**：以 `img.onload` 为锚点，按 GIF 各帧 delay 累加推算当前帧。
这是页面在不能观测帧的情况下唯一能做的事。

**B1-oracle**：遍历整个周期寻找误差最小的锚点。现实中拿不到，仅作理论上限。

### 4.2 结果

单次测量的波动很大（同一配置下不同轮次的错配率在 0%–12% 之间），
因此报告 N 次独立加载的分布，而非单次结果。每轮使用全新浏览器上下文与 cache-bust 的 URL。

| 指标 | Chromium 151（n=12） | Firefox 153（n=10） |
|---|---|---|
| 帧错配率 中位数 | **9.0%** | **12.0%** |
| 错配率 四分位距 | 7% – 11% | 9% – 13% |
| 平均绝对误差 中位数 | 7.50 ms | 11.10 ms |
| `img.onload` 相位偏移 中位数 | 33.17 ms | 23.00 ms |
| **B1-oracle 错配率 中位数** | **0%** | **2.5%** |
| 单轮最大绝对误差 | 110 ms | 140 ms |
| 实测周期（长跑） | 3999.67 ms | 3998.33 ms |
| **周期标准差** | **0.78 ms** | **13.12 ms** |

### 4.3 两条结论

1. **原生播放器的稳定性因引擎而异**：周期标准差相差约 17 倍（0.78 vs 13.12 ms）。
   延迟模型在一个引擎上可行，换一个就失效——**不可移植**。
2. **即使给 oracle 相位，Firefox 仍有 2–4% 的残差**。
   误差不只来自相位未知，还来自播放器自身的抖动与丢帧，而这对 JS 同样不可观测。

因此「用 delay 模型追原生播放器」不是精度不够，而是**根本不可控**。

### 4.4 感知阈值

音画不同步的可感知阈值通常引用 ITU-R BT.1359（音频滞后约 125 ms、超前约 45 ms）。
本文观测到的 P95 110 ms、最大 140 ms 已进入可感知区间。
**【待补】本文未做主观感知实验，以上阈值为文献引用，非本文实测。**

### 4.5 一个被证伪的假设

计划中曾假设「元素不可见会导致原生播放器暂停、与音频失步」。
实测（`display:none` 隐藏 2 秒后恢复）：恢复瞬间的落后量仅 **7.52 ms**，
隐藏前误差 4.65 ms、恢复后 5.12 ms。**Chromium 并未因此暂停动画。**
本文如实报告这一负面结果，不将其作为论据。

---

## 5. 自绘替代方案

### 5.1 架构

放弃 `<img>` 原生渲染，改为：

1. `fetch()` 整个文件 → 解析 GIF 结构 → 自研 LZW 解码 → 逐帧合成位图
2. 以 `performance.now()` 为**唯一主时钟**，画面与音频都由它驱动
3. 音频通过 `getOutputTimestamp()` 映射成 `contextTime` 调度，**每个周期重新锚定**

主时钟选择上有一个实践教训：曾用 `AudioContext` 作为主时钟，
在无音频输出设备的环境里 `getOutputTimestamp()` 返回的 `(contextTime, performanceTime)`
与 performance 时基存在约 700 ms 偏差，导致整条时间轴跳变。
改为「performance 为主、音频为从」后问题消失。

### 5.2 结果

| 指标 | 无补偿 | 补偿 27 ms |
|---|---|---|
| 帧切换滞后 平均 | 26.02 ms | **4.43 ms** |
| 帧切换滞后 最大 | 32.82 ms | 27.56 ms |
| 中途切入偏移落在当前帧窗口 | **是** | 是 |

26 ms 的来源：帧在第 T 个 rAF 回调里绘制，用户到 T+呈现延迟 才看到，
而音频按时间轴准点播放。**画面天然落后音频约一个刷新周期。**

把取帧位置前移即可补偿。这需要估计呈现延迟；本文使用固定 27 ms。
**【待补】自适应估计（统计最近 N 次切换的时刻）尚在计划中。**

### 5.3 中途切入

场景：页面加载后无声自播 1.3 s，用户点击解锁音频。
实测音频切入偏移 1601.2 ms，当前帧窗口 [1600, 1680) ms，**精确落位**；
调度误差 5.1 ms（即主动预留的提前量）。

因为播放器自己拥有时间轴，切入位置是**算出来的**。这是自绘架构唯一能做、
而追原生播放器做不到的事。

---

## 6. 分发鲁棒性

自定义扩展在常见工具链中是否幸存，直接决定方案能否落地。实测（ffmpeg 6.x）：

| 处理 | 帧数 | 周期 | 逐帧延迟 | FRAMEAUD 扩展 |
|---|---|---|---|---|
| 原始 | 40 | 4000 ms | 80,100,120,60,… | 存在 |
| `ffmpeg -f gif` 重编码 | 40 | 4000 ms | **完全一致** | **被剥离** |
| 缩放 120×90 + 重新量化 | 40 | 4000 ms | **完全一致** | **被剥离** |

两点值得注意：

1. **逐帧延迟在重编码中幸存**——因为它存在于容器结构中，不在像素里。
2. **自定义扩展不幸存**——ffmpeg 的 GIF 复用器不认识它。
   同时图像数据被重新编码得不降反升（26 KB → 364 KB），说明通用编码器并不为体积优化。

**【待补】** gifsicle（`-O3` / `--no-extensions`）、ImageMagick、社交平台转码的实测。

---

## 7. 讨论

### 7.1 何时该用哪种架构

| 需求 | 建议 |
|---|---|
| 只要「有声音」，接受固定起始相位 | 原生 `<img>` + 扩展块，成本最低 |
| 需要中途切入后音画对齐 | **必须自绘** |
| 需要跨引擎可移植 | **必须自绘** |
| 只是做展示，不需要精确同步 | 原生 `<img>` |

### 7.2 代价

自绘意味着放弃原生解码器的一切优化（内存、流式解码、硬件加速），
并且需要 `fetch` 整个文件。对大尺寸、高帧率素材不现实。

### 7.3 对标准的建议

若要让这一方向可移植，最小改动是在 HTML 规范中为「动画图像」定义类似
`HTMLMediaElement.currentTime` 的只读属性，或让 `createImageBitmap` 的行为规范化。
本文的对照实验说明这不是技术障碍。

---

## 8. 局限

1. **浏览器版本单一**：Chromium 151、Firefox 153、Playwright WebKit（Windows 自编译版）。
   **「WebKit 如此」不等于「Safari 如此」**。
2. **WebKit 时序数据不可靠**：只能截图轮询，采样间隔 117 ms，
   16 s 内仅观测到 37/40 帧，周期未能测出。其错配率可能来自采样方法。
3. **合成素材**：条码帧不是自然内容。
4. **无感知实验**：45 ms / 125 ms 阈值引自文献。
5. **B1 的对比条件偏向它**：测试页只有一个 `<img>`，`img.onload` 几乎就是动画起点；
   真实页面（字体、布局、冷缓存）会更差，但本文未测。
6. **未测移动端与桌面播放器**（见 `06-cross-platform.md`）。
7. **扩展剥离只测了 ffmpeg**。

---

## 9. 结论

动画图像的帧可观测性是一处规范空白，且已经造成了引擎间的实际分裂。
其后果不是「同步做得不够准」，而是「同步无法在不知道当前帧的前提下成立」。
在可观测性被规范化之前，需要确定性同步的应用只能自己拥有渲染时钟；
本文给出并测量了这样一条路径的精度边界与代价。

---

## 附：数据与复现

全部实验脚本在 `tools/`，原始数据在 `results/`，自检在 `test/run.js`（32 项）。
