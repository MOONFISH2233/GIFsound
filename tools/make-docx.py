# -*- coding: utf-8 -*-
"""
从论文草稿生成 .docx。
运行：python tools/make-docx.py
输出：docs/FRAMEAUD-paper-draft.docx
"""

from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'docs', 'FRAMEAUD-paper-draft.docx')

doc = Document()

# ---------- 页面与基础样式 ----------
sec = doc.sections[0]
sec.page_width = Cm(21.0)
sec.page_height = Cm(29.7)
sec.top_margin = Cm(2.5)
sec.bottom_margin = Cm(2.5)
sec.left_margin = Cm(2.8)
sec.right_margin = Cm(2.8)

normal = doc.styles['Normal']
normal.font.name = 'Times New Roman'
normal.font.size = Pt(11)
normal._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
normal.paragraph_format.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
normal.paragraph_format.space_after = Pt(4)


def _set_font(run, ascii_font='Times New Roman', east='宋体', size=None, bold=None,
              color=None, italic=None):
    run.font.name = ascii_font
    run._element.rPr.rFonts.set(qn('w:eastAsia'), east)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if italic is not None:
        run.font.italic = italic
    if color is not None:
        run.font.color.rgb = RGBColor(*color)


def title(text, size=18):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run(text)
    _set_font(r, size=size, bold=True, east='黑体')


def subtitle(text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(text)
    _set_font(r, size=9, color=(0x70, 0x70, 0x70))


def h1(text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run(text)
    _set_font(r, size=14, bold=True, east='黑体')


def h2(text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(text)
    _set_font(r, size=12, bold=True, east='黑体')


def para(text, indent=True, size=11, italic=False, color=None):
    p = doc.add_paragraph()
    if indent:
        p.paragraph_format.first_line_indent = Pt(22)
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    r = p.add_run(text)
    _set_font(r, size=size, italic=italic, color=color)
    return p


def bullet(text):
    p = doc.add_paragraph(style='List Bullet')
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(text)
    _set_font(r, size=11)


def note(text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Pt(18)
    r = p.add_run(text)
    _set_font(r, size=9.5, italic=True, color=(0x60, 0x60, 0x60))


def caption(text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(text)
    _set_font(r, size=9, bold=True)


def add_table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = ''
        p = hdr[i].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(h)
        _set_font(r, size=9, bold=True, east='黑体')
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ''
            p = cells[i].paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER if i > 0 else WD_ALIGN_PARAGRAPH.LEFT
            r = p.add_run(str(v))
            _set_font(r, size=9)
    if widths:
        for i, w in enumerate(widths):
            for row in t.rows:
                row.cells[i].width = Cm(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


# ============================== 正文 ==============================

title('动画图像的帧可观测性：\n一项跨引擎测量研究及其对音画同步的制约')
subtitle('Unspecified Frame Observability in Animated Images:\nA Cross-Engine Measurement Study and Its Consequences for Audio-Visual Synchronization')
subtitle('草稿 v0.1 · 2026-11-04 · 中文稿（投稿需译为英文）')

h1('摘要')
para('动画图像（GIF、APNG、动画 WebP）是唯一没有标准化「播放状态」概念的主流运动图像格式。'
     '本文在三个浏览器引擎、三种格式上测量了一个网页能否判断动画图像当前显示的是哪一帧。'
     '结果是：规范未定义，实现分裂——drawImage() 在三个引擎中都返回首帧，'
     'createImageBitmap() 在 Chromium 与 Firefox 中返回首帧、在 WebKit 中返回当前帧。'
     '同一页面中，<video> 提供 currentTime 与 requestVideoFrameCallback，'
     'CSS 动画提供 getAnimations()[0].currentTime，说明这是 API 空白而非渲染限制。'
     '我们进一步量化了该空白对音画同步的代价：以 img.onload 为唯一可得锚点时，'
     '延迟累积模型的帧级错配率中位数为 9.0%（Chromium，n=12）与 12.0%（Firefox，n=10），'
     '单轮最大误差 110–140 ms；即使给定 oracle 相位，Firefox 仍有 2.5% 的残差，'
     '说明误差还来自播放器自身的抖动。最后我们评估了一种「自己拥有渲染时钟」的自绘替代方案，'
     '其帧切换滞后为 26.0 ms、经呈现延迟补偿后降至 4.4 ms，并实现了精确的中途切入。'
     '文献调研显示同一现象在 Web 之外同样存在：iOS UIKit 的公开模型无法表达逐帧时长，'
     'Android 遵守逐帧时长却不暴露当前帧，只有 macOS AppKit 两者兼备。'
     '我们据此认为：可移植的确定性音画同步要求渲染方拥有渲染时钟。',
     indent=True)
p = doc.add_paragraph()
p.paragraph_format.first_line_indent = Pt(22)
r = p.add_run('关键词：')
_set_font(r, size=11, bold=True)
r = p.add_run('动画 GIF；帧可观测性；音画同步；Web API；浏览器一致性')
_set_font(r, size=11)

h1('Abstract')
para('Animated images (GIF, APNG, animated WebP) are the only widely distributed moving-image '
     'format with no standardized notion of playback state. This paper measures, across three '
     'browser engines and three formats, whether a web page can determine which frame of an '
     'animated image is currently displayed. We find the behavior is specified nowhere and '
     'implemented inconsistently: drawImage() returns the first frame in all three engines, '
     'while createImageBitmap() returns the first frame in Chromium and Firefox but the current '
     'frame in WebKit. In the same page, <video> exposes currentTime and '
     'requestVideoFrameCallback, and CSS animations expose currentTime — evidence that the '
     'limitation is an API gap, not a rendering limitation. We then quantify the cost of this '
     'gap for audio-visual synchronization: with the only anchor a page can obtain (img.onload), '
     'a delay-accumulation model mispredicts 9.0% / 12.0% of frames (median; Chromium n=12, '
     'Firefox n=10), with single-run maximum errors of 110–140 ms, while an oracle phase still '
     'leaves 2.5% residual error in Firefox. Finally, we evaluate a self-rendered alternative '
     'that owns the clock, achieving a switch latency of 26.0 ms (compensable to 4.4 ms) and '
     'exact mid-stream audio join. A literature survey shows the same fragmentation off the Web. '
     'We conclude that portable, deterministic A/V synchronization over animated images requires '
     'the renderer to own the render clock.', indent=True)

h1('1  引言')

h2('1.1  问题')
para('在网页上让动画图像「有声音且对得上」，看起来只需要把音频放进文件里。'
     '但如果音频要在任意时刻切入，就必须知道画面此刻在第几帧。')
para('浏览器的自动播放策略决定了这一点无法回避：带声音的媒体必须由用户手势启动，'
     '而动画图像从页面加载起就一直在播。因此「音频与动画同时开始」在真实场景中并不成立，'
     '所有实现都必须进行中途切入（hot join）。中途切入需要知道当前播放位置——'
     '本文的第一个问题就是：这个位置，网页拿得到吗？')

h2('1.2  贡献')
bullet('跨引擎、跨格式的可观测性测量。首次系统地说明：这不是「谁都读不到」，'
       '而是规范未定义、引擎分裂。')
bullet('同页面对照实验。<video> 与 CSS 动画都能读到播放位置，证明渲染管线做得到，缺的是 API。')
bullet('不可观测性的代价量化。以真实可得的锚点计算，帧错配率中位数 9.0% / 12.0%；'
       '即使给出 oracle 相位，Firefox 仍有 2.5% 残差。')
bullet('一个可行但需付出代价的替代架构。自绘渲染 + 单一时间轴，切换延迟 26.0 ms，'
       '可补偿到 4.4 ms，中途切入精确。')
bullet('分发链路的实测。ffmpeg 往返会保留逐帧延迟，但会丢弃自定义扩展块。')

h2('1.3  本文不声称什么')
bullet('不声称「首次给 GIF 加音频」——Habr 2012、audiogif 2019 已有公开实现。')
bullet('不声称「首次提出帧—音频映射」——gifed 2023 草案已有类似结构。')
bullet('不声称「切后台必然失步」——实测不支持该假设（见 §4.5）。')

h1('2  背景与相关工作')

h2('2.1  GIF89a 的扩展机制')
para('GIF89a 的 Application Extension（0x21 0xFF，11 字节标识符，子块链，0x00 终止）'
     '允许第三方携带任意数据。三家引擎对未知标识符的处理都是「跳过并继续解码」'
     '（Firefox nsGIFDecoder2.cpp、WebKit GIFImageReader.cpp、Chromium 经 Skia/Wuffs），'
     '因此注入扩展不会破坏图像显示。本仓库实测：注入 345 KB 音频扩展后，'
     '<img> 正常加载并动画，ffmpeg 交叉验证 40 帧 / 4.000 s 无差错。')

h2('2.2  已有路线')
add_table(
    ['路线', '代表', '载体', '帧—音频映射'],
    [
        ['像素域隐写', 'Djaziri-Larbi 等 2016', '帧像素亮度', '无'],
        ['自建容器', 'CN105261054A（已驳回）', '外层文件', '无'],
        ['扩展块', 'Habr 2012 / audiogif 2019 / SoundGIF 2026', 'Application Extension', '无'],
        ['扩展块 + 帧关联', 'gifed 2023 草案（未实现）', 'Application Extension', '有'],
        ['运行时换算', 'CN110505511B（已授权）', 'JPG 序列 + 外部音频', '播放时按比例算'],
    ],
    widths=[3.2, 6.0, 4.2, 2.6])
note('核验状态：Habr 2012 与 gifed 2023 草案所在域名在检索时被网络策略拦截，'
     '两条描述来自检索层摘录，未直接核验原文。定稿前必须补验。')
para('本文的问题与前人不同：不问「音频能不能装进去」，'
     '而问「装进去之后，播放端能不能确定性地对齐」。')

h2('2.3  规范现状')
para('WebP 容器规范中 audio / sound 出现 0 次；APNG（PNG 第三版，2025）只有 acTL/fcTL/fdAT，'
     '无音频块；MNG 官方明确表示不打算整合音频。未检索到任何 W3C / WHATWG 关于'
     '「动画图像 + 音频」的工作项。')

h1('3  帧可观测性实验')

h2('3.1  方法')
para('测试素材为 40 帧动画，每帧底部编码一条 12 位条码（黑/白方块）表示帧号。'
     '真值来自合成器输出：Chromium 用 CDP Page.startScreencast 获取带时间戳的合成器帧，'
     '其余引擎用元素截图。从截图中读出条码，即可知道此刻屏幕上真实显示的是第几帧。'
     '对同一素材测试两种 JS 读取方式：ctx.drawImage(img, 0, 0) 与 await createImageBitmap(img)。')

h2('3.2  结果')
add_table(
    ['引擎', 'drawImage', 'createImageBitmap'],
    [
        ['Chromium 151', '[0,0,0,0,0,0,0]', '[0,0,0,0,0,0,0]'],
        ['Firefox 153', '[0,0,0,0,0,0,0]', '[0,0,0,0,0,0,0]'],
        ['WebKit', '[0,0,0,0,0,0,0]', '[23,25,27,29,31,33,35]'],
    ],
    widths=[3.5, 5.0, 6.5])
caption('表 1  三种引擎下两种读取方式的实际取值（7 次采样，间隔 180 ms）')
para('WebKit 的取值单调递增且与动画同步推进，确认是当前帧而非噪声。'
     'GIF / APNG / 动画 WebP 三种格式的结果完全一致。')

h2('3.3  解释')
para('结论不是「无法观测」，而是：动画图像的帧可观测性在规范中没有定义，'
     '导致引擎实现分裂，网页无法编写可移植的同步代码。')
para('这对工程的含义尤其糟糕：失败是静默的。createImageBitmap 在 Chromium/Firefox 上'
     '不报错，只是永远返回首帧。开发者若不做能力探测，会在 WebKit 上测试通过、'
     '在其他引擎上悄悄错位。')

h2('3.4  对照实验')
add_table(
    ['媒体', '读取方式', '不同取值数'],
    [
        ['<video>', 'currentTime', '6 / 6'],
        ['CSS 动画', 'getAnimations()[0].currentTime', '6 / 6'],
        ['动画图像 <img>', '无规格化 API', '0（Chromium/Firefox）/ 7（WebKit 偶发）'],
    ],
    widths=[3.5, 7.0, 4.5])
caption('表 2  同一页面内三种会动的媒体对 JS 的状态暴露程度')
para('<video> 还有 requestVideoFrameCallback，可精确到「这一帧何时被呈现」。'
     '渲染管线完全做得到，动画图像这条路径没有提供 API。')

h1('4  不可观测性的代价')

h2('4.1  基线定义')
para('B1（延迟累积模型）：以 img.onload 为锚点，按 GIF 各帧 delay 累加推算当前帧。'
     '这是页面在不能观测帧的情况下唯一能做的事。'
     'B1-oracle：遍历整个周期寻找误差最小的锚点，现实中拿不到，仅作理论上限。')

h2('4.2  结果')
para('单次测量的波动很大（同一配置下不同轮次的错配率在 0%–12% 之间），'
     '因此报告 N 次独立加载的分布，而非单次结果。每轮使用全新浏览器上下文与 cache-bust 的 URL。')
add_table(
    ['指标', 'Chromium 151（n=12）', 'Firefox 153（n=10）'],
    [
        ['帧错配率 中位数', '9.0%', '12.0%'],
        ['错配率 四分位距', '7% – 11%', '9% – 13%'],
        ['平均绝对误差 中位数', '7.50 ms', '11.10 ms'],
        ['img.onload 相位偏移 中位数', '33.17 ms', '23.00 ms'],
        ['B1-oracle 错配率 中位数', '0%', '2.5%'],
        ['单轮最大绝对误差', '110 ms', '140 ms'],
        ['实测周期（长跑）', '3999.67 ms', '3998.33 ms'],
        ['周期标准差', '0.78 ms', '13.12 ms'],
    ],
    widths=[7.0, 4.5, 4.5])
caption('表 3  B1 基线的误差分布与播放器稳定性')

h2('4.3  两条结论')
bullet('原生播放器的稳定性因引擎而异：周期标准差相差约 17 倍（0.78 vs 13.12 ms）。'
       '延迟模型在一个引擎上可行，换一个就失效——不可移植。')
bullet('即使给 oracle 相位，Firefox 仍有 2–4% 的残差。误差不只来自相位未知，'
       '还来自播放器自身的抖动与丢帧，而这对 JS 同样不可观测。')

h2('4.4  感知阈值')
para('音画不同步的可感知阈值通常引用 ITU-R BT.1359（音频滞后约 125 ms、超前约 45 ms）。'
     '本文观测到的单轮最大误差 110–140 ms 已进入可感知区间。')
note('本文未做主观感知实验，以上阈值为文献引用，非本文实测。')

h2('4.5  一个被证伪的假设')
para('计划中曾假设「元素不可见会导致原生播放器暂停、与音频失步」。'
     '实测（display:none 隐藏 2 秒后恢复）：恢复瞬间的落后量仅 7.52 ms，'
     '隐藏前误差 4.65 ms、恢复后 5.12 ms。Chromium 并未因此暂停动画。'
     '本文如实报告这一负面结果，不将其作为论据。')

h1('5  自绘替代方案')

h2('5.1  架构')
para('放弃 <img> 原生渲染，改为：fetch() 整个文件 → 解析 GIF 结构 → 自研 LZW 解码 → '
     '逐帧合成位图；以 performance.now() 为唯一主时钟，画面与音频都由它驱动；'
     '音频通过 getOutputTimestamp() 映射成 contextTime 调度，每个周期重新锚定。')
para('主时钟选择上有一个实践教训：曾用 AudioContext 作为主时钟，在无音频输出设备的环境里 '
     'getOutputTimestamp() 返回的 (contextTime, performanceTime) 与 performance 时基'
     '存在约 700 ms 偏差，导致整条时间轴跳变。改为「performance 为主、音频为从」后问题消失。')

h2('5.2  结果')
add_table(
    ['指标', '无补偿', '补偿 27 ms'],
    [
        ['帧切换滞后 平均', '26.02 ms', '4.43 ms'],
        ['帧切换滞后 最大', '32.82 ms', '27.56 ms'],
        ['中途切入偏移落在当前帧窗口', '是', '是'],
    ],
    widths=[7.0, 4.5, 4.5])
caption('表 4  自绘播放器的切换延迟与补偿效果')
para('26 ms 的来源：帧在第 T 个 rAF 回调里绘制，用户到 T + 呈现延迟才看到，'
     '而音频按时间轴准点播放。画面天然落后音频约一个刷新周期。'
     '把取帧位置前移即可补偿。本文使用固定 27 ms。')
note('自适应估计（统计最近 N 次切换的时刻）尚在计划中。')

h2('5.3  中途切入')
para('场景：页面加载后无声自播 1.3 秒，用户点击解锁音频。'
     '实测音频切入偏移 1601.2 ms，当前帧窗口 [1600, 1680) ms，精确落位；'
     '调度误差 5.1 ms（即主动预留的提前量）。'
     '因为播放器自己拥有时间轴，切入位置是算出来的。这是自绘架构唯一能做、'
     '而追原生播放器做不到的事。')

h1('6  分发鲁棒性')
para('自定义扩展在常见工具链中是否幸存，直接决定方案能否落地。实测（ffmpeg 6.x）：')
add_table(
    ['处理', '帧数', '周期', '逐帧延迟', 'FRAMEAUD 扩展'],
    [
        ['原始', '40', '4000 ms', '80,100,120,60,…', '存在'],
        ['ffmpeg -f gif 重编码', '40', '4000 ms', '完全一致', '被剥离'],
        ['缩放 120×90 + 重新量化', '40', '4000 ms', '完全一致', '被剥离'],
    ],
    widths=[5.0, 2.2, 2.8, 4.5, 3.5])
caption('表 5  重新编码后延迟与扩展块的命运')
para('两点值得注意：逐帧延迟在重编码中幸存，因为它存在于容器结构中而不在像素里；'
     '自定义扩展不幸存，因为 ffmpeg 的 GIF 复用器不认识它。'
     '同时图像数据被重新编码得不降反升（26 KB → 364 KB），'
     '说明通用编码器并不为体积优化。')

h1('7  跨平台考察（文献调研，非实测）')
note('本节全部来自官方文档与源码，未在真机上验证。')
para('浏览器不是唯一的播放环境。我们调研了移动端与桌面端的公开 API，'
     '发现同一现象以不同形态出现：')
add_table(
    ['环境', '能否知道「现在第几帧」', '是否遵守逐帧时长'],
    [
        ['Chromium / Firefox', '否', '是'],
        ['WebKit', 'createImageBitmap 可读（未定义行为）', '是'],
        ['iOS UIKit', '否', '否（模型只有「帧数组 + 单一总时长」）'],
        ['macOS AppKit', '只读属性键 currentFrame', '是'],
        ['Android framework', '否（仅 start/end 回调）', '是'],
    ],
    widths=[4.5, 7.0, 5.5])
caption('表 6  四个平台的动画图像播放语义')
para('三点观察：')
bullet('iOS UIKit 的公开模型无法表达逐帧时长。UIImage 只有 images 与一个 duration；'
       'UIImageView.animationDuration 是整轮动画的总时长，默认「帧数 × 1/30 秒」。'
       '第三方库 FLAnimatedImage 把「Honors variable frame delays」列为核心卖点，'
       '反向印证了原生路径不支持可变帧延迟。')
bullet('macOS AppKit 相反：NSImageView.animates 的文档明确写着按图像数据中存储的 timing '
       '播放，且 NSBitmapImageRep 提供 currentFrame 只读属性键。'
       '同一个 Apple 的两个平台给出了不同答案。')
bullet('Android 遵守时序但读不到位置：Skia 的 GIF reader 将 GCE delay 解析为 delay × 10 ms '
       '并驱动 AnimatedImageDrawable；但后者只暴露 onAnimationStart / onAnimationEnd，'
       '没有当前帧索引、seek 或逐帧回调。')
para('这组事实支持一个更强的判断：动画图像缺少的不是某个实现的某个功能，'
     '而是一份明确的播放语义契约。四个平台给出四种模型，'
     '说明这个契约从来没有被写下过。')
note('限定：Apple 文档未逐字说明 UIKit 会「平均分配」逐帧 delay，'
     '该结论由公开 API 的形状推得。')

h1('8  讨论')

h2('8.1  何时该用哪种架构')
add_table(
    ['需求', '建议'],
    [
        ['只要「有声音」，接受固定起始相位', '原生 <img> + 扩展块，成本最低'],
        ['需要中途切入后音画对齐', '必须自绘'],
        ['需要跨引擎可移植', '必须自绘'],
        ['只是展示，不需要精确同步', '原生 <img>'],
    ],
    widths=[10.0, 7.0])
caption('表 7  架构选型')

h2('8.2  代价')
para('自绘意味着放弃原生解码器的一切优化（内存、流式解码、硬件加速），'
     '并且需要 fetch 整个文件。对大尺寸、高帧率素材不现实。')

h2('8.3  对标准的建议')
para('若要让这一方向可移植，最小改动是在 HTML 规范中为「动画图像」定义类似 '
     'HTMLMediaElement.currentTime 的只读属性，或让 createImageBitmap 的行为规范化。'
     '本文的对照实验说明这不是技术障碍。')

h1('9  局限')
bullet('浏览器版本单一：Chromium 151、Firefox 153、Playwright WebKit（Windows 自编译版）。'
       '「WebKit 如此」不等于「Safari 如此」。')
bullet('WebKit 时序数据不可靠：只能截图轮询，采样间隔 117 ms，16 s 内仅观测到 37/40 帧，'
       '周期未能测出。其错配率可能来自采样方法。')
bullet('合成素材：条码帧不是自然内容。')
bullet('无感知实验：45 ms / 125 ms 阈值引自文献。')
bullet('B1 的对比条件偏向它：测试页只有一个 <img>，img.onload 几乎就是动画起点；'
       '真实页面会更差，但本文未测。')
bullet('跨平台部分（§7）完全是文献/源码调研，没有真机实测。')
bullet('扩展剥离只测了 ffmpeg；gifsicle 与 ImageMagick 的行为来自文档与源码，未实测。')

h1('10  结论')
para('动画图像的帧可观测性是一处规范空白，且已经造成了引擎间的实际分裂。'
     '其后果不是「同步做得不够准」，而是「同步无法在不知道当前帧的前提下成立」。'
     '在可观测性被规范化之前，需要确定性同步的应用只能自己拥有渲染时钟；'
     '本文给出并测量了这样一条路径的精度边界与代价。')

h1('附录：数据与复现')
para('全部实验脚本位于仓库 tools/ 目录，原始数据位于 results/，'
     '自检脚本 test/run.js 含 32 项断言。'
     '复现命令：node src/node/make-assets.js && node test/run.js && '
     'node tools/measure-trials.js chromium 12 8000。', indent=True)

doc.save(OUT)
print('written:', os.path.abspath(OUT))
print('size:', os.path.getsize(OUT), 'bytes')
