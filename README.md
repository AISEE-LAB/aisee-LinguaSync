# LinguaSync Pro v7 — AI 视频同声传译

Chrome 扩展，在任何视频网页上浮现 AI 同声传译悬浮窗。播放外语视频时自动识别语音、实时翻译为中文，字幕叠加在视频画面上。内置知识胶囊术语解释、实时思维导图、开小差补救、流式问答伴侣等智能辅助功能。

> **▶ 演示视频 (Demo)** — 完整功能演示（实时同传 · 知识胶囊 · 思维导图 · 开小差补救 · 流式问答）
>
> - [GitHub Release 下载](https://github.com/qq1906198507-ai/AIst/releases/download/v7.0.0/LinguaSync-Pro-v7-demo.mp4)
> - [百度网盘](https://pan.baidu.com/s/1LW3uPIpZml6NUkz-fMFdbA) 提取码: `2amw`

## 功能一览

**核心同传**

- **实时语音识别** — Web Speech API，支持英语、日语、韩语等 8 种语言
- **流式翻译** — 150ms 防抖 + 上下文增强（最近 3 句历史 + 屏幕术语），多层 API 降级（MyMemory → Google Translate）
- **标签页音频直采** — getDisplayMedia 捕获标签页音频 + 8dB 增益放大，不依赖麦克风外放
- **视频内嵌字幕** — 原文 + 译文叠加在视频底部，每句持续显示 15 秒，半透明背景不遮挡画面
- **TTS 语音朗读** — Web Speech API 语音合成，翻译结果自动朗读，中文语音自动选择
- **自动启停** — 视频播放自动开始同传，暂停自动停止
- **自纠正引擎** — Levenshtein 距离检测 interim→final 差异，自动重翻译不确定的历史条目

**智能辅助**

- **知识胶囊 (Live Tooltips)** — 专业术语（AGI、K8s、T-SNE 等）自动高亮，鼠标划过弹出解释。内置 60+ 科技/AI 词典，失败时降级到 Wikipedia REST API
- **实时思维导图 (Auto-Structuring)** — 根据讲者逻辑脉络实时生成树状大纲，支持展开/折叠，可导出 Markdown 文件或 JSON 到剪贴板
- **开小差补救 (Catch-up Mode)** — `Ctrl+Enter` 一键总结过去 5 分钟的 3 个要点，算法基于术语密度 + 主题关键词 + 时间分散
- **流式问答伴侣 (Live Q&A)** — 命令行风格输入框，随时向 AI 提问「讲者刚才提到的库叫什么」，基于转录缓存关键词搜索即时回答

**记录与导出**

- **会议记录** — 带时间戳的原文 + 译文双语记录，代码日志风格（`// 原文` `> 译文`）
- **智能待办** — 从翻译文本中自动提取行动指令，支持 OpenAI GPT 增强提取
- **翻译导出** — 一键导出为 TXT 文件
- **屏幕视界增强 (Screen-Aware Translation)** — Tesseract.js OCR 识别 PPT/屏幕内容，智能变化检测（像素 MSE），提取视觉术语注入翻译上下文

**UI 设计**

- **GitHub Dark 极客终端风** — `#0D1117` 暗黑背景 + JetBrains Mono 等宽体 + CRT glow 绿色译文
- **悬浮窗自适应** — 紧凑模式自动收起，下拉箭头展开全部功能区
- **四标签页** — 会议记录 / 智能待办 / 思维导图 / 问答，蓝色指示器跟随切换

## 安装

### 从源码构建

```bash
git clone https://github.com/qq1906198507-ai/AIst.git
cd AIst
npm install
npm run build
```

构建产物在 `dist/` 目录。

### 加载到 Chrome

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择项目中的 `dist` 文件夹
5. 扩展安装完成

## 使用方法

### 基本操作

打开任意含视频的网页（YouTube、Coursera、B 站等），LinguaSync Pro 悬浮窗会自动出现在视频下方。

**开始同传：** 点击「开始同传」按钮，或按 `Alt+T`。视频播放时自动开始。

**展开面板：** 点击右侧下拉箭头 `↓` 展开工具栏和标签页区域。

**导出记录：** 点击「导出」按钮或按 `Alt+E`，下载为 TXT 文件。

### 音频模式

悬浮窗有两种音频采集模式，点击工具栏的「麦克风」按钮切换：

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| **麦克风** | 通过系统麦克风拾音 | 外放视频、会议通话 |
| **标签页音频** | 直接捕获浏览器标签页音频 | 戴耳机看视频（推荐） |

标签页音频模式通过 Web Audio API 对音频做 +8dB 增益放大，轻声内容也能被识别到。首次切换时浏览器会弹出屏幕共享选择框，选择当前标签页并勾选「共享音频」。

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Alt+T` | 开始 / 停止同传 |
| `Alt+E` | 导出翻译记录 |
| `Ctrl+Enter` | 开小差补救 — 总结过去 5 分钟要点 |

### 设置

点击 Chrome 工具栏的扩展图标，打开设置面板：

| 设置项 | 说明 |
|--------|------|
| `$ source_language` | 视频语言（英语、日语、韩语等 8 种） |
| `$ auto_start` | 检测到视频播放时自动启动同传 |
| `$ tts_voice` | TTS 语音朗读翻译结果 |
| `$ subtitle_overlay` | 视频内嵌字幕叠加 |
| `$ screen_vision` | 屏幕 OCR 视界增强（Tesseract.js） |
| `$ live_tooltips` | 知识胶囊术语解释 |
| `$ auto_mindmap` | 实时思维导图生成 |

## 智能功能详解

### 知识胶囊 (Live Tooltips)

当翻译文本中出现专业术语时，术语会以紫色虚线高亮显示。鼠标划过术语即可看到悬浮解释框：

- **本地词典**（绿色标签）— 内置 60+ 常见 AI/科技术语中英对照解释
- **Wikipedia**（灰色标签）— 本地词典未命中时，查询 Wikipedia REST API 并缓存结果

术语提取算法同时使用词典匹配和正则模式（全大写缩写 `API`、混合编号 `K8s`、PascalCase `WebSocket` 等）。

### 实时思维导图 (Auto-Structuring)

切换到「思维导图」标签页，AI 根据讲者的逻辑脉络实时生成树状大纲：

- 检测主题切换关键词（"接下来"、"let's talk about" 等），自动创建新主题节点
- 后续句子作为关键点挂在当前主题下
- 每个节点支持点击展开/折叠
- 讲座结束后可通过顶部工具栏导出：
  - **.md** — 下载层级结构 Markdown 文件（兼容 Obsidian / Notion）
  - **JSON** — 复制结构化数据到剪贴板

### 开小差补救 (Catch-up Mode)

中途离开或迟到时，按 `Ctrl+Enter`：

- 从过去 5 分钟的转录历史中提取 Top 3 要点
- 算法维度：术语密度（TermExtractor 提取的专业术语数量）、主题关键词命中、句子长度适中性、去重惩罚、时间分散
- 以金色摘要卡片插入会议记录面板顶部，可一键关闭

### 流式问答伴侣 (Live Q&A)

切换到「问答」标签页，底部有命令行风格输入框（`$ >`）：

- 输入问题后按 `Enter` 提交
- 基于转录历史进行关键词搜索（中文 bigram 分词 + 去停用词 + 时间衰减加权）
- 返回最相关的转录片段（原文 + 译文 + 时间戳 + 相关度评分）
- 不中断视频播放和同传

### 智能待办

翻译文本中包含行动指令时，系统自动提取为待办事项，显示在「智能待办」标签页中。

- **关键词匹配**（默认启用）：识别包含"需要"、"负责"、"完成"、"跟进"、"准备"、"提交"等关键词的句子
- **AI 增强提取**（需配置 OpenAI API Key）：通过 GPT 模型更精准地提取待办

待办支持勾选完成，新待办有橙色圆点提醒。

### 屏幕视界增强 (Screen-Aware Translation)

开启后，扩展会定期截取屏幕画面，通过 Tesseract.js OCR 识别 PPT/屏幕上的文字：

- **智能变化检测** — 将截图缩小到 160×90 并采样 R 通道，计算像素 MSE，仅在画面显著变化时触发 OCR，节省计算资源
- **视觉术语注入** — 提取的屏幕术语作为上下文传给翻译 API，提升专业内容翻译质量
- **术语条** — 识别到的屏幕术语以紫色标签显示在会议记录面板顶部

## 质量保障与校验

扩展在关键环节内置了多层校验机制，确保异常情况下的稳定性和用户体验。

### 翻译 API 响应校验

翻译链路（`fetchFree` + `translateImmediate`）的每一层都包含完整的防护：

- **超时控制** — 使用 `AbortController` 为每个翻译源设置 10 秒超时，后台消息设置 12 秒超时降级，避免无限等待
- **HTTP 状态码检查** — 非 `2xx` 响应跳过并输出警告日志（如 `MyMemory HTTP 429`）
- **响应格式校验** — 验证返回 JSON 的数据结构（`responseStatus`、数组嵌套格式），类型不匹配时降级到下一个源
- **空翻译检测** — 过滤空白结果、与原文完全相同的翻译、以及长度超过原文 5 倍的异常响应
- **多层降级链** — 后台服务 → MyMemory → Google Translate → 返回原文，任一层失败自动跳到下一层

### 用户输入校验

- **Q&A 输入** — 最大 200 字限制 + 800ms 去抖（防止连续提交），超长时自动截断并提示用户
- **设置值守护** — `loadConfig()` 对语言格式（`xx-XX` 正则）、音频模式枚举值、所有布尔开关进行类型守卫，非法值回退到默认值
- **历史为空保护** — Q&A 问答和开小差补救在无转录历史时给出友好提示而非静默失败
- **导出降级** — 思维导图 JSON 导出在 Clipboard API 不可用时自动降级为文件下载

### 浏览器能力检测

启动同传前对所有依赖的 Web API 做可用性检测，缺失核心能力时弹出详细提示：

| API | 用途 | 缺失时行为 |
|-----|------|-----------|
| Web Speech API | 语音识别（核心） | 阻止启动 + 弹窗提示使用 Chrome/Edge |
| Speech Synthesis | TTS 语音朗读 | 静默禁用 TTS 开关 |
| getDisplayMedia | 标签页音频捕获 | 标签页音频模式不可用，降级到麦克风 |
| Clipboard API | 剪贴板写入 | 降级为文件下载 |

### 数据质量过滤

- **术语去噪** — `TermExtractor` 新增噪声黑名单（罗马数字 II/III/IV、常见停用词 THE/AND 等）+ 纯数字过滤，减少误高亮
- **OCR 置信度阈值** — `ScreenCapture` 仅接受置信度 ≥ 0.5 的 OCR 结果，低质量识别直接丢弃并在 Console 输出调试日志
- **思维导图节点上限** — `MindMapBuilder` 限制总节点数不超过 50 个，防止长时间讲座导致内存膨胀和 UI 卡顿
- **Wikipedia 超时** — 术语定义查询加 8 秒超时 + 输入长度限制（100 字），网络异常时回退到本地词典兜底文案

## 技术架构

```
┌──────────────────────────────────────────────────────┐
│  Content Script (注入到视频页面)                       │
│  ├─ 视频检测 (MutationObserver + 轮询)                │
│  ├─ TabAudioCapture (getDisplayMedia + GainNode +8dB) │
│  ├─ SpeechEngine (Web Speech API + 快速自动重启)      │
│  ├─ SubtitleOverlay (视频内嵌字幕)                    │
│  ├─ TTSEngine (Web Speech API 语音合成队列)           │
│  ├─ SelfCorrectionEngine (Levenshtein 自纠正)         │
│  ├─ ScreenCapture (截图 + 像素 MSE + 置信度 ≥0.5)    │
│  ├─ TermExtractor (术语提取 + 噪声过滤 + 60+ 词典)    │
│  ├─ TooltipEngine (Wikipedia 8s超时 + 本地降级)       │
│  ├─ MindMapBuilder (实时大纲 + 50 节点上限)           │
│  ├─ CatchUpEngine (Top-K 要点摘要算法)                │
│  ├─ QAEngine (关键词搜索 + 200字限制 + 去抖)          │
│  ├─ FloatingWidget (四标签页悬浮控制面板)              │
│  ├─ 翻译防抖 (150ms) + AbortController 超时 + 多层降级│
│  └─ 浏览器能力检测 (Speech/Display/Clipboard 守卫)    │
├──────────────────────────────────────────────────────┤
│  Background Service Worker                           │
│  ├─ 翻译分发 (MyMemory → Google Translate 降级)       │
│  ├─ AI 待办提取 (OpenAI GPT)                         │
│  ├─ Screen OCR 路由 (captureVisibleTab → Offscreen)   │
│  ├─ tabCapture 协调                                  │
│  └─ 快捷键转发                                       │
├──────────────────────────────────────────────────────┤
│  Offscreen Document                                  │
│  └─ Tesseract.js v5 OCR (CDN 加载 + 懒初始化)        │
├──────────────────────────────────────────────────────┤
│  Popup (React + Tailwind CSS v4)                     │
│  └─ 7 项功能开关 + 源语言设置 + 设置值类型守卫        │
└──────────────────────────────────────────────────────┘
```

**技术栈：** TypeScript + Vite + Tailwind CSS v4 + Chrome Extension Manifest V3

## 支持的浏览器

- Chrome 90+（推荐）
- Edge 90+（基于 Chromium）
- 其他 Chromium 内核浏览器

> Web Speech API 仅在 Chromium 内核浏览器中可用。Firefox / Safari 不支持。

## 常见问题

**Q: 悬浮窗没有出现？**
确保页面中有 `<video>` 元素且尺寸大于 200×100px。部分网站的播放器使用非标准实现，可能无法自动检测。

**Q: 语音识别不灵敏？**
切换到「标签页音频」模式，该模式通过 GainNode 放大 +8dB，识别效果明显优于麦克风模式。

**Q: 翻译功能失效？**
扩展内置多层翻译降级：MyMemory API → Google Translate 免费端点 → 返回原文。如果所有 API 均不可达，会在 Console 输出警告日志。

**Q: 标签页音频切换后没声音？**
首次使用时浏览器会弹出共享选择框，需要选择当前标签页并勾选「同时共享标签页音频」。

**Q: 扩展更新后界面没变？**
在 `chrome://extensions/` 刷新扩展后，需要**关闭**视频标签页再**重新打开**，内容脚本才会加载最新版本。

**Q: 知识胶囊没有显示？**
在 popup 设置中确认 `$ live_tooltips` 开关已开启。术语仅在原文（英文）中检测，需要文本中包含全大写缩写、混合编号等模式才会触发高亮。

**Q: 思维导图导出什么格式？**
「思维导图」标签页展开后，顶部工具栏有两个按钮：`.md` 下载 Markdown 文件（兼容 Obsidian / Notion），`JSON` 复制结构化数据到剪贴板。

**Q: 翻译一直不出现或很慢怎么办？**
扩展内置完整的超时和降级机制：每个翻译源 10 秒超时（`AbortController`），后台消息 12 秒超时。如果 MyMemory 和 Google Translate 均不可达，会自动返回原文并在 Console 输出警告。可在 DevTools Network 面板查看具体请求状态码。

**Q: 点击「语音」按钮没有反应？**
部分浏览器不支持 `SpeechSynthesis` API。启动同传时会检测浏览器能力，缺失核心 API 会弹窗提示。TTS 在支持检测未通过时会自动禁用开关。

## 许可

MIT License
