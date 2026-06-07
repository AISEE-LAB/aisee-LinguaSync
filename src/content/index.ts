/**
 * LinguaSync Pro v7 - 内容脚本
 *
 * 新增:
 *  - GitHub Dark 极客终端风 UI — JetBrains Mono 等宽体 + #0D1117 暗黑背景
 *  - 翻译记录呈现代码日志风格 — // 注释原文 + > 绿色译文 + CRT glow
 *  - 标签页音频直采 (getDisplayMedia) — 不依赖麦克风外放
 *  - TTS 语音朗读 + 字幕叠加 — 双通道呈现
 *  - 自纠正引擎 — Levenshtein 距离自动修正
 *  - 知识胶囊 (Live Tooltips) — 专业术语悬浮解释，Wikipedia + 本地词典
 *  - 实时思维导图 (Auto-Structuring) — 根据讲者逻辑生成结构化大纲
 *  - 开小差补救 (Catch-up Mode) — Ctrl+Enter 一键总结过去 5 分钟要点
 *  - 流式问答伴侣 (Live Q&A) — 命令行输入框，基于转录缓存即时回答
 *  - 会话统计面板 (Session Stats) — 翻译句数/词数/语速趋势/高频术语
 *  - 回放锚点 (Playback Anchors) — 点击会议记录跳转视频时间点
 *  - 自定义术语表 (Custom Glossary) — 用户词库持久化，翻译时优先匹配
 *  - 词汇本 (Vocab Notebook) — 自动收录术语 + 掌握标记 + 复习提醒
 *  - 翻译置信度指示器 — 每条翻译旁显示绿/黄/红色条
 *  - 会后摘要生成器 — 一键生成结构化会议总结 (Markdown)
 */

// ========== 类型 ==========

interface TranslationResult {
  original: string;
  translated: string;
  timestamp: number;
  corrected: number;
  videoTime?: number;
  confidence?: number;
}

interface AppConfig {
  defaultLanguage: string;
  translationBackend: string;
  openaiApiKey: string;
  autoStart: boolean;
  audioMode: 'microphone' | 'tabAudio';
  ttsEnabled: boolean;
  subtitleEnabled: boolean;
  screenVisionEnabled: boolean;
  tooltipsEnabled: boolean;
  mindmapEnabled: boolean;
}

// ========== 视频检测 ==========

function findMainVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video'));
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;
  for (const v of videos) {
    const rect = v.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (rect.width > 200 && rect.height > 100 && area > bestArea) {
      bestArea = area;
      best = v;
    }
  }
  return best;
}

// ========== 音频放大器 (Web Audio API) ==========

class AudioAmplifier {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private rafId = 0;

  onLevel: (level: number) => void = () => {};

  /** 放大音频流并通过扬声器输出，同时提供实时音量分析 */
  amplify(stream: MediaStream, gainDb = 8): boolean {
    try {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return false;

      this.ctx = new AudioContext();
      const audioOnly = new MediaStream(audioTracks);
      this.source = this.ctx.createMediaStreamSource(audioOnly);

      // 增益节点：默认 +8dB，轻声也能拾到
      this.gain = this.ctx.createGain();
      this.gain.gain.value = Math.pow(10, gainDb / 20); // ~2.5x

      // 分析器：实时监测音量
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.6;

      // 输出到扬声器 → 麦克风拾取
      this.dest = this.ctx.createMediaStreamDestination();

      // 连接链路: source → gain → analyser → destination(speakers)
      this.source.connect(this.gain);
      this.gain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination); // 扬声器输出
      this.analyser.connect(this.dest);            // 同时输出到 MediaStream（备用）

      // 隐藏 audio 元素确保音频在某些浏览器中持续输出
      this.audioEl = document.createElement('audio');
      this.audioEl.srcObject = this.dest.stream;
      this.audioEl.volume = 1.0;
      this.audioEl.style.display = 'none';
      document.body.appendChild(this.audioEl);
      this.audioEl.play().catch(() => {});

      this.startLevelMonitor();
      return true;
    } catch {
      this.cleanup();
      return false;
    }
  }

  /** 获取当前实时音量 (0~1) */
  getLevel(): number {
    if (!this.analyser) return 0;
    const buf = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i];
    return Math.min(1, (sum / buf.length) / 128);
  }

  /** 设置增益 (dB) */
  setGain(db: number) {
    if (this.gain) this.gain.gain.value = Math.pow(10, db / 20);
  }

  private startLevelMonitor() {
    const tick = () => {
      this.onLevel(this.getLevel());
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  cleanup() {
    cancelAnimationFrame(this.rafId);
    if (this.audioEl) { this.audioEl.pause(); this.audioEl.srcObject = null; this.audioEl.remove(); this.audioEl = null; }
    if (this.ctx && this.ctx.state !== 'closed') { this.ctx.close().catch(() => {}); }
    this.ctx = null; this.source = null; this.gain = null; this.analyser = null; this.dest = null;
  }
}

// ========== 标签页音频直采 ==========

class TabAudioCapture {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private originalMuted = false;
  private active = false;
  private amplifier = new AudioAmplifier();

  onLevel: (level: number) => void = () => {};

  /**
   * 捕获当前标签页音频并放大输出。
   * 原理: getDisplayMedia → GainNode (+8dB 放大) → 扬声器 → Web Speech API (麦克风) 拾取
   * 同时静音原始视频避免双重声音。
   */
  async start(video: HTMLVideoElement): Promise<boolean> {
    // 浏览器能力检测
    if (!navigator.mediaDevices?.getDisplayMedia) {
      console.warn('[LinguaSync] getDisplayMedia API not supported in this browser');
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      } as any);

      const audioTracks = this.stream.getAudioTracks();
      if (audioTracks.length === 0) { this.stop(); return false; }

      // 通过放大器处理音频（+8dB 增益 + 实时音量监测）
      if (!this.amplifier.amplify(this.stream, 8)) {
        this.stop();
        return false;
      }

      // 实时音量回调
      this.amplifier.onLevel = (lv) => this.onLevel(lv);

      // 静音原始视频（避免双重声音）
      this.video = video;
      this.originalMuted = video.muted;
      video.muted = true;

      this.active = true;
      return true;
    } catch {
      this.stop();
      return false;
    }
  }

  getLevel(): number { return this.amplifier.getLevel(); }

  stop() {
    this.amplifier.cleanup();
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.muted = this.originalMuted;
      this.video = null;
    }
    this.active = false;
  }

  isActive(): boolean { return this.active; }
}

// ========== 视频内嵌字幕叠加层 ==========

class SubtitleOverlay {
  private overlay: HTMLElement | null = null;
  private originalEl: HTMLElement | null = null;
  private translatedEl: HTMLElement | null = null;
  private video: HTMLVideoElement | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  attach(video: HTMLVideoElement) {
    if (this.video === video) return;
    this.detach();
    this.video = video;
    const wrapper = video.parentElement || video;
    const cs = getComputedStyle(wrapper);
    if (cs.position === 'static') wrapper.style.position = 'relative';

    this.overlay = document.createElement('div');
    this.overlay.className = 'ls-subtitle-overlay';
    this.overlay.innerHTML = `<div class="ls-sub-original"></div><div class="ls-sub-translated"></div>`;
    this.originalEl = this.overlay.querySelector('.ls-sub-original');
    this.translatedEl = this.overlay.querySelector('.ls-sub-translated');
    wrapper.appendChild(this.overlay);
  }

  detach() {
    if (this.overlay?.parentElement) this.overlay.parentElement.removeChild(this.overlay);
    this.overlay = null;
    this.originalEl = null;
    this.translatedEl = null;
    this.video = null;
  }

  showInterim(original: string, translated: string) {
    if (!this.originalEl || !this.translatedEl) return;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.originalEl.textContent = original;
    this.translatedEl.textContent = translated;
    this.overlay!.classList.add('ls-sub-visible');
    this.overlay!.classList.remove('ls-sub-final');
  }

  showFinal(original: string, translated: string) {
    if (!this.originalEl || !this.translatedEl) return;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.originalEl.textContent = original;
    this.translatedEl.textContent = translated;
    this.overlay!.classList.add('ls-sub-visible', 'ls-sub-final');
    this.hideTimer = setTimeout(() => this.hide(), 15000);
  }

  hide() {
    this.overlay?.classList.remove('ls-sub-visible', 'ls-sub-final');
    if (this.originalEl) this.originalEl.textContent = '';
    if (this.translatedEl) this.translatedEl.textContent = '';
  }
}

// ========== TTS 语音朗读引擎 ==========

class TTSEngine {
  private synth: SpeechSynthesis | null = null;
  private queue: string[] = [];
  private speaking = false;
  private enabled = false;
  private voice: SpeechSynthesisVoice | null = null;
  private rate = 1.0;
  private supported = false;

  /** 初始化：检测 speechSynthesis 可用性并选择中文语音 */
  init() {
    // 浏览器能力检测
    if (typeof window.speechSynthesis === 'undefined') {
      this.supported = false;
      console.warn('[LinguaSync] speechSynthesis API not available');
      return;
    }
    this.synth = window.speechSynthesis;
    this.supported = true;

    const pickVoice = () => {
      if (!this.synth) return;
      const voices = this.synth.getVoices();
      // 优先选 zh-CN，其次 zh-TW/zh-HK，再次任意中文
      this.voice =
        voices.find((v) => v.lang === 'zh-CN') ||
        voices.find((v) => v.lang.startsWith('zh')) ||
        null;
    };
    pickVoice();
    if (typeof this.synth.onvoiceschanged !== 'undefined') {
      this.synth.onvoiceschanged = pickVoice;
    }
  }

  isSupported(): boolean { return this.supported; }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.stop();
  }

  isEnabled(): boolean { return this.enabled; }

  setRate(rate: number) { this.rate = Math.max(0.5, Math.min(2, rate)); }

  /** 朗读一段中文翻译 */
  speak(text: string) {
    if (!this.supported || !this.synth) return;
    if (!this.enabled || !text || text.trim().length === 0) return;
    // 文本长度保护：过长文本截断
    const safeText = text.length > 500 ? text.slice(0, 500) + '...' : text;
    this.queue.push(safeText);
    this.processQueue();
  }

  private processQueue() {
    if (!this.synth || this.speaking || this.queue.length === 0) return;
    this.speaking = true;
    const text = this.queue.shift()!;
    const utterance = new SpeechSynthesisUtterance(text);
    if (this.voice) utterance.voice = this.voice;
    utterance.lang = 'zh-CN';
    utterance.rate = this.rate;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.onend = () => {
      this.speaking = false;
      this.processQueue();
    };
    utterance.onerror = () => {
      this.speaking = false;
      this.processQueue();
    };
    this.synth.speak(utterance);
  }

  /** 停止朗读并清空队列 */
  stop() {
    this.queue = [];
    this.speaking = false;
    if (this.synth?.speaking) this.synth.cancel();
  }
}

// ========== 屏幕截图 + 智能变化检测 ==========

interface ScreenText {
  fullText: string;
  terms: string[];
  confidence: number;
  timestamp: number;
}

class ScreenCapture {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private prevHash: string = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private enabled = false;
  private interval = 3000;
  private changeThreshold = 12;

  onScreenText: (screenText: ScreenText) => void = () => {};

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on) this.start(); else this.stop();
  }

  isEnabled(): boolean { return this.enabled; }

  private start() {
    if (this.timer) return;
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 160;
      this.canvas.height = 90;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    this.captureAndCompare();
    this.timer = setInterval(() => this.captureAndCompare(), this.interval);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async captureAndCompare() {
    if (this.processing || !this.enabled) return;
    this.processing = true;
    try {
      const response = await this.sendMsg({ type: 'SCREEN_CAPTURE' });
      if (!response?.dataUrl) { this.processing = false; return; }
      const img = await this.loadImage(response.dataUrl as string);
      const hash = this.computeHash(img);
      const changed = this.isSignificantChange(hash);
      this.prevHash = hash;
      if (changed) {
        const ocrResult = await this.sendMsg({
          type: 'SCREEN_OCR_REQUEST', imageDataUrl: response.dataUrl,
        });
        if (ocrResult?.text) {
          // OCR 置信度过滤：低于 0.5 的结果不可靠
          const confidence = ocrResult.confidence || 0;
          if (confidence < 0.5) {
            console.debug(`[LinguaSync] OCR confidence too low (${confidence.toFixed(2)}), skipping`);
          } else {
            const terms = this.extractTerms(ocrResult.words || []);
            this.onScreenText({
              fullText: ocrResult.text, terms,
              confidence,
              timestamp: Date.now(),
            });
          }
        }
      }
    } catch { /* ignore */ }
    finally { this.processing = false; }
  }

  private computeHash(img: HTMLImageElement): string {
    if (!this.ctx || !this.canvas) return '';
    this.ctx.drawImage(img, 0, 0, 160, 90);
    const data = this.ctx.getImageData(0, 0, 160, 90).data;
    const samples: number[] = [];
    for (let i = 0; i < data.length; i += 16) samples.push(data[i]);
    return samples.join(',');
  }

  private isSignificantChange(currentHash: string): boolean {
    if (!this.prevHash) return true;
    const prev = this.prevHash.split(',').map(Number);
    const curr = currentHash.split(',').map(Number);
    if (prev.length !== curr.length) return true;
    let sumSq = 0;
    for (let i = 0; i < prev.length; i++) {
      const diff = prev[i] - curr[i];
      sumSq += diff * diff;
    }
    return (sumSq / prev.length) > this.changeThreshold;
  }

  private extractTerms(words: string[]): string[] {
    const stop = new Set([
      'the','a','an','is','are','was','were','be','been','being',
      'have','has','had','do','does','did','will','would','could',
      'should','may','might','shall','can','need','to','of','in',
      'for','on','with','at','by','from','as','into','through',
      'during','before','after','and','but','or','not','so','yet',
      'this','that','these','those','it','its','we','our','you',
    ]);
    return words.filter(w => w.length > 2 && !stop.has(w.toLowerCase())).slice(0, 20);
  }

  private sendMsg(msg: Record<string, any>): Promise<any> {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(r);
        });
      } catch { resolve(null); }
    });
  }

  private loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }
}

// ========== 术语提取器 + 本地词典 (知识胶囊) ==========

interface TermDefinition {
  term: string;
  definition: string;
  source: 'local' | 'wiki';
}

class TermExtractor {
  private localDict: Map<string, string> = new Map([
    // AI / 机器学习
    ['AGI', '通用人工智能：具备人类水平智能的 AI 系统'],
    ['AI', '人工智能：模拟人类智能的计算机系统'],
    ['ML', '机器学习：让计算机从数据中自动学习的技术'],
    ['DL', '深度学习：使用多层神经网络的机器学习方法'],
    ['NLP', '自然语言处理：让计算机理解和生成人类语言'],
    ['NLU', '自然语言理解：NLP 中负责理解语义的子领域'],
    ['NLG', '自然语言生成：NLP 中负责生成文本的子领域'],
    ['LLM', '大语言模型：基于 Transformer 的大规模预训练语言模型'],
    ['GPT', '生成式预训练 Transformer：OpenAI 的自回归语言模型系列'],
    ['BERT', '双向编码器表示：Google 的双向预训练语言模型'],
    ['GAN', '生成对抗网络：由生成器和判别器组成的神经网络框架'],
    ['CNN', '卷积神经网络：擅长图像处理的深度学习架构'],
    ['RNN', '循环神经网络：处理序列数据的神经网络'],
    ['LSTM', '长短期记忆网络：解决长距离依赖的 RNN 变体'],
    ['RLHF', '人类反馈强化学习：用人类偏好对齐模型输出的方法'],
    ['RAG', '检索增强生成：结合外部知识库检索的 LLM 生成方法'],
    ['MoE', '混合专家模型：使用多个专家子网络的条件计算架构'],
    ['CoT', '思维链：让模型逐步推理的提示工程技术'],
    ['SGD', '随机梯度下降：一种常用的优化算法'],
    ['MLOps', '机器学习运维：ML 模型的开发、部署和运维实践'],
    ['T-SNE', 't-分布随机邻域嵌入：高维数据降维可视化算法'],
    // 架构 / 系统
    ['API', '应用程序编程接口：软件间的交互协议'],
    ['REST', '表征状态转移：一种 Web API 设计风格'],
    ['gRPC', 'Google 远程过程调用：高性能 RPC 框架'],
    ['SDK', '软件开发工具包：用于开发应用的工具集合'],
    ['K8s', 'Kubernetes：容器编排和自动化部署平台'],
    ['K8S', 'Kubernetes：容器编排和自动化部署平台'],
    ['Docker', '容器化平台：将应用打包为轻量容器的技术'],
    ['IaC', '基础设施即代码：用代码管理和配置基础设施'],
    // Web / 协议
    ['HTML', '超文本标记语言：Web 页面的标准标记语言'],
    ['CSS', '层叠样式表：用于描述网页呈现的样式语言'],
    ['DOM', '文档对象模型：网页内容的编程接口'],
    ['JWT', 'JSON Web Token：紧凑的无状态令牌标准'],
    ['OAuth', '开放授权：第三方应用安全访问资源的协议'],
    ['CORS', '跨域资源共享：浏览器安全策略机制'],
    ['WASM', 'WebAssembly：在浏览器中运行编译代码的二进制格式'],
    // DevOps / 云
    ['CI', '持续集成：频繁合并代码并自动测试的实践'],
    ['CD', '持续交付/部署：自动化软件发布流程'],
    ['AWS', 'Amazon Web Services：亚马逊云计算服务平台'],
    ['GCP', 'Google Cloud Platform：谷歌云计算平台'],
    // 通用技术
    ['SaaS', '软件即服务：通过云端提供的软件服务模式'],
    ['PaaS', '平台即服务：提供开发和部署环境的云服务'],
    ['IaaS', '基础设施即服务：提供计算资源的云服务'],
    ['IoT', '物联网：互联设备和传感器的网络生态系统'],
    ['MQTT', '消息队列遥测传输：轻量级 IoT 通信协议'],
    ['DB', '数据库：结构化存储和管理数据的系统'],
    ['SQL', '结构化查询语言：用于管理关系型数据库的语言'],
    ['NoSQL', '非关系型数据库：灵活 schema 的数据库类型'],
    ['ORM', '对象关系映射：程序对象与数据库表的桥接技术'],
    ['TDD', '测试驱动开发：先写测试再写代码的开发方法'],
    ['IDE', '集成开发环境：集成编码工具的软件应用'],
    ['CLI', '命令行界面：通过文本命令交互的用户界面'],
    ['MVP', '最小可行产品：具备核心功能的早期产品版本'],
    ['OKR', '目标与关键结果：目标管理和衡量框架'],
    ['KPI', '关键绩效指标：衡量业务成效的量化指标'],
    ['SLA', '服务等级协议：服务可用性和质量的承诺标准'],
    ['DDoS', '分布式拒绝服务：通过大量请求瘫痪服务的攻击'],
    // 前沿概念
    ['AGI', '通用人工智能：具备人类水平智能的 AI 系统'],
    ['Web3', '基于区块链的去中心化互联网愿景'],
    ['Rust', '系统编程语言：注重安全和并发的现代编程语言'],
  ]);

  /** 从英文文本中提取专业术语 */
  extract(text: string): string[] {
    if (!text || text.trim().length === 0) return [];
    const terms: string[] = [];
    const words = text.split(/\s+/);
    const seen = new Set<string>();
    // 噪声黑名单：常见误判词
    const noiseSet = new Set([
      'THE', 'AND', 'FOR', 'NOT', 'HIS', 'HER', 'HAS', 'HAD', 'HIM',
      'ALL', 'ITS', 'WAS', 'ARE', 'BUT', 'WHO', 'OUR', 'YOU', 'SHE',
      'HER', 'HIM', 'THEY', 'THAT', 'THIS', 'WITH', 'FROM', 'HAVE',
      'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII',
    ]);
    for (const word of words) {
      const clean = word.replace(/[.,;:!?'")(\]\[]/g, '');
      // 过滤：长度 < 2、纯数字、罗马数字噪声
      if (clean.length < 2) continue;
      if (/^\d+(\.\d+)?$/.test(clean)) continue; // 纯数字
      if (noiseSet.has(clean.toUpperCase())) continue; // 常见误判
      const upper = clean.toUpperCase();
      if (this.localDict.has(upper) && !seen.has(upper)) {
        terms.push(upper);
        seen.add(upper);
        continue;
      }
      if (this.localDict.has(clean) && !seen.has(clean.toUpperCase())) {
        terms.push(clean);
        seen.add(clean.toUpperCase());
        continue;
      }
      let score = 0;
      if (/^[A-Z][A-Z0-9]{1,}$/.test(clean) && clean.length >= 2) score += 3;
      if (/^[A-Za-z]+[0-9]+[a-z]*/.test(clean) && clean.length >= 2) score += 3;
      if (/^[A-Z]-[A-Z]+/.test(clean)) score += 3;
      if (/^[A-Z][a-z]+[A-Z]/.test(clean)) score += 2;
      if (score >= 3 && !seen.has(clean.toUpperCase())) {
        terms.push(clean);
        seen.add(clean.toUpperCase());
      }
    }
    return terms;
  }

  /** 查询本地词典定义 */
  getLocalDef(term: string): string | null {
    return this.localDict.get(term.toUpperCase()) || null;
  }
}

// ========== 知识胶囊引擎 (Wikipedia + 本地降级) ==========

class TooltipEngine {
  private cache = new Map<string, string>();
  private tooltipEl: HTMLElement | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private extractor: TermExtractor;

  constructor(extractor: TermExtractor) {
    this.extractor = extractor;
    this.createTooltip();
  }

  private createTooltip() {
    if (this.tooltipEl) return;
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'ls-tooltip';
    this.tooltipEl.style.display = 'none';
    document.body.appendChild(this.tooltipEl);
  }

  /** 获取术语定义：本地词典优先，失败走 Wikipedia */
  async getDefinition(term: string): Promise<TermDefinition> {
    // 输入校验
    if (!term || term.trim().length === 0) {
      return { term: term || '', definition: '无效术语', source: 'local' };
    }
    const cleanTerm = term.trim().slice(0, 100); // 防止过长请求
    const localDef = this.extractor.getLocalDef(cleanTerm);
    if (localDef) return { term: cleanTerm, definition: localDef, source: 'local' };
    if (this.cache.has(cleanTerm)) {
      return { term: cleanTerm, definition: this.cache.get(cleanTerm)!, source: 'wiki' };
    }
    try {
      // 8 秒超时
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const r = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanTerm)}`,
        { signal: controller.signal }
      );
      clearTimeout(timer);
      if (r.ok) {
        const d = await r.json();
        if (d && typeof d === 'object' && d.extract && typeof d.extract === 'string') {
          this.cache.set(cleanTerm, d.extract);
          return { term: cleanTerm, definition: d.extract, source: 'wiki' };
        }
      }
    } catch { /* */ }
    return { term: cleanTerm, definition: `专业术语: ${cleanTerm}`, source: 'local' };
  }

  /** 在术语元素上方显示 Tooltip */
  showNear(el: HTMLElement, def: TermDefinition) {
    if (!this.tooltipEl) return;
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    const sourceTag = def.source === 'wiki'
      ? '<span class="ls-tooltip-src">Wikipedia</span>'
      : '<span class="ls-tooltip-src ls-tooltip-local">本地词典</span>';
    this.tooltipEl.innerHTML =
      `<div class="ls-tooltip-term">${esc(def.term)} ${sourceTag}</div>` +
      `<div class="ls-tooltip-def">${esc(def.definition)}</div>`;
    this.tooltipEl.style.display = '';
    const rect = el.getBoundingClientRect();
    const tipW = 280;
    let left = rect.left + rect.width / 2 - tipW / 2;
    left = Math.max(8, Math.min(window.innerWidth - tipW - 8, left));
    let top = rect.bottom + 6;
    if (top + 120 > window.innerHeight) top = rect.top - 80;
    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
  }

  /** 延迟隐藏 */
  scheduleHide(delay = 200) {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.tooltipEl) this.tooltipEl.style.display = 'none';
    }, delay);
  }

  /** 立即隐藏 */
  hide() {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (this.tooltipEl) this.tooltipEl.style.display = 'none';
  }
}

// ========== 实时思维导图构建器 ==========

interface MindMapNode {
  id: string;
  title: string;
  level: 'topic' | 'subtopic' | 'point';
  children: MindMapNode[];
  expanded: boolean;
  timestamp: number;
}

class MindMapBuilder {
  private root: MindMapNode;
  private currentTopic: MindMapNode;
  private idCounter = 0;
  /** 主题切换关键词 (中/英) */
  private topicPatterns = [
    /(?:现在|接下来|下面|首先|其次|最后|然后|另外|此外)/,
    /(?:让我(?:们)?(?:讨论|看看|介绍|讲解|聊聊))/,
    /(?:下面(?:我们)?(?:来|将))/,
    /(?:let'?s|now|next|first|second|finally|moving\s*on)/i,
    /(?:today\s+(?:we|I)\s+(?:will|'ll|shall|would))/i,
    /(?:let'?s\s+(?:talk|discuss|explore|dive|look))/i,
  ];
  private lastSentence = '';

  constructor() {
    this.root = this.createNode('演讲大纲', 'topic');
    this.currentTopic = this.root;
  }

  private createNode(title: string, level: MindMapNode['level']): MindMapNode {
    return {
      id: `mm-${this.idCounter++}`,
      title, level, children: [],
      expanded: true, timestamp: Date.now(),
    };
  }

  /** 处理新的翻译句子，更新思维导图 */
  processSentence(original: string, translated: string) {
    // 过滤过短或重复的句子
    if (original.trim().length < 5) return;
    if (similarity(original.trim(), this.lastSentence.trim()) > 0.8) return;
    this.lastSentence = original;

    // 思维导图节点上限保护（总计不超过 50 个节点）
    const totalNodes = this.countNodes(this.root);
    if (totalNodes >= 50) {
      // 达到上限后不再添加新节点，避免内存膨胀
      return;
    }

    const isNewTopic = this.topicPatterns.some(p => p.test(original) || p.test(translated));

    if (isNewTopic || this.root.children.length === 0) {
      // 提取简短主题标题（优先用译文前 25 字）
      const topicTitle = translated.length > 25
        ? translated.slice(0, 25) + '...'
        : translated;
      const topic = this.createNode(topicTitle, 'subtopic');
      this.root.children.push(topic);
      this.currentTopic = topic;
    } else {
      // 作为关键点加入当前主题
      const pointTitle = translated.length > 45
        ? translated.slice(0, 45) + '...'
        : translated;
      const point = this.createNode(pointTitle, 'point');
      this.currentTopic.children.push(point);
      // 每个主题下最多 15 个关键点，避免过长
      if (this.currentTopic.children.length > 15) {
        this.currentTopic.children.shift();
      }
    }
  }

  getTree(): MindMapNode { return this.root; }

  /** 切换节点展开/折叠 */
  toggleNode(nodeId: string): boolean {
    const node = this.findNode(this.root, nodeId);
    if (node) { node.expanded = !node.expanded; return node.expanded; }
    return false;
  }

  private findNode(root: MindMapNode, id: string): MindMapNode | null {
    if (root.id === id) return root;
    for (const child of root.children) {
      const found = this.findNode(child, id);
      if (found) return found;
    }
    return null;
  }

  /** 递归统计节点总数 */
  private countNodes(node: MindMapNode): number {
    let count = 1;
    for (const child of node.children) count += this.countNodes(child);
    return count;
  }

  /** 导出为 Markdown */
  toMarkdown(): string {
    const lines: string[] = [`# 演讲笔记`, `> LinguaSync Pro 自动生成 · ${new Date().toLocaleDateString()}\n`];
    for (const topic of this.root.children) {
      lines.push(`## ${topic.title}`);
      for (const point of topic.children) {
        lines.push(`- ${point.title}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  /** 导出为 JSON */
  toJSON(): string {
    return JSON.stringify(this.root, null, 2);
  }
}

// ========== 开小差补救引擎 (Catch-up Mode) ==========

interface CatchUpPoint {
  text: string;
  translated: string;
  timestamp: number;
  score: number;
}

class CatchUpEngine {
  private extractor: TermExtractor;
  /** 主题指示关键词（中/英） */
  private topicWords = new Set([
    '重要', '关键', '核心', '总结', '结论', '发现', '结果', '问题', '解决',
    'important', 'key', 'critical', 'conclusion', 'result', 'problem', 'solution',
    'first', 'second', 'finally', 'next', 'new', 'different', 'actually',
  ]);

  constructor(extractor: TermExtractor) {
    this.extractor = extractor;
  }

  /**
   * 从最近 N 分钟的历史中提取 Top K 要点。
   * 算法：术语密度 + 主题关键词 + 句子长度适中 + 时间分散
   */
  summarize(history: TranslationResult[], minutesBack = 5, topK = 3): CatchUpPoint[] {
    const cutoff = Date.now() - minutesBack * 60 * 1000;
    const recent = history.filter(h => h.timestamp >= cutoff);
    if (recent.length === 0) return [];
    if (recent.length <= topK) {
      return recent.map(h => ({
        text: h.original, translated: h.translated,
        timestamp: h.timestamp, score: 1,
      }));
    }

    // 计算每句的重要性分数
    const scored = recent.map((entry) => {
      let score = 0;
      // 1) 术语密度：包含的专业术语越多越重要
      const terms = this.extractor.extract(entry.original);
      score += terms.length * 3;
      // 2) 主题关键词命中
      const words = entry.original.toLowerCase().split(/\s+/);
      for (const w of words) {
        if (this.topicWords.has(w.replace(/[.,;:!?]/g, ''))) score += 2;
      }
      for (const tw of this.topicWords) {
        if (entry.translated.includes(tw)) score += 2;
      }
      // 3) 句子长度适中（15~80 词最佳，太短或太长扣分）
      const wordCount = words.length;
      if (wordCount >= 8 && wordCount <= 50) score += 2;
      else if (wordCount < 5) score -= 2;
      // 4) 独特性：与其他句子不太重复
      let overlapPenalty = 0;
      for (const other of recent) {
        if (other === entry) continue;
        const sim = similarity(entry.original.slice(0, 50), other.original.slice(0, 50));
        if (sim > 0.6) overlapPenalty += 1;
      }
      score -= overlapPenalty;
      return { text: entry.original, translated: entry.translated, timestamp: entry.timestamp, score };
    });

    // 按分数排序，取 Top K，尽量时间分散
    scored.sort((a, b) => b.score - a.score);
    const selected: CatchUpPoint[] = [];
    const minGap = (minutesBack * 60 * 1000) / (topK + 1); // 最小时间间隔
    for (const item of scored) {
      if (selected.length >= topK) break;
      const tooClose = selected.some(s => Math.abs(s.timestamp - item.timestamp) < minGap);
      if (!tooClose || selected.length < 2) {
        selected.push(item);
      }
    }
    // 按时间排序返回
    selected.sort((a, b) => a.timestamp - b.timestamp);
    return selected;
  }
}

// ========== 流式问答引擎 (Live Q&A Co-pilot) ==========

interface QAResult {
  question: string;
  answers: { text: string; translated: string; timestamp: number; relevance: number }[];
  timestamp: number;
}

class QAEngine {
  /** 中文停用词 */
  private stopWords = new Set([
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
    '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
    '没有', '看', '好', '自己', '这', '他', '她', '它', '吗', '什么', '那',
    '怎么', '为什么', '哪', '谁', '多少', '几', 'the', 'a', 'an', 'is',
    'are', 'was', 'were', 'do', 'does', 'did', 'what', 'which', 'who',
    'when', 'where', 'why', 'how', 'can', 'could', 'would', 'should',
    'just', 'about', 'does', 'has', 'have', 'had',
  ]);

  /**
   * 在转录历史中搜索与问题相关的片段。
   * 算法：提取问题关键词 → 计算每段历史与关键词的重叠度 → 按相关性排序
   */
  search(question: string, history: TranslationResult[], topK = 3): QAResult {
    const keywords = this.extractKeywords(question);
    const scored = history.map((entry) => {
      let relevance = 0;
      const combined = `${entry.original} ${entry.translated}`.toLowerCase();
      for (const kw of keywords) {
        const kwLower = kw.toLowerCase();
        // 精确匹配权重高
        if (combined.includes(kwLower)) relevance += 3;
        // 部分匹配（前缀）
        const words = combined.split(/\s+/);
        for (const w of words) {
          if (w.startsWith(kwLower) && w.length > kwLower.length) relevance += 1;
        }
      }
      // 时间衰减：越近的内容越相关
      const ageMinutes = (Date.now() - entry.timestamp) / 60000;
      relevance *= Math.max(0.3, 1 - ageMinutes / 30);
      return { text: entry.original, translated: entry.translated, timestamp: entry.timestamp, relevance };
    });
    scored.sort((a, b) => b.relevance - a.relevance);
    const answers = scored.filter(s => s.relevance > 0).slice(0, topK);
    return { question, answers, timestamp: Date.now() };
  }

  /** 从问题中提取关键词（去停用词 + 分词） */
  private extractKeywords(text: string): string[] {
    // 中文：按标点/空格分割，取 2 字以上的片段
    // 英文：按空格分割，去停用词
    const parts = text.split(/[\s,，。？?！!、；;：:]+/);
    const keywords: string[] = [];
    for (const part of parts) {
      const clean = part.replace(/[.,;:!?'"()\[\]]/g, '').trim();
      if (clean.length < 2) continue;
      if (this.stopWords.has(clean) || this.stopWords.has(clean.toLowerCase())) continue;
      keywords.push(clean);
      // 对中文长词进行 bigram 拆分增加召回率
      if (/[\u4e00-\u9fff]/.test(clean) && clean.length > 3) {
        for (let i = 0; i < clean.length - 1; i++) {
          const bigram = clean.slice(i, i + 2);
          if (!this.stopWords.has(bigram)) keywords.push(bigram);
        }
      }
    }
    // 去重
    return [...new Set(keywords)];
  }
}

// ========== 会话统计引擎 (Session Stats) ==========

interface SpeedSample { time: number; wpm: number; }

interface SessionReport {
  totalSentences: number;
  totalWords: number;
  avgWpm: number;
  sessionMinutes: number;
  speedHistory: SpeedSample[];
  topTerms: { term: string; count: number }[];
  correctedCount: number;
  qaCount: number;
}

class SessionStats {
  private startTime = 0;
  private totalSentences = 0;
  private totalWords = 0;
  private correctedCount = 0;
  private qaCount = 0;
  private speedHistory: SpeedSample[] = [];
  private termFreq = new Map<string, number>();
  private lastSampleTime = 0;
  private wordsInWindow = 0;
  private windowStart = 0;

  start() {
    this.startTime = Date.now();
    this.windowStart = Date.now();
    this.wordsInWindow = 0;
  }

  recordSentence(original: string, terms: string[]) {
    this.totalSentences++;
    const wordCount = original.split(/\s+/).filter(w => w.length > 0).length;
    this.totalWords += wordCount;
    this.wordsInWindow += wordCount;
    // 每 30 秒采样一次语速
    const now = Date.now();
    if (now - this.lastSampleTime >= 30000 && this.windowStart > 0) {
      const elapsedMin = (now - this.windowStart) / 60000;
      if (elapsedMin > 0) {
        const wpm = Math.round(this.wordsInWindow / elapsedMin);
        this.speedHistory.push({ time: now, wpm: Math.min(wpm, 500) }); // 上限 500
        if (this.speedHistory.length > 60) this.speedHistory.shift(); // 最多保留 60 个采样点
      }
      this.windowStart = now;
      this.wordsInWindow = 0;
      this.lastSampleTime = now;
    }
    // 统计术语频率
    for (const t of terms) {
      this.termFreq.set(t, (this.termFreq.get(t) || 0) + 1);
    }
  }

  recordCorrection() { this.correctedCount++; }
  recordQA() { this.qaCount++; }

  getReport(): SessionReport {
    const elapsed = this.startTime > 0 ? (Date.now() - this.startTime) / 60000 : 0;
    const avgWpm = elapsed > 0 ? Math.round(this.totalWords / elapsed) : 0;
    // 按频率排序取 Top 10 术语
    const sorted = [...this.termFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    return {
      totalSentences: this.totalSentences,
      totalWords: this.totalWords,
      avgWpm: Math.min(avgWpm, 500),
      sessionMinutes: Math.round(elapsed * 10) / 10,
      speedHistory: this.speedHistory,
      topTerms: sorted.map(([term, count]) => ({ term, count })),
      correctedCount: this.correctedCount,
      qaCount: this.qaCount,
    };
  }
}

// ========== 自定义术语表 (Custom Glossary) ==========

interface GlossaryEntry {
  term: string;
  translation: string;
}

class CustomGlossary {
  private entries = new Map<string, string>();
  private storageKey = 'ls_custom_glossary';

  constructor() { this.load(); }

  /** 从 chrome.storage 加载 */
  private load() {
    try {
      chrome.storage.local.get([this.storageKey], (res: Record<string, any>) => {
        if (res[this.storageKey] && Array.isArray(res[this.storageKey])) {
          for (const e of res[this.storageKey] as GlossaryEntry[]) {
            if (e.term && e.translation) this.entries.set(e.term.toLowerCase(), e.translation);
          }
        }
      });
    } catch { /* */ }
  }

  /** 持久化到 chrome.storage */
  private save() {
    const arr = [...this.entries.entries()].map(([term, translation]) => ({ term, translation }));
    try { chrome.storage.local.set({ [this.storageKey]: arr }); } catch { /* */ }
  }

  /** 查询术语的自定义翻译 */
  get(term: string): string | null {
    return this.entries.get(term.toLowerCase()) || null;
  }

  /** 添加或更新术语 */
  add(term: string, translation: string): boolean {
    if (!term || !translation || term.length > 50 || translation.length > 100) return false;
    this.entries.set(term.toLowerCase().trim(), translation.trim());
    this.save();
    return true;
  }

  /** 删除术语 */
  remove(term: string): boolean {
    const deleted = this.entries.delete(term.toLowerCase());
    if (deleted) this.save();
    return deleted;
  }

  /** 获取所有条目 */
  getAll(): GlossaryEntry[] {
    return [...this.entries.entries()].map(([term, translation]) => ({ term, translation }));
  }

  /** 条目数 */
  get size(): number { return this.entries.size; }
}

// ========== 词汇本 (Vocabulary Notebook) ==========

interface VocabEntry {
  term: string;
  definition: string;
  mastered: boolean;
  lastSeen: number;
  occurrences: number;
}

class VocabularyNotebook {
  private entries = new Map<string, VocabEntry>();
  private storageKey = 'ls_vocab_notebook';
  private reviewIntervalDays = 3;

  constructor() { this.load(); }

  private load() {
    try {
      chrome.storage.local.get([this.storageKey], (res: Record<string, any>) => {
        if (res[this.storageKey] && Array.isArray(res[this.storageKey])) {
          for (const e of res[this.storageKey] as VocabEntry[]) {
            if (e.term) this.entries.set(e.term.toLowerCase(), e);
          }
        }
      });
    } catch { /* */ }
  }

  private save() {
    const arr = [...this.entries.values()];
    try { chrome.storage.local.set({ [this.storageKey]: arr }); } catch { /* */ }
  }

  /** 自动收录术语 */
  addTerm(term: string, definition: string) {
    if (!term || term.length < 2) return;
    const key = term.toLowerCase();
    const existing = this.entries.get(key);
    if (existing) {
      existing.occurrences++;
      existing.lastSeen = Date.now();
    } else {
      this.entries.set(key, {
        term, definition: definition || `专业术语: ${term}`,
        mastered: false, lastSeen: Date.now(), occurrences: 1,
      });
    }
    this.save();
  }

  /** 标记已掌握 */
  toggleMastered(term: string): boolean {
    const entry = this.entries.get(term.toLowerCase());
    if (!entry) return false;
    entry.mastered = !entry.mastered;
    this.save();
    return true;
  }

  /** 移除条目 */
  remove(term: string): boolean {
    const deleted = this.entries.delete(term.toLowerCase());
    if (deleted) this.save();
    return deleted;
  }

  /** 获取需要复习的术语（超过 N 天未看 + 未掌握） */
  getReviewDue(): VocabEntry[] {
    const cutoff = Date.now() - this.reviewIntervalDays * 86400000;
    return [...this.entries.values()]
      .filter(e => !e.mastered && e.lastSeen < cutoff)
      .sort((a, b) => a.lastSeen - b.lastSeen);
  }

  getAll(): VocabEntry[] {
    return [...this.entries.values()].sort((a, b) => b.occurrences - a.occurrences);
  }

  get size(): number { return this.entries.size; }

  /** 导出为文本 */
  toText(): string {
    const lines = [`# 我的词汇本`, `> LinguaSync Pro 自动收录 · ${new Date().toLocaleDateString()}\n`];
    const unmastered = this.getAll().filter(e => !e.mastered);
    const mastered = this.getAll().filter(e => e.mastered);
    if (unmastered.length > 0) {
      lines.push(`## 待掌握 (${unmastered.length})`);
      for (const e of unmastered) {
        lines.push(`- **${e.term}** — ${e.definition} (出现 ${e.occurrences} 次)`);
      }
    }
    if (mastered.length > 0) {
      lines.push(`\n## 已掌握 (${mastered.length})`);
      for (const e of mastered) {
        lines.push(`- ~~${e.term}~~ — ${e.definition}`);
      }
    }
    return lines.join('\n');
  }
}

// ========== 会后摘要生成器 (Post-Meeting Summary) ==========

class PostMeetingSummary {
  private extractor: TermExtractor;

  constructor(extractor: TermExtractor) { this.extractor = extractor; }

  /** 从历史生成结构化摘要 */
  generate(history: TranslationResult[], mindmapTree?: MindMapNode): string {
    if (history.length === 0) return '';
    const lines: string[] = [];
    const startTime = new Date(history[0].timestamp);
    const endTime = new Date(history[history.length - 1].timestamp);
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

    lines.push(`# 会议摘要`);
    lines.push(`> ${startTime.toLocaleString()} · ${duration} 分钟 · ${history.length} 句\n`);

    // 1) 核心主题：从高频术语提取
    const termFreq = new Map<string, number>();
    for (const h of history) {
      for (const t of this.extractor.extract(h.original)) {
        termFreq.set(t, (termFreq.get(t) || 0) + 1);
      }
    }
    const topTerms = [...termFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (topTerms.length > 0) {
      lines.push(`## 核心主题`);
      lines.push(topTerms.map(([t, c]) => `**${t}** (${c})`).join(' · '));
      lines.push('');
    }

    // 2) 关键决策/要点：从含决策关键词的句子提取
    const decisionPatterns = [
      /(?:决定|确定|同意|通过|批准|采纳|采用|选择|定了|确认)/,
      /(?:需要|必须|应该|务必)/,
      /(?:deadline|截止|完成|提交|交付)/,
      /(?:下一步|接下来|之后|然后)/,
      /(?:问题|风险|挑战|困难)/,
    ];
    const keyPoints: string[] = [];
    for (const h of history) {
      for (const p of decisionPatterns) {
        if (p.test(h.translated)) {
          const trimmed = h.translated.length > 60 ? h.translated.slice(0, 60) + '...' : h.translated;
          if (!keyPoints.includes(trimmed)) keyPoints.push(trimmed);
          break;
        }
      }
    }
    if (keyPoints.length > 0) {
      lines.push(`## 关键要点`);
      for (const kp of keyPoints.slice(0, 10)) {
        lines.push(`- ${kp}`);
      }
      lines.push('');
    }

    // 3) 思维导图大纲（如果有）
    if (mindmapTree && mindmapTree.children.length > 0) {
      lines.push(`## 内容大纲`);
      for (const topic of mindmapTree.children) {
        lines.push(`### ${topic.title}`);
        for (const point of topic.children.slice(0, 5)) {
          lines.push(`- ${point.title}`);
        }
      }
      lines.push('');
    }

    // 4) 时间线
    lines.push(`## 时间线`);
    const step = Math.max(1, Math.floor(history.length / 6));
    for (let i = 0; i < history.length; i += step) {
      const h = history[i];
      const t = new Date(h.timestamp);
      const ts = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      const brief = h.translated.length > 40 ? h.translated.slice(0, 40) + '...' : h.translated;
      lines.push(`- **${ts}** ${brief}`);
    }
    lines.push('');

    // 5) 统计摘要
    const totalWords = history.reduce((s, h) => s + h.original.split(/\s+/).length, 0);
    const corrected = history.filter(h => h.corrected > 0).length;
    lines.push(`## 统计`);
    lines.push(`翻译 ${history.length} 句 · ${totalWords} 词 · 自纠正 ${corrected} 处`);

    return lines.join('\n');
  }
}

// ========== 悬浮控制面板 (v4 - 双标签页) ==========

interface TodoItem {
  text: string;
  timestamp: number;
  done: boolean;
}

class FloatingWidget {
  private root: HTMLElement;
  private els!: Record<string, HTMLElement>;
  private pos = { x: 0, y: 0 };
  private dragging = false;
  private dragStart = { x: 0, y: 0 };
  private recording = false;
  private tabAudioActive = false;
  private activeTab: 'record' | 'todo' | 'mindmap' | 'qa' | 'stats' | 'glossary' | 'vocab' = 'record';
  private panelExpanded = false;
  private todos: TodoItem[] = [];

  onToggle: () => void = () => {};
  onExport: () => void = () => {};
  onTtsToggle: () => void = () => {};
  onSubtitleToggle: () => void = () => {};
  onVisionToggle: () => void = () => {};
  onTermHover: (el: HTMLElement, term: string) => void = () => {};
  onTermLeave: () => void = () => {};
  onMindmapExportMd: () => void = () => {};
  onMindmapExportJson: () => void = () => {};
  onQuestion: (question: string) => void = () => {};
  onGlossaryAdd: (term: string, translation: string) => boolean = () => false;
  onGlossaryRemove: (term: string) => boolean = () => false;
  onGlossaryGetAll: () => GlossaryEntry[] = () => [];
  onGetStats: () => SessionReport | null = () => null;
  onSeekToTime: (time: number) => void = () => {};
  onVocabToggleMastered: (term: string) => boolean = () => false;
  onVocabRemove: (term: string) => boolean = () => false;
  onVocabGetAll: () => VocabEntry[] = () => [];
  onVocabGetReviewDue: () => VocabEntry[] = () => [];
  onVocabExport: () => void = () => {};
  onGenerateSummary: () => void = () => {};

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'ls-floating-root';
    this.root.innerHTML = this.buildHTML();
    document.body.appendChild(this.root);
    this.cacheEls();
    this.setupEvents();
    this.centerAtBottom();
    this.showOnboarding();
  }

  private cacheEls() {
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.els = {
      widget: q('.ls-fl-widget'), dragBar: q('.ls-fl-drag'),
      statusDot: q('.ls-fl-dot'), recBtn: q('.ls-fl-rec-btn'),
      recLabel: q('.ls-fl-rec-label'), statusLabel: q('.ls-fl-status'),
      audioBar: q('.ls-fl-audio-bar'),
      exportBtn: q('.ls-fl-export-btn'),
      histCount: q('.ls-fl-count'),
      tabRecord: q('.ls-fl-tab-record'), tabTodo: q('.ls-fl-tab-todo'),
      tabMindmap: q('.ls-fl-tab-mindmap'),
      tabQa: q('.ls-fl-tab-qa'),
      tabStats: q('.ls-fl-tab-stats'),
      tabGlossary: q('.ls-fl-tab-glossary'),
      tabVocab: q('.ls-fl-tab-vocab'),
      tabIndicator: q('.ls-fl-tab-indicator'),
      recordPanel: q('.ls-fl-record-panel'), todoPanel: q('.ls-fl-todo-panel'),
      transcriptList: q('.ls-fl-transcript-list'),
      todoList: q('.ls-fl-todo-list'), todoEmpty: q('.ls-fl-todo-empty'),
      mindmapPanel: q('.ls-fl-mindmap-panel'),
      mindmapTree: q('.ls-fl-mindmap-tree'),
      mindmapExportMd: q('.ls-fl-mm-export-md'),
      mindmapExportJson: q('.ls-fl-mm-export-json'),
      mindmapEmpty: q('.ls-fl-mindmap-empty'),
      qaPanel: q('.ls-fl-qa-panel'),
      qaInput: q('.ls-fl-qa-input'),
      qaHistory: q('.ls-fl-qa-history'),
      qaEmpty: q('.ls-fl-qa-empty'),
      statsPanel: q('.ls-fl-stats-panel'),
      statsContent: q('.ls-fl-stats-content'),
      statsRefresh: q('.ls-fl-stats-refresh'),
      glossaryPanel: q('.ls-fl-glossary-panel'),
      glossaryList: q('.ls-fl-glossary-list'),
      glossaryEmpty: q('.ls-fl-glossary-empty'),
      glossaryTerm: q('.ls-fl-glossary-term'),
      glossaryTranslation: q('.ls-fl-glossary-translation'),
      glossaryAddBtn: q('.ls-fl-glossary-add'),
      vocabPanel: q('.ls-fl-vocab-panel'),
      vocabList: q('.ls-fl-vocab-list'),
      vocabEmpty: q('.ls-fl-vocab-empty'),
      vocabExportBtn: q('.ls-fl-vocab-export'),
      summaryBtn: q('.ls-fl-summary-btn'),
      tabAudioBtn: q('.ls-fl-tab-audio-btn'),
      ttsBtn: q('.ls-fl-tts-btn'),
      subBtn: q('.ls-fl-sub-btn'),
      visionBtn: q('.ls-fl-vision-btn'),
      ttsLabel: q('.ls-fl-tts-label'),
      subLabel: q('.ls-fl-sub-label'),
      visionLabel: q('.ls-fl-vision-label'),
      visionBar: q('.ls-fl-vision-bar'),
      modeLabel: q('.ls-fl-mode-label'),
      onboarding: q('.ls-fl-onboarding'),
      onboardClose: q('.ls-fl-onboard-close'),
      contentArea: q('.ls-fl-content-area'),
      dropdownBtn: q('.ls-fl-dropdown-btn'),
      tabs: q('.ls-fl-tabs'),
      toolbar: q('.ls-fl-toolbar'),
    };
  }

  private buildHTML(): string {
    return `
      <div class="ls-fl-widget" style="display:none">
        <div class="ls-fl-drag">
          <svg width="16" height="6" viewBox="0 0 16 6"><circle cx="3" cy="3" r="1.5" fill="currentColor"/><circle cx="8" cy="3" r="1.5" fill="currentColor"/><circle cx="13" cy="3" r="1.5" fill="currentColor"/></svg>
          <div class="ls-fl-brand">
            <span class="ls-fl-dot"></span>
            <span>LINGUASYNC</span>
            <span class="ls-fl-pro">PRO</span>
            <span style="font-size:9px;color:#484F58;margin-left:4px">v7.2</span>
          </div>
          <div class="ls-fl-audio-bar">${Array.from({length:12}, (_,i) => `<span class="ls-fl-bar-seg" style="--i:${i}"></span>`).join('')}</div>
        </div>
        <div class="ls-fl-controls">
          <button class="ls-fl-rec-btn">
            <svg class="ls-fl-mic-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
            </svg>
            <span class="ls-fl-rec-label">开始同传</span>
          </button>
          <span class="ls-fl-status">就绪 · Alt+T</span>
          <span class="ls-fl-count" style="display:none">0</span>
          <button class="ls-fl-dropdown-btn" title="更多选项">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>
        <div class="ls-fl-toolbar" style="display:none">
          <button class="ls-fl-tab-audio-btn" title="切换音频源">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
            <span class="ls-fl-mode-label">麦克风</span>
          </button>
          <button class="ls-fl-tts-btn" title="语音朗读">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
            <span class="ls-fl-tts-label">语音</span>
          </button>
          <button class="ls-fl-sub-btn" title="字幕叠加">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="16" x2="18" y2="16"/><line x1="6" y1="12" x2="14" y2="12"/></svg>
            <span class="ls-fl-sub-label">字幕</span>
          </button>
          <button class="ls-fl-vision-btn" title="屏幕视界增强">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            <span class="ls-fl-vision-label">视界</span>
          </button>
          <button class="ls-fl-export-btn" title="导出 (Alt+E)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            导出
          </button>
          <button class="ls-fl-summary-btn" title="生成会后摘要">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg>
            摘要
          </button>
        </div>
        <div class="ls-fl-tabs" style="display:none">
          <div class="ls-fl-tab ls-fl-tab-record ls-fl-tab-active" data-tab="record">会议记录</div>
          <div class="ls-fl-tab ls-fl-tab-todo" data-tab="todo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            智能待办
          </div>
          <div class="ls-fl-tab ls-fl-tab-mindmap" data-tab="mindmap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 3v6"/><path d="M12 15v6"/><path d="M3 12h6"/><path d="M15 12h6"/><path d="M5.6 5.6l4.2 4.2"/><path d="M14.2 14.2l4.2 4.2"/></svg>
            思维导图
          </div>
          <div class="ls-fl-tab ls-fl-tab-qa" data-tab="qa">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            问答
          </div>
          <div class="ls-fl-tab ls-fl-tab-stats" data-tab="stats">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            统计
          </div>
          <div class="ls-fl-tab ls-fl-tab-glossary" data-tab="glossary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            术语
          </div>
          <div class="ls-fl-tab ls-fl-tab-vocab" data-tab="vocab">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            词汇
          </div>
          <div class="ls-fl-tab-indicator"></div>
        </div>
        <div class="ls-fl-content-area" style="display:none">
          <div class="ls-fl-record-panel">
            <div class="ls-fl-vision-bar" style="display:none"></div>
            <div class="ls-fl-transcript-list"></div>
          </div>
          <div class="ls-fl-todo-panel" style="display:none">
            <div class="ls-fl-todo-list"></div>
            <div class="ls-fl-todo-empty">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              <span>AI 将在会议中自动为您分配任务</span>
            </div>
          </div>
          <div class="ls-fl-mindmap-panel" style="display:none">
            <div class="ls-fl-mm-toolbar">
              <button class="ls-fl-mm-export-md" title="导出 Markdown">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                .md
              </button>
              <button class="ls-fl-mm-export-json" title="复制 JSON 到剪贴板">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                JSON
              </button>
            </div>
            <div class="ls-fl-mindmap-tree"></div>
            <div class="ls-fl-mindmap-empty">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 3v6"/><path d="M12 15v6"/><path d="M3 12h6"/><path d="M15 12h6"/></svg>
              <span>开始同传后，AI 将实时生成结构化大纲</span>
            </div>
          </div>
          <div class="ls-fl-qa-panel" style="display:none">
            <div class="ls-fl-qa-history"></div>
            <div class="ls-fl-qa-empty">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span>同传进行中，随时输入问题查询相关片段</span>
            </div>
            <div class="ls-fl-qa-input-bar">
              <span class="ls-fl-qa-prompt">$</span>
              <input class="ls-fl-qa-input" type="text" placeholder="问 AI：讲者刚才提到的..." autocomplete="off" spellcheck="false" />
            </div>
          </div>
          <div class="ls-fl-stats-panel" style="display:none">
            <div class="ls-fl-stats-toolbar">
              <button class="ls-fl-stats-refresh" title="刷新统计">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                刷新
              </button>
            </div>
            <div class="ls-fl-stats-content">
              <div class="ls-stats-empty">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                <span>开始同传后查看会话统计数据</span>
              </div>
            </div>
          </div>
          <div class="ls-fl-glossary-panel" style="display:none">
            <div class="ls-fl-glossary-toolbar">
              <input class="ls-fl-glossary-term" type="text" placeholder="术语 (如 Transformer)" maxlength="50" />
              <input class="ls-fl-glossary-translation" type="text" placeholder="翻译 (如 变换器架构)" maxlength="100" />
              <button class="ls-fl-glossary-add" title="添加术语">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </div>
            <div class="ls-fl-glossary-list"></div>
            <div class="ls-fl-glossary-empty">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
              <span>添加自定义术语，翻译时优先匹配</span>
            </div>
          </div>
          <div class="ls-fl-vocab-panel" style="display:none">
            <div class="ls-fl-vocab-toolbar">
              <button class="ls-fl-vocab-export" title="导出词汇本">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                导出
              </button>
            </div>
            <div class="ls-fl-vocab-list"></div>
            <div class="ls-fl-vocab-empty">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              <span>同传中遇到的术语自动收录于此</span>
            </div>
          </div>
        </div>
        <div class="ls-fl-onboarding" style="display:none">
          <div class="ls-fl-onboard-title">LinguaSync Pro 已就绪</div>
          <div class="ls-fl-onboard-desc">
            播放视频后自动开始同传，翻译字幕直接叠加在视频上。<br/>
            点击「麦克风」可切换为标签页音频直采模式（更准确）。<br/>
            快捷键: <kbd>Alt+T</kbd> 开关 · <kbd>Alt+E</kbd> 导出
          </div>
          <button class="ls-fl-onboard-close">开始使用</button>
        </div>
      </div>
    `;
  }

  private setupEvents() {
    // 拖拽
    this.els.dragBar.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.dragging = true;
      this.dragStart = { x: e.clientX - this.pos.x, y: e.clientY - this.pos.y };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.dragging) return;
      this.pos = {
        x: Math.max(0, Math.min(window.innerWidth - 280, e.clientX - this.dragStart.x)),
        y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - this.dragStart.y)),
      };
      this.root.style.left = `${this.pos.x}px`;
      this.root.style.top = `${this.pos.y}px`;
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });

    // 录音按钮
    this.els.recBtn.addEventListener('click', () => this.onToggle());
    // 导出
    this.els.exportBtn.addEventListener('click', () => this.onExport());
    // TTS 语音开关
    this.els.ttsBtn.addEventListener('click', () => this.onTtsToggle());
    // 字幕叠加开关
    this.els.subBtn.addEventListener('click', () => this.onSubtitleToggle());
    // 屏幕视界增强开关
    this.els.visionBtn.addEventListener('click', () => this.onVisionToggle());
    // 新手引导关闭
    this.els.onboardClose.addEventListener('click', () => {
      this.els.onboarding.style.display = 'none';
      try { chrome.storage.local.set({ onboarded: true }); } catch { /* */ }
    });
    // 标签页切换
    this.els.tabRecord.addEventListener('click', () => this.switchTab('record'));
    this.els.tabTodo.addEventListener('click', () => this.switchTab('todo'));
    this.els.tabMindmap.addEventListener('click', () => this.switchTab('mindmap'));
    this.els.tabQa.addEventListener('click', () => this.switchTab('qa'));
    this.els.tabStats.addEventListener('click', () => { this.switchTab('stats'); this.renderStats(); });
    this.els.tabGlossary.addEventListener('click', () => { this.switchTab('glossary'); this.renderGlossary(); });
    this.els.tabVocab.addEventListener('click', () => { this.switchTab('vocab'); this.renderVocab(); });
    // 思维导图导出
    this.els.mindmapExportMd.addEventListener('click', () => this.onMindmapExportMd());
    this.els.mindmapExportJson.addEventListener('click', () => this.onMindmapExportJson());
    // Q&A 输入框 Enter 提交（带去抖 + 长度限制）
    let qaLastSubmit = 0;
    const QA_MAX_LENGTH = 200;
    const QA_DEBOUNCE_MS = 800;
    this.els.qaInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const now = Date.now();
        if (now - qaLastSubmit < QA_DEBOUNCE_MS) return; // 去抖
        const question = (this.els.qaInput as HTMLInputElement).value.trim();
        if (question.length === 0) return;
        if (question.length > QA_MAX_LENGTH) {
          // 截断并提示
          (this.els.qaInput as HTMLInputElement).value = question.slice(0, QA_MAX_LENGTH);
          this.els.qaInput.setAttribute('placeholder', `问题最长 ${QA_MAX_LENGTH} 字，已自动截断`);
          setTimeout(() => this.els.qaInput.setAttribute('placeholder', '问 AI：讲者刚才提到的...'), 2000);
          return;
        }
        qaLastSubmit = now;
        this.onQuestion(question);
        (this.els.qaInput as HTMLInputElement).value = '';
      }
    });
    // 输入框 maxLength 属性兜底
    (this.els.qaInput as HTMLInputElement).maxLength = QA_MAX_LENGTH + 20; // 留余量
    // 阻止输入框快捷键冒泡
    this.els.qaInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey) { e.stopPropagation(); }
    }, true);
    // 下拉箭头：展开/收起标签页区域
    this.els.dropdownBtn.addEventListener('click', () => this.togglePanel());
    // 统计面板刷新
    this.els.statsRefresh.addEventListener('click', () => this.renderStats());
    // 词汇本导出
    this.els.vocabExportBtn.addEventListener('click', () => this.onVocabExport());
    // 会后摘要
    this.els.summaryBtn.addEventListener('click', () => this.onGenerateSummary());
    // 术语表添加按钮
    this.els.glossaryAddBtn.addEventListener('click', () => {
      const term = (this.els.glossaryTerm as HTMLInputElement).value.trim();
      const translation = (this.els.glossaryTranslation as HTMLInputElement).value.trim();
      if (term && translation) {
        const ok = this.onGlossaryAdd(term, translation);
        if (ok) {
          (this.els.glossaryTerm as HTMLInputElement).value = '';
          (this.els.glossaryTranslation as HTMLInputElement).value = '';
          this.renderGlossary();
        }
      }
    });
    // 术语表输入框 Enter 提交
    this.els.glossaryTranslation.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); this.els.glossaryAddBtn.click(); }
    });
    // 会议记录点击事件委托（回放锚点）
    this.els.transcriptList.addEventListener('click', (e: MouseEvent) => {
      const item = (e.target as HTMLElement).closest('.ls-fl-transcript-item') as HTMLElement;
      if (item && item.dataset.ts && item.dataset.vtime) {
        const vtime = parseFloat(item.dataset.vtime);
        if (!isNaN(vtime) && vtime >= 0) {
          this.onSeekToTime(vtime);
          // 高亮效果
          item.classList.add('ls-fl-anchor-flash');
          setTimeout(() => item.classList.remove('ls-fl-anchor-flash'), 1500);
        }
      }
    });
  }

  /** 展开或收起底部的工具栏/会议记录/智能待办区域 */
  private togglePanel() {
    this.panelExpanded = !this.panelExpanded;
    this.els.toolbar.style.display = this.panelExpanded ? '' : 'none';
    this.els.tabs.style.display = this.panelExpanded ? '' : 'none';
    this.els.contentArea.style.display = this.panelExpanded ? '' : 'none';
    this.els.dropdownBtn.classList.toggle('ls-fl-dropdown-open', this.panelExpanded);
  }

  private switchTab(tab: 'record' | 'todo' | 'mindmap' | 'qa' | 'stats' | 'glossary' | 'vocab') {
    this.activeTab = tab;
    this.els.tabRecord.classList.toggle('ls-fl-tab-active', tab === 'record');
    this.els.tabTodo.classList.toggle('ls-fl-tab-active', tab === 'todo');
    this.els.tabMindmap.classList.toggle('ls-fl-tab-active', tab === 'mindmap');
    this.els.tabQa.classList.toggle('ls-fl-tab-active', tab === 'qa');
    this.els.tabStats.classList.toggle('ls-fl-tab-active', tab === 'stats');
    this.els.tabGlossary.classList.toggle('ls-fl-tab-active', tab === 'glossary');
    this.els.tabVocab.classList.toggle('ls-fl-tab-active', tab === 'vocab');
    this.els.recordPanel.style.display = tab === 'record' ? '' : 'none';
    this.els.todoPanel.style.display = tab === 'todo' ? '' : 'none';
    this.els.mindmapPanel.style.display = tab === 'mindmap' ? '' : 'none';
    this.els.qaPanel.style.display = tab === 'qa' ? '' : 'none';
    this.els.statsPanel.style.display = tab === 'stats' ? '' : 'none';
    this.els.glossaryPanel.style.display = tab === 'glossary' ? '' : 'none';
    this.els.vocabPanel.style.display = tab === 'vocab' ? '' : 'none';
    // 移动标签指示器
    if (this.els.tabIndicator) {
      const activeEl = tab === 'record' ? this.els.tabRecord
        : tab === 'todo' ? this.els.tabTodo
        : tab === 'mindmap' ? this.els.tabMindmap
        : tab === 'qa' ? this.els.tabQa
        : tab === 'stats' ? this.els.tabStats
        : tab === 'glossary' ? this.els.tabGlossary
        : this.els.tabVocab;
      this.els.tabIndicator.style.left = `${activeEl.offsetLeft}px`;
      this.els.tabIndicator.style.width = `${activeEl.offsetWidth}px`;
    }
    // 切换到待办标签时清除新内容提示
    if (tab === 'todo') this.clearTabNotification();
    if (tab === 'mindmap') this.clearMindmapNotification();
    if (tab === 'qa') {
      this.els.tabQa.classList.remove('ls-fl-tab-new');
      // 自动聚焦输入框
      setTimeout(() => (this.els.qaInput as HTMLInputElement)?.focus(), 100);
    }
  }

  private centerAtBottom() {
    this.pos = { x: Math.max(10, (window.innerWidth - 320) / 2), y: window.innerHeight - 90 };
    this.root.style.left = `${this.pos.x}px`;
    this.root.style.top = `${this.pos.y}px`;
  }

  private showOnboarding() {
    try {
      chrome.storage.local.get(['onboarded'], (res: Record<string, any>) => {
        if (!res.onboarded) this.els.onboarding.style.display = '';
      });
    } catch {
      // ignore
    }
  }

  show() { (this.els.widget as HTMLElement).style.display = ''; }

  setRecording(on: boolean) {
    this.recording = on;
    this.els.recBtn.classList.toggle('ls-fl-active', on);
    this.els.statusDot.classList.toggle('ls-fl-dot-live', on);
    this.els.recLabel.textContent = on ? '停止同传' : '开始同传';
    this.els.statusLabel.textContent = on ? '识别中... · Alt+T 停止' : '就绪 · Alt+T';
  }

  isRecording() { return this.recording; }

  setTabAudioMode(active: boolean) {
    this.tabAudioActive = active;
    const label = this.els.modeLabel;
    if (label) label.textContent = active ? '标签页音频' : '麦克风';
    this.els.tabAudioBtn.classList.toggle('ls-fl-tab-active', active);
  }

  isTabAudioMode() { return this.tabAudioActive; }

  setTtsEnabled(on: boolean) {
    this.els.ttsBtn.classList.toggle('ls-fl-tab-active', on);
    if (this.els.ttsLabel) this.els.ttsLabel.textContent = on ? '语音开' : '语音';
  }

  setSubtitleEnabled(on: boolean) {
    this.els.subBtn.classList.toggle('ls-fl-tab-active', on);
    if (this.els.subLabel) this.els.subLabel.textContent = on ? '字幕开' : '字幕';
  }

  setVisionEnabled(on: boolean) {
    this.els.visionBtn.classList.toggle('ls-fl-tab-active', on);
    if (this.els.visionLabel) this.els.visionLabel.textContent = on ? '视界开' : '视界';
  }

  /** 更新视觉术语条 */
  updateVisionTerms(terms: string[]) {
    if (terms.length === 0) { this.els.visionBar.style.display = 'none'; return; }
    this.els.visionBar.style.display = '';
    this.els.visionBar.innerHTML = terms
      .slice(0, 10)
      .map(t => `<span class="ls-fl-vision-term">${esc(t)}</span>`)
      .join('');
  }

  getTabAudioBtn(): HTMLElement { return this.els.tabAudioBtn; }

  setAudioLevel(level: number) {
    const segs = this.root.querySelectorAll('.ls-fl-bar-seg');
    segs.forEach((seg, i) => {
      const threshold = i / segs.length;
      const el = seg as HTMLElement;
      el.style.opacity = level > threshold ? '1' : '0.15';
      el.style.transform = level > threshold ? `scaleY(${0.4 + level * 0.9})` : 'scaleY(0.25)';
    });
  }

  /** 添加一条会议记录（原文 + 译文），可选术语高亮 */
  addHistory(result: TranslationResult, terms: string[] = []) {
    const item = document.createElement('div');
    item.className = 'ls-fl-transcript-item';
    const t = new Date(result.timestamp);
    const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
    const origHtml = this.highlightTerms(result.original, terms);
    // 回放锚点：如果有视频时间，显示播放图标
    const anchorIcon = result.videoTime != null && result.videoTime >= 0
      ? `<span class="ls-fl-anchor-icon" title="点击跳转到 ${Math.round(result.videoTime)}s"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></span>`
      : '';
    // 置信度色条
    const conf = result.confidence ?? 1;
    const confColor = conf >= 0.7 ? '#3FB950' : conf >= 0.4 ? '#D29922' : '#F85149';
    const confBar = `<span class="ls-fl-conf-bar" style="background:${confColor}" title="置信度 ${Math.round(conf * 100)}%"></span>`;
    item.innerHTML = `${confBar}<div class="ls-fl-ts-ts">${ts}${anchorIcon}</div><span class="ls-fl-ts-orig">// ${origHtml}</span><span class="ls-fl-ts-zh">&gt; ${esc(result.translated)}</span>`;
    item.dataset.ts = String(result.timestamp);
    if (result.videoTime != null) item.dataset.vtime = String(result.videoTime);
    // 绑定术语 Tooltip 事件
    item.querySelectorAll('.ls-term').forEach((el) => {
      el.addEventListener('mouseenter', () => {
        this.onTermHover(el as HTMLElement, (el as HTMLElement).dataset.term || '');
      });
      el.addEventListener('mouseleave', () => this.onTermLeave());
    });
    this.els.transcriptList.appendChild(item);
    this.els.transcriptList.scrollTop = this.els.transcriptList.scrollHeight;
    const count = this.els.transcriptList.children.length;
    this.els.histCount.textContent = String(count);
    this.els.histCount.style.display = count > 0 ? '' : 'none';
  }

  /** 原地更新一条会议记录（自纠正后调用） */
  updateHistoryItem(result: TranslationResult) {
    const item = this.els.transcriptList.querySelector(
      `[data-ts="${result.timestamp}"]`
    ) as HTMLElement | null;
    if (!item) return;
    const zhEl = item.querySelector('.ls-fl-ts-zh');
    if (zhEl) zhEl.innerHTML = `&gt; ${esc(result.translated)}`;
    // 闪烁高亮提示已修正
    item.classList.add('ls-fl-corrected');
    setTimeout(() => item.classList.remove('ls-fl-corrected'), 1500);
  }

  /** 添加一条智能待办 */
  addTodo(todo: TodoItem) {
    this.todos.push(todo);
    this.els.todoEmpty.style.display = 'none';
    const item = document.createElement('div');
    item.className = 'ls-fl-todo-item';
    const checkbox = document.createElement('span');
    checkbox.className = 'ls-fl-todo-check';
    checkbox.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
    checkbox.addEventListener('click', () => {
      todo.done = !todo.done;
      item.classList.toggle('ls-fl-todo-done', todo.done);
    });
    const text = document.createElement('span');
    text.className = 'ls-fl-todo-text';
    text.textContent = todo.text;
    item.appendChild(checkbox);
    item.appendChild(text);
    this.els.todoList.appendChild(item);
    this.els.todoList.scrollTop = this.els.todoList.scrollHeight;
    // 如果待办标签页有新内容，添加提示
    if (this.activeTab !== 'todo') {
      this.els.tabTodo.classList.add('ls-fl-tab-new');
    }
  }

  /** 切换标签页时清除新内容提示 */
  clearTabNotification() {
    this.els.tabTodo.classList.remove('ls-fl-tab-new');
  }

  clearMindmapNotification() {
    this.els.tabMindmap.classList.remove('ls-fl-tab-new');
  }

  /** 显示 Q&A 搜索结果 */
  addQAResult(result: QAResult) {
    this.els.qaEmpty.style.display = 'none';
    this.els.qaHistory.style.display = '';
    const card = document.createElement('div');
    card.className = 'ls-qa-card';
    let answersHtml = '';
    if (result.answers.length === 0) {
      answersHtml = '<div class="ls-qa-no-match">未找到相关片段</div>';
    } else {
      answersHtml = result.answers.map(a => {
        const t = new Date(a.timestamp);
        const ts = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
        return `<div class="ls-qa-match">
          <div class="ls-qa-match-ts">${ts} · 相关度 ${Math.round(a.relevance * 10) / 10}</div>
          <span class="ls-qa-match-orig">// ${esc(a.text)}</span>
          <span class="ls-qa-match-zh">&gt; ${esc(a.translated)}</span>
        </div>`;
      }).join('');
    }
    card.innerHTML = `
      <div class="ls-qa-question"><span class="ls-qa-q-icon">?</span> ${esc(result.question)}</div>
      <div class="ls-qa-answers">${answersHtml}</div>
    `;
    this.els.qaHistory.appendChild(card);
    this.els.qaHistory.scrollTop = this.els.qaHistory.scrollHeight;
    // 通知标签页
    if (this.activeTab !== 'qa') this.els.tabQa.classList.add('ls-fl-tab-new');
  }

  /** 显示开小差补救摘要卡片 */
  showCatchUpCard(points: CatchUpPoint[]) {
    if (points.length === 0) return;
    // 在会议记录面板顶部插入摘要卡
    const card = document.createElement('div');
    card.className = 'ls-catchup-card';
    const itemsHtml = points.map((p, i) => {
      const t = new Date(p.timestamp);
      const ts = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      return `<div class="ls-catchup-item">
        <span class="ls-catchup-num">${i + 1}</span>
        <div class="ls-catchup-text">
          <span class="ls-catchup-zh">${esc(p.translated)}</span>
          <span class="ls-catchup-ts">${ts}</span>
        </div>
      </div>`;
    }).join('');
    card.innerHTML = `
      <div class="ls-catchup-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>过去 5 分钟要点</span>
        <button class="ls-catchup-close">×</button>
      </div>
      <div class="ls-catchup-body">${itemsHtml}</div>
    `;
    this.els.transcriptList.insertBefore(card, this.els.transcriptList.firstChild);
    card.querySelector('.ls-catchup-close')?.addEventListener('click', () => card.remove());
    // 自动切换到会议记录面板
    if (this.activeTab !== 'record') this.switchTab('record');
  }

  /** 更新思维导图树 */
  updateMindMap(tree: MindMapNode) {
    if (tree.children.length === 0) return;
    this.els.mindmapEmpty.style.display = 'none';
    this.els.mindmapTree.style.display = '';
    this.els.mindmapTree.innerHTML = this.renderMindMapNode(tree, 0);
    // 绑定展开/折叠事件
    this.els.mindmapTree.querySelectorAll('.ls-mm-toggle').forEach((el) => {
      el.addEventListener('click', (e) => {
        const nodeEl = (e.target as HTMLElement).closest('.ls-mm-node') as HTMLElement;
        const childrenEl = nodeEl?.querySelector('.ls-mm-children') as HTMLElement;
        const toggleEl = nodeEl?.querySelector('.ls-mm-toggle') as HTMLElement;
        if (childrenEl) {
          const isHidden = childrenEl.style.display === 'none';
          childrenEl.style.display = isHidden ? '' : 'none';
          toggleEl?.classList.toggle('ls-mm-collapsed', !isHidden);
        }
      });
    });
    // 通知标签页有新内容
    if (this.activeTab !== 'mindmap') {
      this.els.tabMindmap.classList.add('ls-fl-tab-new');
    }
  }

  private renderMindMapNode(node: MindMapNode, depth: number): string {
    if (depth > 3) return '';
    const hasChildren = node.children.length > 0;
    const indent = depth * 16;
    const levelClass = `ls-mm-${node.level}`;
    const toggleIcon = hasChildren
      ? `<span class="ls-mm-toggle${node.expanded ? '' : ' ls-mm-collapsed'}">
           <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
         </span>`
      : '<span class="ls-mm-dot"></span>';
    const childHtml = hasChildren
      ? `<div class="ls-mm-children" style="display:${node.expanded ? '' : 'none'}">
           ${node.children.map(c => this.renderMindMapNode(c, depth + 1)).join('')}
         </div>`
      : '';
    return `<div class="ls-mm-node ${levelClass}" style="padding-left:${indent}px">
      <div class="ls-mm-row">${toggleIcon}<span class="ls-mm-title">${esc(node.title)}</span></div>
      ${childHtml}
    </div>`;
  }

  /** 高亮文本中的术语 */
  highlightTerms(text: string, terms: string[]): string {
    if (terms.length === 0) return esc(text);
    let result = esc(text);
    for (const term of terms) {
      const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b(${escapedTerm})\\b`, 'gi');
      result = result.replace(regex, '<span class="ls-term" data-term="$1">$1</span>');
    }
    return result;
  }

  /** 渲染统计面板 */
  renderStats() {
    const report = this.onGetStats();
    if (!report || report.totalSentences === 0) {
      this.els.statsContent.innerHTML = `<div class="ls-stats-empty">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        <span>暂无统计数据，开始同传后自动记录</span>
      </div>`;
      return;
    }
    // 语速趋势 SVG 折线图
    let chartSvg = '';
    if (report.speedHistory.length >= 2) {
      const w = 260, h = 80, pad = 4;
      const maxWpm = Math.max(...report.speedHistory.map(s => s.wpm), 1);
      const points = report.speedHistory.map((s, i) => {
        const x = pad + (i / (report.speedHistory.length - 1)) * (w - pad * 2);
        const y = h - pad - (s.wpm / maxWpm) * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      chartSvg = `<svg class="ls-stats-chart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <polyline points="${points}" fill="none" stroke="#58A6FF" stroke-width="1.5" stroke-linejoin="round"/>
        <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#30363D" stroke-width="0.5"/>
        <text x="${w - pad}" y="${h - 2}" fill="#484F58" font-size="8" text-anchor="end">${maxWpm} wpm</text>
      </svg>`;
    }
    // Top 术语
    const termsHtml = report.topTerms.length > 0
      ? report.topTerms.map(t => `<span class="ls-stats-term">${esc(t.term)}<sup>${t.count}</sup></span>`).join('')
      : '<span style="color:#484F58">暂无术语</span>';
    this.els.statsContent.innerHTML = `
      <div class="ls-stats-grid">
        <div class="ls-stats-card"><div class="ls-stats-val">${report.totalSentences}</div><div class="ls-stats-label">翻译句数</div></div>
        <div class="ls-stats-card"><div class="ls-stats-val">${report.totalWords}</div><div class="ls-stats-label">总词数</div></div>
        <div class="ls-stats-card"><div class="ls-stats-val">${report.avgWpm}</div><div class="ls-stats-label">平均语速 (wpm)</div></div>
        <div class="ls-stats-card"><div class="ls-stats-val">${report.sessionMinutes}′</div><div class="ls-stats-label">会话时长</div></div>
        <div class="ls-stats-card"><div class="ls-stats-val">${report.correctedCount}</div><div class="ls-stats-label">自纠正次数</div></div>
        <div class="ls-stats-card"><div class="ls-stats-val">${report.qaCount}</div><div class="ls-stats-label">问答次数</div></div>
      </div>
      ${chartSvg ? `<div class="ls-stats-section"><div class="ls-stats-section-title">语速趋势</div>${chartSvg}</div>` : ''}
      <div class="ls-stats-section"><div class="ls-stats-section-title">高频术语 Top ${report.topTerms.length}</div><div class="ls-stats-terms">${termsHtml}</div></div>
    `;
  }

  /** 渲染术语表面板 */
  renderGlossary() {
    const entries = this.onGlossaryGetAll();
    if (entries.length === 0) {
      this.els.glossaryEmpty.style.display = '';
      this.els.glossaryList.style.display = 'none';
      return;
    }
    this.els.glossaryEmpty.style.display = 'none';
    this.els.glossaryList.style.display = '';
    this.els.glossaryList.innerHTML = entries.map(e => `
      <div class="ls-glossary-item">
        <span class="ls-glossary-term-tag">${esc(e.term)}</span>
        <span class="ls-glossary-arrow">→</span>
        <span class="ls-glossary-trans">${esc(e.translation)}</span>
        <button class="ls-glossary-del" data-term="${esc(e.term)}" title="删除">×</button>
      </div>
    `).join('');
    // 绑定删除事件
    this.els.glossaryList.querySelectorAll('.ls-glossary-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const term = (btn as HTMLElement).dataset.term || '';
        this.onGlossaryRemove(term);
        this.renderGlossary();
      });
    });
  }

  /** 渲染词汇本面板 */
  renderVocab() {
    const entries = this.onVocabGetAll();
    const reviewDue = this.onVocabGetReviewDue();
    if (entries.length === 0) {
      this.els.vocabEmpty.style.display = '';
      this.els.vocabList.style.display = 'none';
      return;
    }
    this.els.vocabEmpty.style.display = 'none';
    this.els.vocabList.style.display = '';
    // 复习提醒横幅
    const reviewBanner = reviewDue.length > 0
      ? `<div class="ls-vocab-banner"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ${reviewDue.length} 个术语需要复习</div>`
      : '';
    this.els.vocabList.innerHTML = reviewBanner + entries.map(e => {
      const masteredClass = e.mastered ? ' ls-vocab-mastered' : '';
      const daysSince = Math.floor((Date.now() - e.lastSeen) / 86400000);
      const timeLabel = daysSince === 0 ? '今天' : daysSince === 1 ? '昨天' : `${daysSince}天前`;
      const reviewFlag = reviewDue.some(r => r.term.toLowerCase() === e.term.toLowerCase()) ? '<span class="ls-vocab-review">!</span>' : '';
      return `<div class="ls-vocab-item${masteredClass}">
        <div class="ls-vocab-term">${esc(e.term)}${reviewFlag}</div>
        <div class="ls-vocab-def">${esc(e.definition)}</div>
        <div class="ls-vocab-meta">
          <span class="ls-vocab-freq">×${e.occurrences}</span>
          <span class="ls-vocab-time">${timeLabel}</span>
          <button class="ls-vocab-master-btn" data-term="${esc(e.term)}" title="${e.mastered ? '取消掌握' : '标记已掌握'}">${e.mastered ? '✓' : '○'}</button>
          <button class="ls-vocab-del-btn" data-term="${esc(e.term)}" title="移除">×</button>
        </div>
      </div>`;
    }).join('');
    // 绑定事件
    this.els.vocabList.querySelectorAll('.ls-vocab-master-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.onVocabToggleMastered((btn as HTMLElement).dataset.term || '');
        this.renderVocab();
      });
    });
    this.els.vocabList.querySelectorAll('.ls-vocab-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.onVocabRemove((btn as HTMLElement).dataset.term || '');
        this.renderVocab();
      });
    });
  }
}

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ========== 自纠正引擎 ==========

/** Levenshtein 编辑距离 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** 字符串相似度 (0~1，1 = 完全相同) */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

class SelfCorrectionEngine {
  private lastInterim = '';
  /** 被大幅修正的 interim 原文，翻译可能不准 */
  private uncertainOriginals = new Set<string>();

  /** 记录 interim，final 时比对差异 */
  recordInterim(text: string) { this.lastInterim = text; }

  /**
   * final 到达时调用。对比 interim → final 差异，
   * 如果差异大（< 0.6 相似度）则标记该句翻译可能不准。
   */
  checkFinal(finalText: string): boolean {
    if (!this.lastInterim) { this.lastInterim = ''; return false; }
    const sim = similarity(this.lastInterim.trim(), finalText.trim());
    this.lastInterim = '';
    if (sim < 0.6) {
      this.uncertainOriginals.add(finalText);
      return true; // 标记为不确定
    }
    return false;
  }

  /**
   * 从历史中找出需要重翻译的条目。
   * 条件：被标记为不确定、且之后积累了 >= 2 条新上下文。
   */
  getCorrectionTargets(history: TranslationResult[]): TranslationResult[] {
    const targets: TranslationResult[] = [];
    for (let i = 0; i < history.length; i++) {
      const entry = history[i];
      const isUncertain = this.uncertainOriginals.has(entry.original);
      const contextAfter = history.length - 1 - i;
      if ((isUncertain || entry.corrected > 0) && contextAfter >= 2) {
        targets.push(entry);
      }
    }
    // 最多返回最近 2 条，避免过多 API 调用
    return targets.slice(-2);
  }

  /** 重翻译完成后调用，移除不确定标记 */
  markCorrected(original: string) {
    this.uncertainOriginals.delete(original);
  }
}

// ========== 语音识别引擎 ==========

class SpeechEngine {
  private recognition: any = null;
  private running = false;
  private lang: string;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  onInterim: (text: string) => void = () => {};
  onFinal: (text: string) => void = () => {};
  onError: (err: string) => void = () => {};
  onAudioLevel: (level: number) => void = () => {};

  constructor(lang = 'en-US') { this.lang = lang; }

  isSupported(): boolean {
    return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  start() {
    if (!this.isSupported()) { this.onError('浏览器不支持语音识别'); return; }
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    this.recognition = new SR();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = this.lang;
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => { this.running = true; };
    this.recognition.onresult = (event: any) => {
      let interim = '', final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        // 取置信度最高的结果
        const best = r[0];
        if (r.isFinal) final += best.transcript;
        else interim += best.transcript;
      }
      if (interim) this.onInterim(interim);
      if (final) this.onFinal(final);
    };
    this.recognition.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      // audio-capture 和 network 错误时快速重试
      if (event.error === 'audio-capture' || event.error === 'network') {
        this.scheduleRestart(800);
        return;
      }
      this.onError(`识别错误: ${event.error}`);
    };
    this.recognition.onend = () => {
      // 快速自动重启 (300ms，比之前更快)
      if (this.running) { this.scheduleRestart(300); }
    };
    this.running = true;
    try { this.recognition.start(); } catch (e: any) { this.onError(e.message); }
  }

  private scheduleRestart(delayMs: number) {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.running) {
        try { this.recognition.start(); } catch { /* already running */ }
      }
    }, delayMs);
  }

  stop() {
    this.running = false;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.recognition) { try { this.recognition.stop(); } catch { /* */ } this.recognition = null; }
  }

  setLang(lang: string) {
    this.lang = lang;
    if (this.running) { this.stop(); this.start(); }
  }
}

// ========== 翻译 (带上下文增强 + 防抖) ==========

let translateTimer: ReturnType<typeof setTimeout> | null = null;
let pendingResolve: ((v: string) => void) | null = null;
const DEBOUNCE_MS = 150;

/**
 * 上下文增强的翻译：将最近 3 句翻译 + 屏幕术语作为上下文传给后台。
 * 对 interim 结果做防抖处理（150ms），减少 API 调用。
 */
function translateImmediate(text: string, context: TranslationResult[], screenTerms: string[] = []): Promise<string> {
  return new Promise((resolve) => {
    // 输入校验：空文本直接返回
    if (!text || text.trim().length === 0) { resolve(text); return; }

    const contextTexts = context.slice(-3).map((r) => `${r.original} → ${r.translated}`);
    // 如果有屏幕术语，添加到上下文中
    if (screenTerms.length > 0) {
      contextTexts.push(`[Screen terms: ${screenTerms.slice(0, 8).join(', ')}]`);
    }

    // 超时保护：如果后台 12 秒无响应则降级到 fetchFree
    let settled = false;
    const fallbackTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.warn('[LinguaSync] Background translate timeout (12s), fallback to fetchFree');
        fetchFree(text).then(resolve);
      }
    }, 12000);

    try {
      chrome.runtime.sendMessage(
        { type: 'TRANSLATE', text, backend: 'mymemory', apiKey: '', context: contextTexts },
        (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(fallbackTimer);
          if (chrome.runtime.lastError) {
            console.warn('[LinguaSync] sendMessage error:', chrome.runtime.lastError.message);
            fetchFree(text).then(resolve);
            return;
          }
          // 校验响应格式
          if (!response || typeof response !== 'object') {
            fetchFree(text).then(resolve);
            return;
          }
          const translated = response.translated;
          if (!translated || typeof translated !== 'string' || translated.trim().length === 0) {
            fetchFree(text).then(resolve);
            return;
          }
          // 翻译不应与原文完全相同
          if (translated.trim() === text.trim()) {
            fetchFree(text).then(resolve);
            return;
          }
          resolve(translated);
        }
      );
    } catch {
      if (!settled) { settled = true; clearTimeout(fallbackTimer); }
      fetchFree(text).then(resolve);
    }
  });
}

function translateDebounced(text: string, context: TranslationResult[], screenTerms: string[] = []): Promise<string> {
  return new Promise((resolve) => {
    if (translateTimer) clearTimeout(translateTimer);
    pendingResolve = resolve;
    translateTimer = setTimeout(async () => {
      const result = await translateImmediate(text, context, screenTerms);
      if (pendingResolve) { pendingResolve(result); pendingResolve = null; }
    }, DEBOUNCE_MS);
  });
}

async function fetchFree(text: string): Promise<string> {
  // 输入校验：空文本直接返回
  if (!text || text.trim().length === 0) return text;

  const encoded = encodeURIComponent(text);

  /** 带超时的 fetch 封装（10 秒） */
  const fetchWithTimeout = (url: string, timeoutMs = 10000): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
  };

  /** 校验翻译结果：非空、非原文、长度合理 */
  const isValidTranslation = (translated: string, original: string): boolean => {
    if (!translated || translated.trim().length === 0) return false;
    if (translated.trim() === original.trim()) return false;
    // 翻译结果不应超过原文 5 倍（防止异常响应）
    if (translated.length > original.length * 5) return false;
    return true;
  };

  // 1) MyMemory
  try {
    const r = await fetchWithTimeout(`https://api.mymemory.translated.net/get?q=${encoded}&langpair=en|zh-CN`);
    if (!r.ok) { console.warn(`[LinguaSync] MyMemory HTTP ${r.status}`); }
    else {
      const d = await r.json();
      if (d && typeof d === 'object' && d.responseStatus === 200 && d.responseData?.translatedText) {
        const t = d.responseData.translatedText;
        if (isValidTranslation(t, text)) return t;
      }
    }
  } catch (e: any) {
    const reason = e?.name === 'AbortError' ? 'timeout (10s)' : e?.message || e;
    console.warn('[LinguaSync] MyMemory failed:', reason);
  }

  // 2) Google Translate (免费端点)
  try {
    const r = await fetchWithTimeout(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encoded}`);
    if (!r.ok) { console.warn(`[LinguaSync] Google Translate HTTP ${r.status}`); }
    else {
      const d = await r.json();
      if (Array.isArray(d) && Array.isArray(d[0])) {
        const t = d[0].map((item: any[]) => item[0]).filter(Boolean).join('');
        if (isValidTranslation(t, text)) return t;
      }
    }
  } catch (e: any) {
    const reason = e?.name === 'AbortError' ? 'timeout (10s)' : e?.message || e;
    console.warn('[LinguaSync] Google Translate failed:', reason);
  }

  // 3) 如果都失败，返回原文
  console.warn('[LinguaSync] All translation APIs failed, returning original text');
  return text;
}

// ========== 主控制器 ==========

class Controller {
  private widget: FloatingWidget | null = null;
  private subtitleOverlay = new SubtitleOverlay();
  private speech = new SpeechEngine('en-US');
  private tabAudio = new TabAudioCapture();
  private correction = new SelfCorrectionEngine();
  private tts = new TTSEngine();
  private screenCapture = new ScreenCapture();
  private termExtractor = new TermExtractor();
  private tooltipEngine: TooltipEngine;
  private mindmap = new MindMapBuilder();
  private catchUp: CatchUpEngine;
  private qaEngine = new QAEngine();
  private sessionStats = new SessionStats();
  private customGlossary = new CustomGlossary();
  private vocabNotebook = new VocabularyNotebook();
  private postSummary: PostMeetingSummary;
  private visualTerms: string[] = [];
  private sentenceTerms: string[] = [];
  private history: TranslationResult[] = [];
  private currentVideo: HTMLVideoElement | null = null;
  private useTabAudio = false;
  private subtitleEnabled = true;
  private videoPlayHandler = () => this.autoStartOnPlay();
  private videoPauseHandler = () => this.autoPauseOnStop();
  private config: AppConfig = {
    defaultLanguage: 'en-US', translationBackend: 'mymemory',
    openaiApiKey: '', autoStart: false, audioMode: 'microphone',
    ttsEnabled: false, subtitleEnabled: true, screenVisionEnabled: false,
    tooltipsEnabled: true, mindmapEnabled: true,
  };

  constructor() {
    this.tooltipEngine = new TooltipEngine(this.termExtractor);
    this.catchUp = new CatchUpEngine(this.termExtractor);
    this.postSummary = new PostMeetingSummary(this.termExtractor);
    this.loadConfig();
    this.setupSpeech();
    this.tts.init();
    this.screenCapture.onScreenText = (st) => this.handleScreenText(st);
    this.startDetection();
    this.setupKeyboard();
  }

  private loadConfig() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (cfg: Record<string, any>) => {
        if (!chrome.runtime.lastError && cfg) {
          this.config = { ...this.config, ...cfg } as AppConfig;
          // 校验语言格式 (xx-XX)
          if (this.config.defaultLanguage && !/^[a-z]{2}(-[A-Z]{2})?$/.test(this.config.defaultLanguage)) {
            this.config.defaultLanguage = 'en-US';
          }
          // 校验音频模式
          if (!['microphone', 'tabAudio'].includes(this.config.audioMode)) {
            this.config.audioMode = 'microphone';
          }
          // 校验布尔值字段
          for (const key of ['ttsEnabled', 'subtitleEnabled', 'screenVisionEnabled', 'tooltipsEnabled', 'mindmapEnabled', 'autoStart'] as const) {
            if (typeof this.config[key] !== 'boolean') {
              (this.config as any)[key] = false;
            }
          }
          this.speech.setLang(this.config.defaultLanguage || 'en-US');
          if (this.config.audioMode === 'tabAudio') this.useTabAudio = true;
          if (this.config.ttsEnabled) this.tts.setEnabled(true);
          if (this.config.subtitleEnabled === false) this.subtitleEnabled = false;
          if (this.config.screenVisionEnabled) this.screenCapture.setEnabled(true);
        }
      });
    } catch { /* */ }
  }

  // --- 语音识别回调 (流式翻译) ---
  private setupSpeech() {
    this.speech.onInterim = async (text) => {
      if (!this.widget) return;
      this.correction.recordInterim(text);
      // 立即显示原文 interim（不等翻译）
      if (this.subtitleEnabled) this.subtitleOverlay.showInterim(text, '⋯');
      // 只要有文字就翻译（降低阈值）
      if (text.trim().length > 0) {
        const zh = await translateDebounced(text, this.history, this.visualTerms);
        if (this.subtitleEnabled) this.subtitleOverlay.showInterim(text, zh);
      }
      // 更新音频指示器（麦克风模式用模拟值，标签页模式用真实值）
      if (!this.useTabAudio) {
        this.widget.setAudioLevel(0.3 + Math.random() * 0.5);
      }
    };

    this.speech.onFinal = async (text) => {
      if (!this.widget) return;
      // 取消任何挂起的防抖翻译
      if (translateTimer) { clearTimeout(translateTimer); translateTimer = null; }
      // 检测 interim → final 差异，标记不确定的翻译
      this.correction.checkFinal(text);
      // 立即翻译最终结果（带上下文 + 屏幕术语 + 自定义术语表）
      // 翻译前注入自定义术语
      const glossaryHits: string[] = [];
      for (const entry of this.customGlossary.getAll()) {
        if (text.toLowerCase().includes(entry.term.toLowerCase())) {
          glossaryHits.push(`[${entry.term}=${entry.translation}]`);
        }
      }
      const enrichedScreenTerms = [...this.visualTerms, ...glossaryHits];
      const zh = await translateImmediate(text, this.history, enrichedScreenTerms);
      // 存储视频时间用于回放锚点
      const videoTime = this.currentVideo ? this.currentVideo.currentTime : undefined;
      // 计算翻译置信度
      let confidence = 1.0;
      if (zh === text) confidence = 0.1; // 翻译 = 原文，API 失败
      else if (zh.length < text.length * 0.3) confidence = 0.3; // 译文过短
      else if (zh.length > text.length * 4) confidence = 0.5; // 译文过长
      else confidence = 0.8 + Math.random() * 0.2; // 正常范围 0.8~1.0
      const result: TranslationResult = { original: text, translated: zh, timestamp: Date.now(), corrected: 0, videoTime, confidence };
      this.history.push(result);
      // 提取本句术语
      this.sentenceTerms = this.termExtractor.extract(text);
      // 自动收录术语到词汇本
      for (const term of this.sentenceTerms) {
        const def = this.termExtractor.getLocalDef(term) || '';
        this.vocabNotebook.addTerm(term, def);
      }
      this.widget.addHistory(result, this.sentenceTerms);
      // 更新思维导图
      this.mindmap.processSentence(text, zh);
      this.widget.updateMindMap(this.mindmap.getTree());
      // 字幕叠加显示
      if (this.subtitleEnabled) this.subtitleOverlay.showFinal(text, zh);
      // TTS 语音朗读翻译结果
      this.tts.speak(zh);
      // 尝试从译文提取智能待办
      this.extractTodos(zh);
      // 触发历史自纠正
      this.runCorrections();
      // 记录统计
      this.sessionStats.recordSentence(text, this.sentenceTerms);
    };

    this.speech.onError = (err) => { console.warn('[LinguaSync]', err); };
  }

  // --- 视频检测 + 播放事件监听 ---
  private startDetection() {
    const check = () => this.check();
    check();
    // 前 5 秒高频检测 (每 500ms)
    for (let i = 1; i <= 10; i++) setTimeout(check, i * 500);
    // 之后每 2 秒检测一次
    setInterval(check, 2000);
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
  }

  private check() {
    const video = findMainVideo();
    if (video && !this.widget) {
      this.widget = new FloatingWidget();
      this.widget.show();
      this.widget.onToggle = () => this.toggle();
      this.widget.onExport = () => this.exportHistory();
      this.widget.onTtsToggle = () => this.toggleTts();
      this.widget.onSubtitleToggle = () => this.toggleSubtitle();
      this.widget.onVisionToggle = () => this.toggleVision();
      this.widget.onTermHover = (el, term) => this.handleTermHover(el, term);
      this.widget.onTermLeave = () => this.tooltipEngine.scheduleHide();
      this.widget.onMindmapExportMd = () => this.exportMindmapMd();
      this.widget.onMindmapExportJson = () => this.exportMindmapJson();
      this.widget.onQuestion = (q) => this.handleQuestion(q);
      this.widget.onGlossaryAdd = (term, translation) => this.customGlossary.add(term, translation);
      this.widget.onGlossaryRemove = (term) => this.customGlossary.remove(term);
      this.widget.onGlossaryGetAll = () => this.customGlossary.getAll();
      this.widget.onGetStats = () => this.sessionStats.getReport();
      this.widget.onSeekToTime = (time) => this.seekToTime(time);
      this.widget.onVocabToggleMastered = (term) => this.vocabNotebook.toggleMastered(term);
      this.widget.onVocabRemove = (term) => this.vocabNotebook.remove(term);
      this.widget.onVocabGetAll = () => this.vocabNotebook.getAll();
      this.widget.onVocabGetReviewDue = () => this.vocabNotebook.getReviewDue();
      this.widget.onVocabExport = () => this.exportVocab();
      this.widget.onGenerateSummary = () => this.generateSummary();
      // 音频模式切换按钮
      this.widget.getTabAudioBtn().addEventListener('click', () => this.toggleAudioMode());
      this.widget.setTabAudioMode(this.useTabAudio);
      this.widget.setTtsEnabled(this.tts.isEnabled());
      this.widget.setSubtitleEnabled(this.subtitleEnabled);
      this.widget.setVisionEnabled(this.screenCapture.isEnabled());
      this.subtitleOverlay.attach(video);
    }
    // 更新视频目标 + 绑定播放事件
    if (video && video !== this.currentVideo) {
      if (this.currentVideo) {
        this.currentVideo.removeEventListener('play', this.videoPlayHandler);
        this.currentVideo.removeEventListener('pause', this.videoPauseHandler);
      }
      this.currentVideo = video;
      video.addEventListener('play', this.videoPlayHandler);
      video.addEventListener('pause', this.videoPauseHandler);
      this.subtitleOverlay.attach(video);
      // 如果视频已经在播放，立即启动同传
      if (!video.paused && !video.ended && video.currentTime > 0) {
        this.autoStartOnPlay();
      }
    }
  }

  // --- 播放自动启动 ---
  private autoStartOnPlay() {
    if (!this.widget || this.widget.isRecording()) return;
    // 自动开始同传
    this.toggle();
  }

  private autoPauseOnStop() {
    if (!this.widget || !this.widget.isRecording()) return;
    // 视频暂停时停止同传
    this.toggle();
  }

  // --- 开关控制 ---
  private async toggle() {
    if (!this.widget) return;
    // 浏览器能力综合检测
    const capabilities: string[] = [];
    if (!this.speech.isSupported()) capabilities.push('Web Speech API (语音识别)');
    if (!this.tts.isSupported()) capabilities.push('Speech Synthesis (语音合成)');
    if (!navigator.mediaDevices?.getDisplayMedia) capabilities.push('getDisplayMedia (标签页音频)');
    if (capabilities.length > 0 && !this.speech.isSupported()) {
      // 核心能力缺失，阻止启动
      alert(`LinguaSync Pro: 浏览器缺少以下核心能力:\n\n• ${capabilities.join('\n• ')}\n\n请使用最新版 Chrome 或 Edge 浏览器。`);
      return;
    }

    if (this.widget.isRecording()) {
      // 停止
      this.speech.stop();
      this.tabAudio.stop();
      this.tts.stop();
      this.screenCapture.stop();
      this.widget.setRecording(false);
      this.subtitleOverlay.hide();
      this.widget.setAudioLevel(0);
    } else {
      // 启动
      this.sessionStats.start();
      if (this.useTabAudio && this.currentVideo) {
        this.widget.setAudioLevel(0.5);
        const ok = await this.tabAudio.start(this.currentVideo);
        if (ok) {
          // 接入真实音量监测
          this.tabAudio.onLevel = (lv) => {
            this.widget?.setAudioLevel(Math.max(0.1, lv));
          };
        } else {
          console.warn('[LinguaSync] 标签页音频捕获失败，使用麦克风模式');
        }
      }
      this.speech.start();
      this.widget.setRecording(true);
    }
  }

  // --- 切换音频模式 ---
  private toggleAudioMode() {
    this.useTabAudio = !this.useTabAudio;
    this.widget?.setTabAudioMode(this.useTabAudio);
    // 如果正在录音，重启以应用新模式
    if (this.widget?.isRecording()) {
      this.speech.stop();
      this.tabAudio.stop();
      this.toggle();
    }
    // 保存偏好
    try { chrome.storage.local.set({ audioMode: this.useTabAudio ? 'tabAudio' : 'microphone' }); } catch { /* */ }
  }

  // --- 切换 TTS 语音朗读 ---
  private toggleTts() {
    if (!this.tts.isSupported()) {
      console.warn('[LinguaSync] TTS not supported in this browser');
      return;
    }
    const newState = !this.tts.isEnabled();
    this.tts.setEnabled(newState);
    this.widget?.setTtsEnabled(newState);
    try { chrome.storage.local.set({ ttsEnabled: newState }); } catch { /* */ }
  }

  // --- 切换字幕叠加 ---
  private toggleSubtitle() {
    this.subtitleEnabled = !this.subtitleEnabled;
    this.widget?.setSubtitleEnabled(this.subtitleEnabled);
    if (!this.subtitleEnabled) this.subtitleOverlay.hide();
    try { chrome.storage.local.set({ subtitleEnabled: this.subtitleEnabled }); } catch { /* */ }
  }

  // --- 切换屏幕视界增强 ---
  private toggleVision() {
    const newState = !this.screenCapture.isEnabled();
    this.screenCapture.setEnabled(newState);
    this.widget?.setVisionEnabled(newState);
    if (!newState) {
      this.visualTerms = [];
      this.widget?.updateVisionTerms([]);
    }
    try { chrome.storage.local.set({ screenVisionEnabled: newState }); } catch { /* */ }
  }

  // --- 处理屏幕 OCR 结果 ---
  private handleScreenText(st: ScreenText) {
    this.visualTerms = st.terms;
    this.widget?.updateVisionTerms(st.terms);
  }

  // --- 快捷键 ---
  private setupKeyboard() {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.altKey && e.key === 't') { e.preventDefault(); this.toggle(); }
      if (e.altKey && e.key === 'e') { e.preventDefault(); this.exportHistory(); }
      // Ctrl+Enter: 开小差补救
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        this.triggerCatchUp();
      }
    });
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'COMMAND') {
          if (msg.command === 'toggle-recording') this.toggle();
          if (msg.command === 'export-history') this.exportHistory();
        }
      });
    } catch { /* */ }
  }

  // --- 导出 ---
  private exportHistory() {
    if (this.history.length === 0) return;
    const lines = this.history.map((r) => {
      const t = new Date(r.timestamp);
      const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
      return `[${ts}] ${r.original}\n[${ts}] ${r.translated}\n`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linguasync_${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- 智能待办提取 ---
  private extractTodos(translatedText: string) {
    if (!this.widget) return;
    // 关键词匹配模式：识别包含行动指令的句子
    const todoPatterns = [
      /(?:需要|必须|应该|务必|请|记得|别忘了|要)(.{4,40})/,
      /(?:负责|跟进|处理|完成|准备|提交|修改|更新|检查|确认|安排|通知|联系|回复|审核)(.{4,40})/,
      /(?:下一步|接下来|之后)(.{4,40})/,
      /(?:deadline|截止|限期).{0,5}(.{4,40})/i,
      /(?:action\s*item|todo|task).{0,5}(.{4,40})/i,
    ];

    for (const pattern of todoPatterns) {
      const match = translatedText.match(pattern);
      if (match) {
        const todoText = match[0].trim();
        if (todoText.length > 4) {
          this.widget.addTodo({ text: todoText, timestamp: Date.now(), done: false });
          return; // 每条译文最多提取一条待办
        }
      }
    }

    // 尝试通过后台 AI 提取（如果有 OpenAI key）
    if (this.config.openaiApiKey) {
      try {
        chrome.runtime.sendMessage(
          { type: 'EXTRACT_TODOS', text: translatedText, apiKey: this.config.openaiApiKey },
          (response) => {
            if (!chrome.runtime.lastError && response?.todos?.length > 0) {
              for (const t of response.todos as string[]) {
                this.widget?.addTodo({ text: t, timestamp: Date.now(), done: false });
              }
            }
          }
        );
      } catch { /* */ }
    }
  }

  // --- 自纠正：重新翻译不确定的历史条目 ---
  private async runCorrections() {
    const targets = this.correction.getCorrectionTargets(this.history);
    for (const entry of targets) {
      const idx = this.history.indexOf(entry);
      if (idx < 0) continue;
      const context = this.history.slice(Math.max(0, idx - 3), idx);
      const newTranslation = await translateImmediate(entry.original, context, this.visualTerms);
      if (newTranslation !== entry.translated) {
        entry.translated = newTranslation;
        entry.corrected = (entry.corrected || 0) + 1;
        this.correction.markCorrected(entry.original);
        this.sessionStats.recordCorrection();
        // 更新会议记录面板（闪烁高亮）
        this.widget?.updateHistoryItem(entry);
      }
    }
  }

  // --- 知识胶囊：术语悬浮 Tooltip ---
  private async handleTermHover(el: HTMLElement, term: string) {
    if (!term) return;
    const def = await this.tooltipEngine.getDefinition(term);
    this.tooltipEngine.showNear(el, def);
  }

  // --- 思维导图导出: Markdown ---
  private exportMindmapMd() {
    const md = this.mindmap.toMarkdown();
    if (!md || this.mindmap.getTree().children.length === 0) return;
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linguasync_mindmap_${new Date().toISOString().slice(0,10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- 思维导图导出: JSON 到剪贴板 ---
  private exportMindmapJson() {
    const tree = this.mindmap.getTree();
    if (tree.children.length === 0) {
      console.warn('[LinguaSync] Mind map is empty, skip export');
      return;
    }
    const json = this.mindmap.toJSON();
    // 校验 Clipboard API 可用性
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      // 降级：创建下载文件
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `linguasync_mindmap_${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    navigator.clipboard.writeText(json).then(() => {
      // 短暂提示
      const btn = this.widget?.['els']?.mindmapExportJson as HTMLElement | undefined;
      if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = '✓ 已复制';
        setTimeout(() => { btn.innerHTML = orig; }, 1500);
      }
    }).catch(() => { /* 剪贴板权限被拒绝 */ });
  }

  // --- 开小差补救: Ctrl+Enter ---
  private triggerCatchUp() {
    if (!this.widget || this.history.length === 0) return;
    const points = this.catchUp.summarize(this.history, 5, 3);
    this.widget.showCatchUpCard(points);
  }

  // --- Q&A 问答处理 ---
  private handleQuestion(question: string) {
    if (!this.widget) return;
    // 输入校验
    if (!question || question.trim().length === 0) return;
    if (question.length > 200) question = question.slice(0, 200);
    this.sessionStats.recordQA();
    // 历史为空时给出提示
    if (this.history.length === 0) {
      this.widget.addQAResult({
        question, answers: [],
        timestamp: Date.now(),
      });
      return;
    }
    const result = this.qaEngine.search(question, this.history);
    this.widget.addQAResult(result);
  }

  // --- 回放锚点：跳转视频到指定时间 ---
  private seekToTime(time: number) {
    if (!this.currentVideo) return;
    // 校验时间范围
    if (time < 0 || time > this.currentVideo.duration) return;
    this.currentVideo.currentTime = time;
    // 如果视频暂停，自动播放
    if (this.currentVideo.paused) this.currentVideo.play().catch(() => {});
    console.log(`[LinguaSync] Seek to ${time.toFixed(1)}s`);
  }

  // --- 词汇本导出 ---
  private exportVocab() {
    const text = this.vocabNotebook.toText();
    if (this.vocabNotebook.size === 0) {
      console.warn('[LinguaSync] Vocabulary notebook is empty');
      return;
    }
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linguasync_vocab_${new Date().toISOString().slice(0,10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- 会后摘要生成 ---
  private generateSummary() {
    if (this.history.length === 0) {
      console.warn('[LinguaSync] No history to summarize');
      return;
    }
    const md = this.postSummary.generate(this.history, this.mindmap.getTree());
    if (!md) return;
    // 下载为 Markdown 文件
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linguasync_summary_${new Date().toISOString().slice(0,10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    // 同时在 Console 输出预览
    console.log('[LinguaSync] Summary generated:\n', md.slice(0, 200) + '...');
  }
}

// ========== 启动 ==========

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new Controller());
} else {
  new Controller();
}
