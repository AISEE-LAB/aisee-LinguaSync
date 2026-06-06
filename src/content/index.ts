/**
 * LinguaSync Pro - 内容脚本
 *
 * 注入到每个网页中，检测视频元素并创建悬浮翻译窗口。
 * 使用 Web Speech API 进行实时语音识别，通过后台脚本翻译。
 */

// ========== 类型定义 ==========

interface TranslationResult {
  original: string;
  translated: string;
  isFinal: boolean;
  speaker?: string;
  timestamp: number;
}

interface WidgetState {
  visible: boolean;
  isRecording: boolean;
  expanded: boolean;
  position: { x: number; y: number };
  interimOriginal: string;
  interimTranslated: string;
  history: TranslationResult[];
}

// ========== 常量 ==========

const WIDGET_ID = 'linguasync-pro-widget';

// ========== 视频检测 ==========

function detectVideos(): HTMLVideoElement[] {
  return Array.from(document.querySelectorAll('video'));
}

function hasSignificantVideo(): boolean {
  const videos = detectVideos();
  return videos.some((v) => {
    const rect = v.getBoundingClientRect();
    return rect.width > 200 && rect.height > 100;
  });
}

// ========== LinguaSync 悬浮窗 ==========

class LinguaSyncWidget {
  private container: HTMLElement;
  private interimOriginalEl: HTMLElement;
  private interimTranslatedEl: HTMLElement;
  private historyList: HTMLElement;
  private statusDot: HTMLElement;
  private statusText: HTMLElement;
  private recordBtn: HTMLElement;
  private expandBtn: HTMLElement;
  private historyCount: HTMLElement;

  private state: WidgetState = {
    visible: false,
    isRecording: false,
    expanded: false,
    position: { x: 0, y: 0 },
    interimOriginal: '',
    interimTranslated: '',
    history: [],
  };

  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };
  private onRecordToggle: () => void;

  constructor(onRecordToggle: () => void) {
    this.onRecordToggle = onRecordToggle;
    this.container = this.createWidget();
    this.interimOriginalEl = this.container.querySelector('.ls-interim-original')!;
    this.interimTranslatedEl = this.container.querySelector('.ls-interim-translated')!;
    this.historyList = this.container.querySelector('.ls-history-list')!;
    this.statusDot = this.container.querySelector('.ls-status-dot')!;
    this.statusText = this.container.querySelector('.ls-status-text')!;
    this.recordBtn = this.container.querySelector('.ls-record-btn')!;
    this.expandBtn = this.container.querySelector('.ls-expand-btn')!;
    this.historyCount = this.container.querySelector('.ls-history-count')!;

    document.body.appendChild(this.container);
    this.setupDrag();
    this.centerPosition();
  }

  private centerPosition() {
    const w = window.innerWidth;
    this.state.position = { x: (w - 620) / 2, y: window.innerHeight - 200 };
    this.updatePosition();
  }

  private createWidget(): HTMLElement {
    const el = document.createElement('div');
    el.id = WIDGET_ID;
    el.innerHTML = `
      <div class="ls-widget" style="display:none">
        <!-- 拖拽条 -->
        <div class="ls-drag-bar">
          <div class="ls-drag-handle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 9h14M5 15h14"/></svg>
          </div>
          <div class="ls-brand">
            <span class="ls-status-dot"></span>
            <span class="ls-brand-text">LINGUASYNC</span>
            <span class="ls-brand-pro">PRO</span>
          </div>
          <div class="ls-controls">
            <button class="ls-expand-btn" title="展开/收起历史">
              <svg class="ls-icon-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
              <span>历史</span>
            </button>
          </div>
        </div>

        <!-- 字幕区 -->
        <div class="ls-subtitle-area">
          <div class="ls-interim-original ls-interim"></div>
          <div class="ls-interim-translated ls-interim"></div>
        </div>

        <!-- 控制栏 -->
        <div class="ls-control-bar">
          <button class="ls-record-btn">
            <svg class="ls-icon-mic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
            <span class="ls-record-label">开始同传</span>
          </button>
          <span class="ls-status-text">就绪</span>
          <span class="ls-history-count" style="display:none">0</span>
        </div>

        <!-- 历史面板 -->
        <div class="ls-history-panel" style="display:none">
          <div class="ls-history-header">翻译记录</div>
          <div class="ls-history-list"></div>
        </div>
      </div>
    `;
    return el;
  }

  show() {
    this.state.visible = true;
    const widget = this.container.querySelector('.ls-widget') as HTMLElement;
    if (widget) widget.style.display = '';
  }

  hide() {
    this.state.visible = false;
    const widget = this.container.querySelector('.ls-widget') as HTMLElement;
    if (widget) widget.style.display = 'none';
  }

  private setupDrag() {
    const dragBar = this.container.querySelector('.ls-drag-bar') as HTMLElement;
    if (!dragBar) return;

    dragBar.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.isDragging = true;
      this.dragOffset = {
        x: e.clientX - this.state.position.x,
        y: e.clientY - this.state.position.y,
      };
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.isDragging) return;
      this.state.position = {
        x: Math.max(0, Math.min(window.innerWidth - 300, e.clientX - this.dragOffset.x)),
        y: Math.max(0, Math.min(window.innerHeight - 80, e.clientY - this.dragOffset.y)),
      };
      this.updatePosition();
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    // 展开/收起
    this.expandBtn.addEventListener('click', () => {
      this.state.expanded = !this.state.expanded;
      const panel = this.container.querySelector('.ls-history-panel') as HTMLElement;
      const chevron = this.expandBtn.querySelector('.ls-icon-chevron') as SVGElement;
      if (panel) panel.style.display = this.state.expanded ? '' : 'none';
      if (chevron) chevron.style.transform = this.state.expanded ? 'rotate(180deg)' : '';
    });

    // 录音按钮
    this.recordBtn.addEventListener('click', () => {
      this.onRecordToggle();
    });
  }

  private updatePosition() {
    this.container.style.left = `${this.state.position.x}px`;
    this.container.style.top = `${this.state.position.y}px`;
  }

  isCurrentlyRecording(): boolean {
    return this.state.isRecording;
  }

  setRecording(recording: boolean) {
    this.state.isRecording = recording;
    const label = this.recordBtn.querySelector('.ls-record-label') as HTMLElement;
    if (recording) {
      this.recordBtn.classList.add('ls-recording');
      this.statusDot.classList.add('ls-dot-active');
      if (label) label.textContent = '停止同传';
      if (this.statusText) this.statusText.textContent = '识别中...';
    } else {
      this.recordBtn.classList.remove('ls-recording');
      this.statusDot.classList.remove('ls-dot-active');
      if (label) label.textContent = '开始同传';
      if (this.statusText) this.statusText.textContent = '就绪';
    }
  }

  updateInterim(original: string, translated: string) {
    if (this.interimOriginalEl) {
      this.interimOriginalEl.textContent = original;
      this.interimOriginalEl.style.display = original ? '' : 'none';
    }
    if (this.interimTranslatedEl) {
      this.interimTranslatedEl.textContent = translated;
      this.interimTranslatedEl.style.display = translated ? '' : 'none';
    }
  }

  addHistory(result: TranslationResult) {
    this.state.history.push(result);

    const item = document.createElement('div');
    item.className = 'ls-history-item';

    const time = new Date(result.timestamp);
    const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`;

    item.innerHTML = `
      <div class="ls-history-time">${timeStr}</div>
      <div class="ls-history-original">${this.escapeHtml(result.original)}</div>
      <div class="ls-history-translated">${this.escapeHtml(result.translated)}</div>
    `;

    this.historyList.appendChild(item);
    this.historyList.scrollTop = this.historyList.scrollHeight;

    // 更新计数
    const count = this.state.history.length;
    if (this.historyCount) {
      this.historyCount.textContent = String(count);
      this.historyCount.style.display = count > 0 ? '' : 'none';
    }

    // 同时在字幕区短暂显示最终结果
    this.flashFinal(result);
  }

  private flashFinal(result: TranslationResult) {
    if (this.interimOriginalEl) {
      this.interimOriginalEl.textContent = result.original;
      this.interimOriginalEl.style.display = '';
      this.interimOriginalEl.classList.add('ls-flash-final');
    }
    if (this.interimTranslatedEl) {
      this.interimTranslatedEl.textContent = result.translated;
      this.interimTranslatedEl.style.display = '';
      this.interimTranslatedEl.classList.add('ls-flash-final-zh');
    }

    setTimeout(() => {
      if (this.interimOriginalEl) {
        this.interimOriginalEl.textContent = '';
        this.interimOriginalEl.style.display = 'none';
        this.interimOriginalEl.classList.remove('ls-flash-final');
      }
      if (this.interimTranslatedEl) {
        this.interimTranslatedEl.textContent = '';
        this.interimTranslatedEl.style.display = 'none';
        this.interimTranslatedEl.classList.remove('ls-flash-final-zh');
      }
    }, 3000);
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ========== 语音识别引擎 ==========

class SpeechEngine {
  private recognition: any = null;
  private running = false;
  private language: string;

  onInterim: (text: string) => void = () => {};
  onFinal: (text: string) => void = () => {};
  onError: (error: string) => void = () => {};

  constructor(language: string = 'en-US') {
    this.language = language;
  }

  isSupported(): boolean {
    return !!(
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition
    );
  }

  start() {
    if (!this.isSupported()) {
      this.onError('浏览器不支持语音识别，请使用 Chrome 浏览器');
      return;
    }

    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    this.recognition = new SR();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = this.language;
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.running = true;
    };

    this.recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (interim) this.onInterim(interim);
      if (final) this.onFinal(final);
    };

    this.recognition.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      this.onError(`语音识别错误: ${event.error}`);
    };

    this.recognition.onend = () => {
      if (this.running) {
        try {
          this.recognition.start();
        } catch {
          // ignore
        }
      }
    };

    try {
      this.recognition.start();
    } catch (e: any) {
      this.onError(`启动语音识别失败: ${e.message}`);
    }
  }

  stop() {
    this.running = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
      this.recognition = null;
    }
  }

  setLanguage(lang: string) {
    this.language = lang;
    if (this.running) {
      this.stop();
      this.start();
    }
  }
}

// ========== 翻译引擎 ==========

async function translateText(text: string): Promise<string> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'TRANSLATE', text, backend: 'mymemory', apiKey: '' },
      (response) => {
        if (chrome.runtime.lastError) {
          // 降级：直接在前端调用 MyMemory
          fetchMyMemory(text).then(resolve);
          return;
        }
        resolve(response?.translated || text);
      }
    );
  });
}

async function fetchMyMemory(text: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`
    );
    const data = await res.json();
    if (data.responseStatus === 200) {
      return data.responseData.translatedText;
    }
  } catch {
    // ignore
  }
  return `[翻译失败]`;
}

// ========== 主控制器 ==========

class LinguaSyncController {
  private widget: LinguaSyncWidget | null = null;
  private speechEngine: SpeechEngine;

  constructor() {
    this.speechEngine = new SpeechEngine('en-US');
    this.setupSpeechCallbacks();
    this.startVideoDetection();
    this.loadConfig();
  }

  private setupSpeechCallbacks() {
    this.speechEngine.onInterim = async (text) => {
      if (!this.widget) return;
      // 异步翻译临时文本
      let translated = '';
      if (text.length > 5) {
        translated = await translateText(text);
      }
      this.widget.updateInterim(text, translated);
    };

    this.speechEngine.onFinal = async (text) => {
      if (!this.widget) return;
      const translated = await translateText(text);
      this.widget.updateInterim('', '');
      this.widget.addHistory({
        original: text,
        translated,
        isFinal: true,
        timestamp: Date.now(),
      });
    };

    this.speechEngine.onError = (error) => {
      console.warn('[LinguaSync]', error);
    };
  }

  private startVideoDetection() {
    // 立即检查一次
    this.checkForVideos();

    // 每 3 秒检查是否有视频
    setInterval(() => {
      this.checkForVideos();
    }, 3000);

    // 监听 DOM 变化（SPA 页面切换）
    const observer = new MutationObserver(() => {
      this.checkForVideos();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  private checkForVideos() {
    const hasVideo = hasSignificantVideo();

    if (hasVideo && !this.widget) {
      this.createWidget();
    }

    // 如果页面没有视频了，且超过 10 秒，隐藏 widget
    // (不在这里自动隐藏，让用户手动控制)
  }

  private createWidget() {
    this.widget = new LinguaSyncWidget(() => this.toggleRecording());
    this.widget.show();
  }

  private toggleRecording() {
    if (!this.widget) return;

    if (this.speechEngine.isSupported() === false) {
      alert('LinguaSync Pro: 当前浏览器不支持 Web Speech API。\n请使用 Chrome 浏览器。');
      return;
    }

    const isRecording = this.widget.isCurrentlyRecording();

    if (isRecording) {
      this.speechEngine.stop();
      this.widget.setRecording(false);
    } else {
      this.speechEngine.start();
      this.widget.setRecording(true);
    }
  }

  private async loadConfig() {
    try {
      const config = await chrome.storage.local.get(['defaultLanguage', 'autoStart']) as Record<string, any>;
      if (config.defaultLanguage) {
        this.speechEngine.setLanguage(config.defaultLanguage as string);
      }
    } catch {
      // 扩展环境不可用时忽略
    }
  }
}

// ========== 启动 ==========

// 等待页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new LinguaSyncController();
  });
} else {
  new LinguaSyncController();
}
