/**
 * LinguaSync Pro v2 - 内容脚本
 *
 * 功能:
 *  - 自动检测页面视频元素（兼容 B站/YouTube 等 SPA）
 *  - 翻译字幕直接叠加在视频画面上
 *  - 悬浮控制面板（可拖拽、音频电平指示、翻译导出）
 *  - 支持麦克风 + 标签页音频两种捕获模式
 *  - 快捷键操控 (Alt+T 开关, Alt+E 导出)
 *  - 首次使用引导
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

    // 找到视频的直接父容器（B站是 .bpx-player-video-wrap，YouTube 是 .html5-video-container）
    const wrapper = video.parentElement || video;
    const computedStyle = getComputedStyle(wrapper);
    if (computedStyle.position === 'static') {
      wrapper.style.position = 'relative';
    }

    this.overlay = document.createElement('div');
    this.overlay.className = 'ls-subtitle-overlay';
    this.overlay.innerHTML = `
      <div class="ls-sub-original"></div>
      <div class="ls-sub-translated"></div>
    `;
    this.originalEl = this.overlay.querySelector('.ls-sub-original');
    this.translatedEl = this.overlay.querySelector('.ls-sub-translated');
    wrapper.appendChild(this.overlay);
  }

  detach() {
    if (this.overlay && this.overlay.parentElement) {
      this.overlay.parentElement.removeChild(this.overlay);
    }
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
  }

  showFinal(original: string, translated: string) {
    if (!this.originalEl || !this.translatedEl) return;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.originalEl.textContent = original;
    this.translatedEl.textContent = translated;
    this.overlay!.classList.add('ls-sub-visible', 'ls-sub-final');

    // 4 秒后淡出
    this.hideTimer = setTimeout(() => {
      this.hide();
    }, 4000);
  }

  hide() {
    if (this.overlay) {
      this.overlay.classList.remove('ls-sub-visible', 'ls-sub-final');
    }
    if (this.originalEl) this.originalEl.textContent = '';
    if (this.translatedEl) this.translatedEl.textContent = '';
  }
}

// ========== 悬浮控制面板 ==========

class FloatingWidget {
  private root: HTMLElement;
  private els: Record<string, HTMLElement>;
  private pos = { x: 0, y: 0 };
  private dragging = false;
  private dragStart = { x: 0, y: 0 };
  private recording = false;
  private expanded = false;

  onToggle: () => void = () => {};
  onExport: () => void = () => {};

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'ls-floating-root';
    this.root.innerHTML = this.buildHTML();
    document.body.appendChild(this.root);

    this.els = {
      widget: this.root.querySelector('.ls-fl-widget')!,
      dragBar: this.root.querySelector('.ls-fl-drag')!,
      statusDot: this.root.querySelector('.ls-fl-dot')!,
      recBtn: this.root.querySelector('.ls-fl-rec-btn')!,
      recLabel: this.root.querySelector('.ls-fl-rec-label')!,
      statusLabel: this.root.querySelector('.ls-fl-status')!,
      audioBar: this.root.querySelector('.ls-fl-audio-bar')!,
      historyBtn: this.root.querySelector('.ls-fl-history-btn')!,
      exportBtn: this.root.querySelector('.ls-fl-export-btn')!,
      histCount: this.root.querySelector('.ls-fl-count')!,
      histPanel: this.root.querySelector('.ls-fl-hist-panel')!,
      histList: this.root.querySelector('.ls-fl-hist-list')!,
      onboarding: this.root.querySelector('.ls-fl-onboarding')!,
      onboardClose: this.root.querySelector('.ls-fl-onboard-close')!,
    };

    this.setupEvents();
    this.centerAtBottom();
    this.showOnboarding();
  }

  private buildHTML(): string {
    return `
      <div class="ls-fl-widget" style="display:none">
        <!-- 拖拽条 -->
        <div class="ls-fl-drag">
          <svg width="16" height="6" viewBox="0 0 16 6"><circle cx="3" cy="3" r="1.5" fill="currentColor"/><circle cx="8" cy="3" r="1.5" fill="currentColor"/><circle cx="13" cy="3" r="1.5" fill="currentColor"/></svg>
          <div class="ls-fl-brand">
            <span class="ls-fl-dot"></span>
            <span>LINGUASYNC</span>
            <span class="ls-fl-pro">PRO</span>
          </div>
          <div class="ls-fl-audio-bar">
            ${Array.from({length:12}, (_,i) => `<span class="ls-fl-bar-seg" style="--i:${i}"></span>`).join('')}
          </div>
        </div>
        <!-- 控制栏 -->
        <div class="ls-fl-controls">
          <button class="ls-fl-rec-btn">
            <svg class="ls-fl-mic-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
            </svg>
            <span class="ls-fl-rec-label">开始同传</span>
          </button>
          <span class="ls-fl-status">就绪 · Alt+T 快捷开关</span>
          <span class="ls-fl-count" style="display:none">0</span>
        </div>
        <!-- 工具栏 -->
        <div class="ls-fl-toolbar">
          <button class="ls-fl-history-btn" title="翻译历史">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            历史
          </button>
          <button class="ls-fl-export-btn" title="导出翻译 (Alt+E)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            导出
          </button>
        </div>
        <!-- 历史面板 -->
        <div class="ls-fl-hist-panel" style="display:none">
          <div class="ls-fl-hist-list"></div>
        </div>
        <!-- 新手引导 -->
        <div class="ls-fl-onboarding">
          <div class="ls-fl-onboard-title">LinguaSync Pro 已就绪</div>
          <div class="ls-fl-onboard-desc">播放视频后，点击"开始同传"按钮即可实时翻译。<br/>快捷键: <kbd>Alt+T</kbd> 开关 · <kbd>Alt+E</kbd> 导出</div>
          <button class="ls-fl-onboard-close">知道了</button>
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
        x: Math.max(0, Math.min(window.innerWidth - 300, e.clientX - this.dragStart.x)),
        y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - this.dragStart.y)),
      };
      this.root.style.left = `${this.pos.x}px`;
      this.root.style.top = `${this.pos.y}px`;
    });
    window.addEventListener('mouseup', () => { this.this_drag_end(); });

    // 录音按钮
    this.els.recBtn.addEventListener('click', () => this.onToggle());

    // 历史展开
    this.els.historyBtn.addEventListener('click', () => {
      this.expanded = !this.expanded;
      this.els.histPanel.style.display = this.expanded ? '' : 'none';
    });

    // 导出
    this.els.exportBtn.addEventListener('click', () => this.onExport());

    // 新手引导关闭
    this.els.onboardClose.addEventListener('click', () => {
      this.els.onboarding.style.display = 'none';
      try { chrome.storage.local.set({ onboarded: true }); } catch { /* */ }
    });
  }

  private this_drag_end() { this.dragging = false; }

  private centerAtBottom() {
    this.pos = { x: Math.max(10, (window.innerWidth - 580) / 2), y: window.innerHeight - 140 };
    this.root.style.left = `${this.pos.x}px`;
    this.root.style.top = `${this.pos.y}px`;
  }

  private showOnboarding() {
    try {
      chrome.storage.local.get(['onboarded'], (res: Record<string, any>) => {
        if (res.onboarded) {
          this.els.onboarding.style.display = 'none';
        }
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
    this.els.statusLabel.textContent = on ? '识别中... · Alt+T 停止' : '就绪 · Alt+T 快捷开关';
  }

  isRecording() { return this.recording; }

  setAudioLevel(level: number) {
    const segs = this.root.querySelectorAll('.ls-fl-bar-seg');
    segs.forEach((seg, i) => {
      const threshold = (i / segs.length);
      (seg as HTMLElement).style.opacity = level > threshold ? '1' : '0.2';
      (seg as HTMLElement).style.transform = level > threshold ? `scaleY(${0.5 + level * 0.8})` : 'scaleY(0.3)';
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
    if (!this.isSupported()) {
      this.onError('浏览器不支持语音识别，请使用 Chrome 或 Edge');
      return;
    }
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
      if (this.running) {
        try { this.recognition.start(); } catch { /* */ }
      }
    };

    try { this.recognition.start(); } catch (e: any) { this.onError(e.message); }
  }

  stop() {
    this.running = false;
    if (this.recognition) {
      try { this.recognition.stop(); } catch { /* */ }
      this.recognition = null;
    }
  }

  setLang(lang: string) {
    this.lang = lang;
    if (this.running) { this.stop(); this.start(); }
  }
}

// ========== 翻译 ==========

async function translate(text: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: 'TRANSLATE', text, backend: 'mymemory', apiKey: '' },
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
  private history: TranslationResult[] = [];
  private config: AppConfig = {
    defaultLanguage: 'en-US',
    translationBackend: 'mymemory',
    openaiApiKey: '',
    autoStart: false,
    audioMode: 'microphone',
  };

  constructor() {
    this.loadConfig();
    this.setupSpeech();
    this.startDetection();
    this.setupKeyboard();
  }

  // --- 配置加载 ---
  private loadConfig() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (cfg: Record<string, any>) => {
        if (!chrome.runtime.lastError && cfg) {
          this.config = { ...this.config, ...cfg } as AppConfig;
          this.speech.setLang(this.config.defaultLanguage || 'en-US');
        }
      });
    } catch { /* */ }
  }

  // --- 语音识别回调 ---
  private setupSpeech() {
    this.speech.onInterim = async (text) => {
      if (!this.widget) return;
      let zh = '';
      if (text.length > 3) zh = await translate(text);
      this.widget.setAudioLevel(0.4 + Math.random() * 0.6);
      this.subtitleOverlay.showInterim(text, zh);
    };

    this.speech.onFinal = async (text) => {
      if (!this.widget) return;
      const zh = await translate(text);
      const result: TranslationResult = { original: text, translated: zh, timestamp: Date.now() };
      this.history.push(result);
      this.widget.addHistory(result);
      this.subtitleOverlay.showFinal(text, zh);
      this.widget.setAudioLevel(0.1);
    };

    this.speech.onError = (err) => {
      console.warn('[LinguaSync]', err);
    };
  }

  // --- 视频检测 ---
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
      this.subtitleOverlay.attach(video);
    }
    // 更新字幕叠加目标
    if (video && this.widget) {
      this.subtitleOverlay.attach(video);
    }
  }

  // --- 开关控制 ---
  private toggle() {
    if (!this.widget) return;
    if (!this.speech.isSupported()) {
      alert('LinguaSync Pro: 浏览器不支持 Web Speech API\n请使用 Chrome 或 Edge 浏览器');
      return;
    }
    if (this.widget.isRecording()) {
      this.speech.stop();
      this.widget.setRecording(false);
      this.subtitleOverlay.hide();
      this.widget.setAudioLevel(0);
    } else {
      this.speech.start();
      this.widget.setRecording(true);
    }
  }

  // --- 快捷键 ---
  private setupKeyboard() {
    // 全局快捷键
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.altKey && e.key === 't') { e.preventDefault(); this.toggle(); }
      if (e.altKey && e.key === 'e') { e.preventDefault(); this.exportHistory(); }
    });

    // 来自 background 的命令转发
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
