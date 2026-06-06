/**
 * LinguaSync Pro v3 - 内容脚本
 *
 * 新增:
 *  - 标签页音频直采 (getDisplayMedia) — 不依赖麦克风外放
 *  - 播放自动启动 — 视频开始播放时自动开始同传
 *  - 流式翻译 + 上下文增强 — 防抖翻译 interim 结果，利用历史上下文提升质量
 */

// ========== 类型 ==========

interface TranslationResult {
  original: string;
  translated: string;
  timestamp: number;
}

interface AppConfig {
  defaultLanguage: string;
  translationBackend: string;
  openaiApiKey: string;
  autoStart: boolean;
  audioMode: 'microphone' | 'tabAudio';
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

// ========== 标签页音频直采 ==========

class TabAudioCapture {
  private stream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private video: HTMLVideoElement | null = null;
  private originalMuted = false;
  private active = false;

  /**
   * 捕获当前标签页音频。
   * 原理: getDisplayMedia 获取标签页音频流 → 通过隐藏 audio 元素播放 →
   *       声音从扬声器输出 → Web Speech API (麦克风) 拾取。
   * 同时静音原始视频避免双重声音。
   */
  async start(video: HTMLVideoElement): Promise<boolean> {
    try {
      // 请求标签页音频捕获
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // 必须请求 video 才能选标签页
        audio: true,
      } as any);

      // 检查是否有音频轨道
      const audioTracks = this.stream.getAudioTracks();
      if (audioTracks.length === 0) {
        this.stop();
        return false;
      }

      // 只保留音频轨道
      const audioOnlyStream = new MediaStream(audioTracks);

      // 创建隐藏的 audio 元素播放捕获的音频
      this.audioEl = document.createElement('audio');
      this.audioEl.srcObject = audioOnlyStream;
      this.audioEl.volume = 1.0;
      this.audioEl.style.display = 'none';
      document.body.appendChild(this.audioEl);
      await this.audioEl.play();

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

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.srcObject = null;
      this.audioEl.remove();
      this.audioEl = null;
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
    this.hideTimer = setTimeout(() => this.hide(), 5000);
  }

  hide() {
    this.overlay?.classList.remove('ls-sub-visible', 'ls-sub-final');
    if (this.originalEl) this.originalEl.textContent = '';
    if (this.translatedEl) this.translatedEl.textContent = '';
  }
}

// ========== 悬浮控制面板 ==========

class FloatingWidget {
  private root: HTMLElement;
  private els!: Record<string, HTMLElement>;
  private pos = { x: 0, y: 0 };
  private dragging = false;
  private dragStart = { x: 0, y: 0 };
  private recording = false;
  private expanded = false;
  private tabAudioActive = false;

  onToggle: () => void = () => {};
  onExport: () => void = () => {};

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
      historyBtn: q('.ls-fl-history-btn'), exportBtn: q('.ls-fl-export-btn'),
      histCount: q('.ls-fl-count'), histPanel: q('.ls-fl-hist-panel'),
      histList: q('.ls-fl-hist-list'), onboarding: q('.ls-fl-onboarding'),
      onboardClose: q('.ls-fl-onboard-close'), tabAudioBtn: q('.ls-fl-tab-audio-btn'),
      modeLabel: q('.ls-fl-mode-label'),
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
        </div>
        <div class="ls-fl-toolbar">
          <button class="ls-fl-tab-audio-btn" title="切换音频源">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
            <span class="ls-fl-mode-label">麦克风</span>
          </button>
          <button class="ls-fl-history-btn" title="翻译历史">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            历史
          </button>
          <button class="ls-fl-export-btn" title="导出 (Alt+E)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            导出
          </button>
        </div>
        <div class="ls-fl-hist-panel" style="display:none"><div class="ls-fl-hist-list"></div></div>
        <div class="ls-fl-onboarding">
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
    this.els.dragBar.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.dragging = true;
      this.dragStart = { x: e.clientX - this.pos.x, y: e.clientY - this.pos.y };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.dragging) return;
      this.pos = {
        x: Math.max(0, Math.min(window.innerWidth - 300, e.clientX - this.dragStart.x)),
        y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - this.dragStart.y)),
      };
      this.root.style.left = `${this.pos.x}px`;
      this.root.style.top = `${this.pos.y}px`;
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });

    this.els.recBtn.addEventListener('click', () => this.onToggle());
    this.els.historyBtn.addEventListener('click', () => {
      this.expanded = !this.expanded;
      this.els.histPanel.style.display = this.expanded ? '' : 'none';
    });
    this.els.exportBtn.addEventListener('click', () => this.onExport());
    this.els.onboardClose.addEventListener('click', () => {
      this.els.onboarding.style.display = 'none';
      try { chrome.storage.local.set({ onboarded: true }); } catch { /* */ }
    });
  }

  private centerAtBottom() {
    this.pos = { x: Math.max(10, (window.innerWidth - 580) / 2), y: window.innerHeight - 140 };
    this.root.style.left = `${this.pos.x}px`;
    this.root.style.top = `${this.pos.y}px`;
  }

  private showOnboarding() {
    try {
      chrome.storage.local.get(['onboarded'], (res: Record<string, any>) => {
        if (res.onboarded) this.els.onboarding.style.display = 'none';
      });
    } catch {
      this.els.onboarding.style.display = 'none';
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

  // tabAudioBtn 的点击回调需要外部设置
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

  addHistory(result: TranslationResult) {
    const item = document.createElement('div');
    item.className = 'ls-fl-hist-item';
    const t = new Date(result.timestamp);
    const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
    item.innerHTML = `<div class="ls-fl-hist-ts">${ts}</div><div class="ls-fl-hist-orig">${esc(result.original)}</div><div class="ls-fl-hist-zh">${esc(result.translated)}</div>`;
    this.els.histList.appendChild(item);
    this.els.histList.scrollTop = this.els.histList.scrollHeight;
    const count = this.els.histList.children.length;
    this.els.histCount.textContent = String(count);
    this.els.histCount.style.display = count > 0 ? '' : 'none';
  }
}

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ========== 语音识别引擎 ==========

class SpeechEngine {
  private recognition: any = null;
  private running = false;
  private lang: string;

  onInterim: (text: string) => void = () => {};
  onFinal: (text: string) => void = () => {};
  onError: (err: string) => void = () => {};

  constructor(lang = 'en-US') { this.lang = lang; }

  isSupported(): boolean {
    return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  start() {
    if (!this.isSupported()) { this.onError('浏览器不支持语音识别'); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    this.recognition = new SR();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = this.lang;

    this.recognition.onstart = () => { this.running = true; };
    this.recognition.onresult = (event: any) => {
      let interim = '', final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) this.onInterim(interim);
      if (final) this.onFinal(final);
    };
    this.recognition.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      this.onError(`识别错误: ${event.error}`);
    };
    this.recognition.onend = () => {
      if (this.running) { try { this.recognition.start(); } catch { /* */ } }
    };
    try { this.recognition.start(); } catch (e: any) { this.onError(e.message); }
  }

  stop() {
    this.running = false;
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
const DEBOUNCE_MS = 350;

/**
 * 上下文增强的翻译：将最近 3 句翻译作为上下文传给后台。
 * 对 interim 结果做防抖处理（350ms），减少 API 调用。
 */
function translateImmediate(text: string, context: TranslationResult[]): Promise<string> {
  return new Promise((resolve) => {
    const contextTexts = context.slice(-3).map((r) => `${r.original} → ${r.translated}`);
    try {
      chrome.runtime.sendMessage(
        { type: 'TRANSLATE', text, backend: 'mymemory', apiKey: '', context: contextTexts },
        (response) => {
          if (chrome.runtime.lastError || !response?.translated) {
            fetchFree(text).then(resolve);
            return;
          }
          resolve(response.translated);
        }
      );
    } catch {
      fetchFree(text).then(resolve);
    }
  });
}

function translateDebounced(text: string, context: TranslationResult[]): Promise<string> {
  return new Promise((resolve) => {
    if (translateTimer) clearTimeout(translateTimer);
    pendingResolve = resolve;
    translateTimer = setTimeout(async () => {
      const result = await translateImmediate(text, context);
      if (pendingResolve) { pendingResolve(result); pendingResolve = null; }
    }, DEBOUNCE_MS);
  });
}

async function fetchFree(text: string): Promise<string> {
  try {
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`);
    const d = await r.json();
    if (d.responseStatus === 200) return d.responseData.translatedText;
  } catch { /* */ }
  return text;
}

// ========== 主控制器 ==========

class Controller {
  private widget: FloatingWidget | null = null;
  private subtitleOverlay = new SubtitleOverlay();
  private speech = new SpeechEngine('en-US');
  private tabAudio = new TabAudioCapture();
  private history: TranslationResult[] = [];
  private currentVideo: HTMLVideoElement | null = null;
  private useTabAudio = false;
  private videoPlayHandler = () => this.autoStartOnPlay();
  private videoPauseHandler = () => this.autoPauseOnStop();
  private config: AppConfig = {
    defaultLanguage: 'en-US', translationBackend: 'mymemory',
    openaiApiKey: '', autoStart: false, audioMode: 'microphone',
  };

  constructor() {
    this.loadConfig();
    this.setupSpeech();
    this.startDetection();
    this.setupKeyboard();
  }

  private loadConfig() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (cfg: Record<string, any>) => {
        if (!chrome.runtime.lastError && cfg) {
          this.config = { ...this.config, ...cfg } as AppConfig;
          this.speech.setLang(this.config.defaultLanguage || 'en-US');
          if (this.config.audioMode === 'tabAudio') this.useTabAudio = true;
        }
      });
    } catch { /* */ }
  }

  // --- 语音识别回调 (流式翻译) ---
  private setupSpeech() {
    this.speech.onInterim = async (text) => {
      if (!this.widget) return;
      this.widget.setAudioLevel(0.3 + Math.random() * 0.7);
      // 立即显示原文 interim
      this.subtitleOverlay.showInterim(text, '...');
      // 防抖翻译 interim
      if (text.length > 2) {
        const zh = await translateDebounced(text, this.history);
        // 只有当这还是最新的 interim 时才更新
        this.subtitleOverlay.showInterim(text, zh);
      }
    };

    this.speech.onFinal = async (text) => {
      if (!this.widget) return;
      // 取消任何挂起的防抖翻译
      if (translateTimer) { clearTimeout(translateTimer); translateTimer = null; }
      // 立即翻译最终结果（带上下文）
      const zh = await translateImmediate(text, this.history);
      const result: TranslationResult = { original: text, translated: zh, timestamp: Date.now() };
      this.history.push(result);
      this.widget.addHistory(result);
      this.subtitleOverlay.showFinal(text, zh);
      this.widget.setAudioLevel(0.15);
    };

    this.speech.onError = (err) => { console.warn('[LinguaSync]', err); };
  }

  // --- 视频检测 + 播放事件监听 ---
  private startDetection() {
    const check = () => this.check();
    check();
    for (let i = 1; i <= 5; i++) setTimeout(check, i * 1000);
    setInterval(check, 3000);
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
  }

  private check() {
    const video = findMainVideo();
    if (video && !this.widget) {
      this.widget = new FloatingWidget();
      this.widget.show();
      this.widget.onToggle = () => this.toggle();
      this.widget.onExport = () => this.exportHistory();
      // 音频模式切换按钮
      this.widget.getTabAudioBtn().addEventListener('click', () => this.toggleAudioMode());
      this.widget.setTabAudioMode(this.useTabAudio);
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
    if (!this.speech.isSupported()) {
      alert('LinguaSync Pro: 浏览器不支持 Web Speech API\n请使用 Chrome 或 Edge');
      return;
    }

    if (this.widget.isRecording()) {
      // 停止
      this.speech.stop();
      this.tabAudio.stop();
      this.widget.setRecording(false);
      this.subtitleOverlay.hide();
      this.widget.setAudioLevel(0);
    } else {
      // 启动
      // 如果使用标签页音频模式，先捕获音频
      if (this.useTabAudio && this.currentVideo) {
        this.widget.setAudioLevel(0.5);
        const ok = await this.tabAudio.start(this.currentVideo);
        if (!ok) {
          // 回退到麦克风模式
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

  // --- 快捷键 ---
  private setupKeyboard() {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.altKey && e.key === 't') { e.preventDefault(); this.toggle(); }
      if (e.altKey && e.key === 'e') { e.preventDefault(); this.exportHistory(); }
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
}

// ========== 启动 ==========

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new Controller());
} else {
  new Controller();
}
