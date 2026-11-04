# 现有技术对比报告

> 检索日期：2026-11-04
> **本文非法律意见**，仅为技术层面的检索与比对，正式结论须由专利代理师出具。
> 凡标注「未能核实」的条目，表示检索路径受限或仅有单一来源，不应作为决策依据。

---

## 0. 结论摘要（先看这段）

> ### ⚠ 重要更正（第二轮检索后）
>
> 本报告初稿曾判断「文件内帧-音频锚定映射」是本项目唯一未被覆盖的新颖点。
> **这个判断过于乐观，现已修正。**
>
> 第二轮检索发现两项此前遗漏的现有技术：
>
> - **gifed `audio-extension.md` 草案（2023-01-25）** —— 用 Application Extension
>   （`GENNYBLE` / `AUD`），定义了 **ACE（Audio Control Extension，放在图像前）** 与
>   **ADT（Audio Data Block，放在图像后）**，以「从第一帧起的百分之一秒」为固定时基，
>   **由 GIF 流驱动播放**。这正是「音频块与帧关联、映射写进文件」的设计。
> - **Habr 文章《Анимированный GIF со звуком》（推断 2012）** —— 用 Application Extension
>   （identifier `RIFFWAVE`）写入 WAV，并配套基于 jsgif 的**浏览器播放器**，在 Firefox/Chrome 演示。
>
> ⚠ 两者所在域名（`git.dreamy.place`、`habr.com`）在本环境被网络策略拦截，
> **未能直接核验原文**，上述描述来自检索层摘录。按保守原则，应视同已存在的现有技术处理。
>
> **结论变化**：只写「Application Extension + 帧锚定音频块」已不足以支撑新颖性，
> 因为 gifed 2023 草案已经公开了该数据结构。可争辩的空间收窄到
> **浏览器侧的具体同步机制**（呈现延迟补偿、热切入精确定位、协议失效检测），
> 且创造性风险显著上升（见 §5）。

原任务说明书中作为立项前提的三条判断，有两条**不成立**：

| 原有判断 | 检索结论 |
|---|---|
| 「帧时序绑定 + 浏览器侧同步解码」尚无先例，是本项目创新空间 | **基本不成立**。容器层被 Habr 2012、audiogif 2019、gifed 2023、SoundGIF 2026 层层覆盖；「帧锚定映射」被 gifed 2023 草案覆盖；「单时钟循环同步」被 SoundGIF 2026 覆盖 |
| CN105261054A 可能已驳回 | **成立**。申请人努比亚技术有限公司，2019-06-28「发明专利申请公布后的驳回」 |
| Nokia 有专利涉及「GIF Application Extension 中包含 audio signal」 | **不成立**。US20150242321 是缓存可靠性专利，与 GIF 无关；Nokia 实际的相近专利是 US20150234464（触觉输出）、US20160086633（上下文选音）、EP2711929（节拍对齐），**三件均已放弃/撤回**，且权项落点都不是帧-音频时序绑定 |

另有一处事实错误需更正：**MNG 不支持音频**。MNG 官方主页明确写着「没有认真预期它会整合音频或视频」。OggMNG 是把 MNG 放进 Ogg 容器、由 Ogg 承载音轨，不是 MNG 自身的音频能力。

**对项目的直接影响**：专利不能押在「GIF 装音频」「浏览器 JS 同步播放」「帧锚定映射表」任何单独一层上。
必须收窄到**具体同步机制的组合**，并且要有心理准备：本方向可能不足以支撑一件独立授权专利。

---

## 1. 三条路线的核验

### 1.1 像素域隐写路线

**Djaziri-Larbi, Zaien, Sevestre-Ghalila, "Voicing of animated GIF by data hiding", Multimedia Tools and Applications, 2016, 75(8): 4559–4575, DOI: 10.1007/s11042-015-2491-y**

- 原理：在亮度域把音频比特嵌入 GIF 各帧像素，提取端可盲提取
- **不解决帧-音频同步**：论文的诉求是「让专用播放器同时放音频和动画」，没有定义帧与音频的时间映射
- **依赖专用播放器**：普通浏览器打开是无声的
- 与 FRAMEAUD 的差异：技术层（像素域 vs 容器扩展）、目标（隐蔽/嵌入 vs 有声播放）、是否解决同步、是否依赖外部播放器，四项全部不同

> 检索限制：该文献的完整原文未取到，上述判断基于摘要与二次引用，**标注为部分核实**。

### 1.2 文件尾部追加 / 自建容器路线

| 公开号 | 标题 | 申请人 | 公开日 | 法律状态 | 方案 | 帧-音频时序绑定 |
|---|---|---|---|---|---|---|
| **CN105261054A** | 一种合成有声GIF图片的装置和方法 | 努比亚技术有限公司 | 2016-01-20 | **已驳回**（2019-06-28，申请公布后的驳回） | 获取 GIF 数据 + GIF 长度 + 音频，写入同一文件并加「有声 GIF」标志位，打包封装 | **无**。整段音频 + 布尔标志，无帧索引、无时间戳 |
| CN102819851A | 一种有声图片的计算机实现方法 | 成都思珩网络科技 | 2012-12-12 | 未能核实 | 字节数组依次写文件头、图片标识、图像数据、音频有效性标识、音频数据 | **无**。结构与 CN105261054A 同构且更早 |

要点：**驳回不影响其公开文本构成现有技术**。CN105261054A 依然是「GIF + 音频同文件封装」的对比文件。

### 1.3 Application Extension 封装路线

#### Habr《Анимированный GIF со звуком》（推断 2012）⚠ 原文未能核验

- 用 GIF89a Application Extension，identifier **`RIFFWAVE`**
- 音频块插在**第一帧图像之前**，放整段 WAV
- 配套一个基于 **jsgif 的浏览器播放器**，据称在 Firefox / Chrome 演示过
- **没有逐帧锚定**，同步只是「同时开始」
- 来源：`habr.com/en/articles/151203/`（本环境被拦，描述来自检索层摘录）

> 若该文确为 2012 年，则它比 audiogif 早 6 年公开了「Application Extension 装 WAV + 浏览器 JS 播放器」。
> **这是本方案兼容性主张的最早威胁。**

#### gifed `audio-extension.md` 草案（2023-01-25，commit 2106c47）⚠ 原文未能核验

- Application Extension：`GENNYBLE`（8 字节）+ `AUD`（3 字节）
- 定义两种块：
  - **ACE（Audio Control Extension）**：放在图像描述符**之前**
  - **ADT（Audio Data Block）**：放在图像**之后**
- 时基：「从第一帧起的百分之一秒」（centiseconds since first frame），**由 GIF 流驱动播放**
- 约束：音频不得延长 GIF 总时长
- 状态：Rust crate 仓库中的**草案**，无已知播放器实现
- 来源：`git.dreamy.place/multimedia/gifed/...`（本环境被拦）

> **这是最致命的现有技术。** 它明确把音频块与帧在文件内关联，并定义了固定时基。
> 我方案中的 `anchors` 字段在功能上与 ACE/ADT 的帧关联等价。
> 区别仅在于：gifed 草案**没有实现**，也没有规定浏览器侧如何同步。

#### audiogif（2018 创建，规范 v0.1 于 2019-05-16）

- 仓库：`github.com/RancidBacon/audiogif`（12 stars，最后一次推送 2019-06-07）
- 结构（已核验，与 GIF89a 规范一致）：

```
0x21 0xFF 0x0B
"AUDIOGIF"      (8 字节 App Identifier)
"0.1"           (3 字节 Auth Code)
0x01 0x01       (元数据子块：长度 1，格式字节=01「由播放器自行探测」)
[len][data]...  (N 个音频数据子块，每块 ≤255 字节)
0x00
```

- **没有 manifest、没有帧索引、没有时间戳、没有 CRC、没有长度字段**
- 参考播放器（gifuct-js 的 `add-audio-gif-support` 分支）的做法：音频在第 0 帧时 `start()`，之后**把音频总时长平均摊给各帧**。源码注释原文承认：

  > "the way this is currently implemented means that all supplied per-frame delay values are ignored except for the final frame"
  > "TODO: Double check this calculation is correct and/or handle variable per-frame delay values."

- **这正好证明了空白点**：同步是播放器临时算的，不是文件定义的。换播放器或换帧率，结果就不同。

#### SoundGIF（2026-07-23，`github.com/Superwheat/soundGIF`，2 stars）

- Identifier `SNDGIF01` + auth `001`，payload magic `SGA1`
- 字段比 audiogif 完整得多：playback flags、`start_ms`、字节长度、**CRC-32**、MIME、原文件名、Opus/AAC 音频
- 同步实现：解析各帧 GCE 的 delay 求和得总时长；**每 250ms 校正一次 `audio.currentTime`，偏差超 80ms 强制 seek**；每个 GIF 周期重启音频
- **仍然没有帧-音频映射表**：只有全局 `start_ms` 和总时长

> **这是最危险的现有技术**。它已经覆盖了「容器 + 浏览器 JS + 单时钟 + 循环同步 + 完整性校验」这一整层，而且时间非常新（2026-07）。

### 1.4 相关但不同方向的专利

| 公开号 | 申请人 | 法律状态 | 方案 | 为什么不是障碍 |
|---|---|---|---|---|
| US20150234464A1 | Nokia Technologies | 已放弃 | GIF + metadata（含音频/触觉信号），由**触摸位置/方向/速度/力度**触发反馈 | 触发条件是触摸事件，不是帧索引/帧时序；音频在 GIF 外部（独立 mp3 + HTML map） |
| US20160086633A1 | Nokia Technologies | 已放弃 | 依据**上下文/传感器**（湿度、温度、位置、光照）选择音频与动画关联 | 选音依据是环境上下文，与帧时序无关 |
| EP2711929A1 | Nokia Technologies | 已撤回（2016-05-16） | 从视频生成动画帧，按**节拍**调整帧时间戳/帧率/复制删帧，使动画与音频同步 | 发生在**制作阶段**，输出已对齐的动画；文件内没有可解析的映射表 |
| JP2008524920A | 未能核实 | 未能核实 | **利用 GIF89a Application Extension 承载照明控制命令，并与显示帧同步** | **架构高度同构**（扩展块 + 帧同步载荷），只是载荷是 LED 命令。这是把「载荷换成音频」认定为显而易见的风险来源 |
| CN110505511B | 海南车智易通 | **已授权**（2022-03-18） | 服务端抽帧得 JPG 序列 + MP3；浏览器侧用「当前帧索引 / 总帧数 × 音频总时长」算音频偏移 | **最强的功能性对比文献**：帧索引→音频时间的换算 + 浏览器侧执行，但它**运行时算**，不是文件内预置；载体也不是 GIF |
| CN116320574A | 未能核实 | 未能核实 | 音频按帧数切分成片段 + 送达时间戳；播放时选与当前音频片段邻近的动画帧 | 片段是播放时临时切分的，不写入文件 |
| CN104125492B | 快播科技 | 已授权 | 解析 GIF 内容字段中「增设的播放信息」，据此播放视频 | 塞的是播放控制信息，不是音频；无帧映射。但**证明「往 GIF 内容字段塞自定义数据」有先例** |

---

## 2. 标准与浏览器厂商：确认无原生方案

| 提案/标准 | 是否带音频 | 状态 |
|---|---|---|
| Animated WebP（`ANIM`/`ANMF`） | **否**。容器规范全文 `audio`/`sound` 出现 0 次 | 稳定 |
| APNG（`acTL`/`fcTL`/`fdAT`） | **否**。PNG 第三版（2025-06-24）无音频块 | 正式标准 |
| MNG | **否**。官方明确「没有认真预期它会整合音频或视频」 | 2001 定稿，无主流浏览器 |
| W3C / WHATWG 提案 | **未检索到**任何「动画图像 + 音频」的工作项 | 相邻议题只有「让 `<img>` 更像视频」（whatwg/html#11554 等） |
| 浏览器厂商立场 | **未检索到** | Chrome Platform Status / Firefox / WebKit 均无 |

行业侧也有直白结论：ezgif 帮助页（2026-03 更新）称 GIF「does not - and will not - support sound in any capacity」。

---

## 3. 浏览器兼容性：源码级核验

三家引擎对**未知** Application Extension 的处理都是「跳过并继续解码」，不会中断：

| 引擎 | 源码 | 行为 |
|---|---|---|
| Firefox（Gecko） | `image/decoders/nsGIFDecoder2.cpp` | 只识别 `NETSCAPE2.0` / `ANIMEXTS1.0`，其余 `SKIP_SUB_BLOCKS` |
| WebKit（Safari） | `Source/WebCore/platform/image-decoders/gif/GIFImageReader.cpp` | 未知 ID → `GIFConsumeBlock` |
| Chromium | Blink → Skia `SkWuffsCodec` → Wuffs `decode_gif.wuffs` | 只识别 `ANIMEXTS1.0`/`NETSCAPE2.0`/`ICCRGBG1012`/`XMPDATAXMP`，其余 `skip_blocks` |

**共同前提**：Application Extension 的 header 长度必须是 **11 字节**（`0x0B`），否则连被识别的机会都没有。

本仓库已实测确认（见 `docs/02-technical-report.md`）：注入 345KB 音频扩展后，
`<img>` 正常显示并动画，尺寸/帧数/时长与注入前一致。

**但 `<img>` 不会把扩展内容暴露给 JS**——必须 `fetch()` 整个文件自行解析。

### 扩展被剥离的风险

| 工具 | 默认行为 | 备注 |
|---|---|---|
| gifsicle | **保留** | `--no-extensions` / `--no-app-extensions` 会显式删除 |
| ImageMagick | **保留并回写**（把 11 字节 ID 存成 `gif:` profile） | 少见的例外；`-strip` 会移除 |
| ezgif 等在线工具 | **未知** | 无文档承诺；metadata remover 会清理元数据；其「GIF sound」走的是转 MP4 路线 |
| 社交平台 / 图床 | **大概率丢失** | 普遍重新编码 |

SoundGIF 的 README 自己也警告过这一点。

---

## 4. 对比表（核心）

| 方案 | 载体 | 音频位置 | 帧-音频映射 | 浏览器可播 | 同步机制 | 状态 |
|---|---|---|---|---|---|---|
| Habr 2012 ⚠未核验 | GIF App Extension | 整段 WAV（`RIFFWAVE`） | 无 | **是**（jsgif 播放器） | 同时开始 | 博客/开源 |
| **gifed 2023 草案** ⚠未核验 | GIF App Extension | **ACE/ADT 分块** | **有**（百分之一秒时基，块放图像前后） | 规范层，无实现 | 规范层：GIF 流驱动 | **草案** |
| Djaziri-Larbi 2016 | GIF 像素 | 亮度域隐写 | 无 | 否（无声） | 专用播放器同时启动 | 论文 |
| CN105261054A | 自建外层容器 | 整段 | 无 | 否 | 无 | **驳回** |
| audiogif 2019 | GIF App Extension | 整段 WAV | **无** | 需 JS | 播放器平均摊帧 | 停滞 |
| SoundGIF 2026 | GIF App Extension | Opus/AAC + CRC | **无**（仅全局 start_ms） | 需 JS | 单时钟 + 250ms 校正 | 极新 |
| CN110505511B | JPG 序列 + MP3 | 外部 | 运行时按比例换算 | 是 | 帧索引→音频偏移 | **已授权** |
| JP2008524920A | GIF App Extension | LED 命令 | 载荷与帧同步 | 是（被忽略） | 帧同步 | 未能核实 |
| **FRAMEAUD** | GIF App Extension | 分块 + manifest | **文件内显式锚点表** | 需 JS | 自绘渲染器 + 单时钟 | 本原型 |

---

## 5. 新颖性 / 创造性风险评估

> **非法律意见。**

**新颖性：高风险（修订后）。**

初稿认为「没有单篇文献同时公开 (a)+(b)+(c)」。纳入 gifed 2023 草案后，这个判断不再安全：

| 要素 | 谁已公开 |
|---|---|
| (a) 扩展块内音频 | Habr 2012（`RIFFWAVE`）、audiogif 2019（`AUDIOGIF`）、SoundGIF 2026（`SNDGIF01`） |
| (b) 文件内帧关联的音频块 | **gifed 2023 草案（ACE/ADT + 百分之一秒时基）** |
| (c) 浏览器 JS 按此调度 | Habr 2012（jsgif 播放器）、SoundGIF 2026（单时钟 + 校正） |
| (c') 浏览器侧按映射表精确调度 | 未检索到单篇；但 CN110505511B 已公开「帧索引→音频偏移」的功能性构思 |

「(a)+(b)」在 gifed 2023 中已成对出现；「(a)+(c)」在 Habr 2012 和 SoundGIF 中已成对出现。
把 (b) 和 (c) 组合起来的动机，在审查员看来相当直接。

剩下的可争辩点只有 (c') 中的**具体机制**：
- 呈现延迟预测与提前取帧（本项目实测有效，见技术报告 §3.5）
- 热切入时按已知时间轴精确计算音频偏移（§3.6）
- manifest 结构校验失败时的可检测降级

这些是**工程细节层面**的特征，能否支撑独立权利要求，风险很高。

**创造性：中等偏高（中国实践下更偏高）。** 不利因素按危险度排序：

1. **audiogif（2019）已公开 (a)** —— 「音频进 GIF 扩展块」不再是创新点
2. **CN110505511B（已授权）已公开「帧索引→音频时间」的完整换算，且明确在浏览器侧执行** —— 功能性构思已被占
3. **JP2008524920A 已公开「GIF 扩展块载荷与显示帧同步」的架构** —— 把载荷从照明命令换成音频，容易被认定为等效替换
4. **CN116320574A 已公开「音频按帧切分 + 时间戳邻近匹配」**
5. **SoundGIF（2026-07）已公开「单时钟 + 每周期重启 + 定期校正」的工程实现**

**修正后的可争辩落点**：既然「映射表写进文件」已被 gifed 2023 草案占位，
唯一还剩空间的是**映射失效的可检测性 + 呈现延迟补偿**这一组合：

- 结构校验（帧数/周期/音频长度三者交叉验证）失败即判定协议失效并降级——
  现有文献都是「假设映射永远有效」，没有处理重编码后帧数变化的情形
- 按呈现延迟预测提前取帧——现有文献的播放器都是「按当前时刻取帧」

这两点都是**具体的工程手段**，不是架构层创新。能否授权取决于审查员对「常规技术手段」的认定。

若权项落在「浏览器 JS 调度」——创造性弱，属成熟通用技术。
若权项落在「扩展块装音频」或「帧锚定映射」单独——**必然被 Habr 2012 / gifed 2023 破坏新颖性**。

**其他风险**：

- **客体风险（中国）**：纯「数据格式/信息编排」可能触发《专利法》第 25 条。须绑定具体技术问题（GIF 无法携带音频导致音画不同步）与具体技术手段（扩展块字节布局、解码器状态机），并以方法+装置+存储介质三套权项布局
- **审查档案**：CN105261054A 的驳回理由未取到。若其驳回涉及客体或创造性，是同方向的强预警
- **FTO**：CN110505511B 与 CN108616768B（腾讯，有效至 2038）权项较上位，实施阶段需做权项比对

---

## 6. 未检索到的方向（这本身是结论）

以下方向经多轮中英文组合检索**未命中任何文献**，但「未检索到」不等于「不存在」：

1. 专利中「GIF Application Extension 写入音频数据」——Google Patents 命中的 App Extension 用途只有 NETSCAPE2.0 循环、XMP、ICC、ZTEALPHA、LED 照明、C2PA manifest
2. 「多个音频块 + 每块显式关联帧索引/时序映射」的专利
3. 「浏览器 JS 解析 GIF 内映射表并据此调度音频」的专利
4. 任何「有声 GIF / GIF 配音」的中国**授权**专利

---

## 7. 来源索引

- CN105261054A: `patents.google.com/patent/CN105261054A/zh`（直连受限，经检索层读取）
- audiogif: `github.com/RancidBacon/audiogif`；播放器 `github.com/RancidBacon/gifuct-js`（分支 `add-audio-gif-support`）
- SoundGIF: `github.com/Superwheat/soundGIF`
- Nokia US20150234464A1 / US20160086633A1 / EP2711929A1: Google Patents
- CN110505511A/B、CN116320574A、CN108616768B、CN104125492B: Google Patents
- JP2008524920A: Google Patents（**未能核实**法律状态）
- Firefox: `hg.mozilla.org/mozilla-central/file/tip/image/decoders/nsGIFDecoder2.cpp`
- WebKit: `github.com/WebKit/WebKit/.../GIFImageReader.cpp`
- Wuffs: `github.com/google/wuffs/blob/main/std/gif/decode_gif.wuffs`
- gifsicle 手册: `lcdf.org/gifsicle/man.html`
- WebP 容器规范: `github.com/webmproject/libwebp/blob/main/doc/webp-container-spec.txt`
- PNG 3rd Edition: `w3.org/TR/png-3/`
- MNG 官方: `libpng.com/pub/mng/index.html`
- ezgif 帮助: `ezgif.org/help/gif-sound`
- Djaziri-Larbi 2016: DOI `10.1007/s11042-015-2491-y`
