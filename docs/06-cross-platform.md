# 非浏览器播放器：手机 / 桌面 / 命令行

> 检索日期 2026-11-04。**核心结论：动画图像的播放语义没有一个统一的平台契约，
> 浏览器之外同样如此，而且不同平台之间互相矛盾。**
>
> 标注「未找到权威来源」的条目，是检索没有拿到官方文档，**不要当成事实引用**。

---

## 0. 一句话结论

> **iOS 的 UIKit 连「逐帧时长」这个概念都表达不了；Android 遵守逐帧时长但没有读数接口；
> macOS 遵守且能读到当前帧；浏览器则三家分裂。**
> 四个平台，四种不同的模型。

这个结果比「浏览器不可观测」严重得多：它说明问题不是某个浏览器的实现缺陷，
而是**「动画图像」这个载体从来没有被赋予过明确的播放语义**。

---

## 1. 汇总表

| 平台 / 播放器 | 遵守逐帧 delay | 当前帧索引 / 回调 | App Extension 处理 | 来源 |
|---|---|---|---|---|
| **iOS `UIImageView`** | **否**（只有单一总时长） | **无** | 不适用（不解析扩展） | Apple 文档 |
| iOS ImageIO（自建播放器） | 是（`UnclampedDelayTime` 取原值） | 无（需自己维护） | 无公开 API | Apple 文档 |
| **macOS `NSImageView`** | **是**（官方明确「按数据内 timing」） | `currentFrame` 只读属性键 | 未找到任意扩展 API | Apple 文档 |
| **Android `AnimatedImageDrawable`** | **是**（Skia 读 `delay × 10ms`） | **无**（只有 start/end 回调） | 忽略；无回写 API | Android 文档 + Skia 源码 |
| Android `Movie`（API 28 废弃） | 未文档化；可 `setTime()` 手动驱动 | 无索引 getter | 忽略 | Android 文档 |
| Glide `GifDrawable` | 是 | `getFrameIndex()` | 未涉及 | Javadoc |
| Fresco `AnimatedDrawable2` | 是 | `onAnimationFrame(frameNumber)` | 未涉及 | Javadoc |
| FLAnimatedImage（iOS 库） | 是（README 明示） | `currentFrameIndex` | 未涉及 | 源码 |
| ffmpeg / ffprobe | 是（仅 0→100ms 兜底） | ffprobe 可列全部 pts；无实时回调 | **转码剥离未知扩展** | 源码 |
| ImageMagick | 是 | 无 | **默认保留**（`gif:` profile） | 源码 |
| gifsicle | 是 | 无 | **默认保留**；`--no-extensions` 删除 | 官方手册 |
| VLC | 是（动画 GIF 交给 avformat） | 无 | 忽略（走 FFmpeg） | 源码 |
| GIMP | 导出按层 delay | 无 | 未找到 | 官方文档（导出） |
| Photoshop | Timeline 逐帧 delay | 无 | 未找到 | Adobe 帮助 |
| Windows 照片 / iOS 相册 / Google Photos | **未找到权威说明** | 无 | 未找到 | — |

---

## 2. 三个值得写进论文的发现

### 2.1 iOS UIKit：模型里根本没有「逐帧时长」这个位置 ★★★

`UIImage` 的公开模型只有两样东西：

- `images`：组成动画的图像数组
- `duration`：**整个动画**的时间间隔

`UIImageView` 的 `animationDuration` 同样是「一个循环的总时长」，默认值为
「帧数 × 1/30 秒」。`UIImage.animatedImage(with:duration:)` 也只有一个 `duration` 参数，
Apple 明确说它和给 `animationImages` 赋值「yields the same results」。

**也就是说：GIF 的逐帧 delay 在这条路径上没有任何入口可以被表达。**

> 诚实的限定：Apple 文档**没有逐字写**「平均分配」。这是从公开 API 的形状
> （帧数组 + 单一总时长）推出的结论，不是 Apple 原话。论文里必须这样表述。

旁证：第三方库 FLAnimatedImage 把「Honors variable frame delays」
明确列为核心卖点，并把「Apps that don't support animated GIFs yet」作为目标用户——
说明 UIKit 原生路径确实处理不了可变帧延迟。

### 2.2 macOS AppKit：唯一一个「既遵守、又能读」的平台 ★★

`NSImageView.animates` 的文档原文：

> plays animated images automatically **using the timing and looping characteristics
> stored in the image data**

并且 `NSBitmapImageRep` 有 `currentFrame`（当前帧号，第一帧为 0）、
`currentFrameDuration`、`frameCount` 三个属性键。

**同一个 Apple，iOS 做不到、macOS 做得到。** 这是「平台契约不一致」最直接的证据，
而且不涉及任何浏览器。

> 限定：`currentFrame` 是只读属性键，不是逐帧回调；
> Apple 未说明它在 `NSImageView` 自动播放时如何实时刷新。

### 2.3 Android：遵守时序，但读不到位置 ★★

Skia 的 GIF reader 在解析 Graphic Control Extension 时执行
`setDelayTime(GETINT16(...) * 10)`，即毫秒；`AnimatedImageDrawable` 内部使用这个时长。
**Android framework 遵守逐帧 delay，而且没有浏览器那种「小于 2cs 就当 10cs」的钳制。**

但公开 API 只有 `start()` / `stop()` / `isRunning()` / `registerAnimationCallback()`，
而 `Animatable2.AnimationCallback` 只有 `onAnimationStart` 和 `onAnimationEnd`，
且文档明确写 `onAnimationEnd` 「除非出错否则永远不会被调用」。

**没有当前帧索引、没有 seek、没有逐帧回调。**
能力被第三方库补上了（Glide 的 `getFrameIndex()`、Fresco 的 `onAnimationFrame()`），
但这说明平台自己在「能解码」和「能用」之间留了一道缝。

---

## 3. 对浏览器结论的印证

本文在浏览器上的实测（Chromium / Firefox / WebKit 三家分裂）在这里得到了平行印证：

| 环境 | 能否知道「现在第几帧」 | 是否遵守逐帧时长 |
|---|---|---|
| Chromium / Firefox | **否** | 是 |
| WebKit | `createImageBitmap` 可读（未定义行为） | 是 |
| iOS UIKit | **否**（且模型无法表达逐帧时长） | **否** |
| macOS AppKit | 只读属性键 | 是 |
| Android framework | **否**（需第三方库） | 是 |

**「不可观测」和「不遵守」是两件事，但在同一类载体上同时出现——
这说明问题在「动画图像」这个格式契约本身，而不是某一个实现的疏忽。**

---

## 4. 分发链路

本文实测与本轮检索一致：

| 工具 | 未知 Application Extension |
|---|---|
| ffmpeg 转码 | **剥离**（源码：只识别 NETSCAPE，其余 `gif_skip_subblocks()`） |
| ImageMagick | **默认保留**（存为 `gif:<11字节>` profile，写出时回写） |
| gifsicle | **默认保留**；`--no-extensions` / `--no-app-extensions` 删除 |

另外一条：**Apple ImageIO 的 `kCGImagePropertyGIFDelayTime` 会把 delay 钳制到最低 100 ms**，
要拿原始值必须用 `kCGImagePropertyGIFUnclampedDelayTime`。
这意味着逐帧 delay 在 Apple 侧的读取路径上也可能被改写，取决于用哪个键。

---

## 5. 未找到权威来源（不要引用为事实）

1. Apple 没有任何文档逐字说明 `UIImageView` 会「平均分配」逐帧 delay——是 API 形状推出的
2. macOS Preview 是否播放动画 GIF、是否保留时序
3. 现代 QuickTime Player 的 GIF 逐帧时序（只有 QuickTime 3 时代的导入文档）
4. iOS 相册 / Android 相册 / Google Photos / Windows 11 照片播放 GIF 的逐帧时序
5. GIMP、Photoshop 导入 GIF 时是否保留逐帧 delay，以及扩展往返行为
6. Apple ImageIO / Android framework 对任意未知 Application Extension 的读取或回写（无公开 API）
7. Android 是否有类似浏览器的 delay clamp（未找到；Skia 的 setter 本身没有钳制）

---

## 6. 这对论文意味着什么

原计划写「浏览器里的测量研究」。现在可以扩成：

> **跨平台的动画图像播放语义调查：一个从未被定义的契约。**

好处：

1. 覆盖面从「Web」扩到「移动 + 桌面 + 命令行」，分量更足
2. 结论更难被反驳——不是一个引擎的行为，而是四个平台的系统性问题
3. 对标准化的建议更自然——不是「修 Chrome」，而是「定义动画图像的播放状态」

风险：

1. 需要更多一手验证（本文的跨平台部分完全是文献/源码调研，**没有实测**）
2. 审稿人会问「你在真机上验证过吗」

**建议**：跨平台部分作为「设计空间分析」写进去，明确标注为文献调研而非实测；
实测部分仍然聚焦浏览器。若要扩成完整跨平台论文，需要补 iOS/Android 真机实验。
