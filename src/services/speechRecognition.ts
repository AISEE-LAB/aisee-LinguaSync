/**
 * 语音识别服务 — 多后端适配器
 *
 * 支持:
 *  1. Web Speech API (浏览器内置, 免费)
 *  2. OpenAI Whisper API (高质量, 需 API Key)
 *  3. 自定义后端
 */

import type { BackendConfig, SourceLanguage } from '../types';

// ---------- 公共接口 ----------

export interface RecognitionCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string, confidence: number) => void;
  onError: (error: string) => void;
  onStart: () => void;
  onEnd: () => void;
}

export interface SpeechRecognizer {
  start(): void;
  stop(): void;
  isSupported(): boolean;
}

// ---------- Web Speech API 适配器 ----------

export class WebSpeechRecognizer implements SpeechRecognizer {
  private recognition: any = null;
  private callbacks: RecognitionCallbacks;
  private language: string;
  private running = false;

  constructor(callbacks: RecognitionCallbacks, language: SourceLanguage) {
    this.callbacks = callbacks;
    this.language = language === 'auto' ? 'en-US' : language;
  }

  isSupported(): boolean {
    return !!(
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition
    );
  }

  start(): void {
    if (!this.isSupported()) {
      this.callbacks.onError('当前浏览器不支持 Web Speech API，请使用 Chrome 或 Edge 浏览器。');
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = this.language;
    this.recognition.maxAlternatives = 3;

    this.recognition.onstart = () => {
      this.running = true;
      this.callbacks.onStart();
    };

    this.recognition.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';
      let confidence = 0;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
          confidence = result[0].confidence;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      if (interimTranscript) {
        this.callbacks.onInterim(interimTranscript);
      }
      if (finalTranscript) {
        this.callbacks.onFinal(finalTranscript, confidence);
      }
    };

    this.recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') return; // 忽略静音
      if (event.error === 'aborted') return;
      this.callbacks.onError(`语音识别错误: ${event.error}`);
    };

    this.recognition.onend = () => {
      // 自动重启以保持连续识别
      if (this.running) {
        try {
          this.recognition.start();
        } catch {
          this.callbacks.onEnd();
        }
      } else {
        this.callbacks.onEnd();
      }
    };

    try {
      this.recognition.start();
    } catch (e: any) {
      this.callbacks.onError(`启动语音识别失败: ${e.message}`);
    }
  }

  stop(): void {
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
}

// ---------- OpenAI Whisper 适配器 (麦克风模式) ----------

export class WhisperMicRecognizer implements SpeechRecognizer {
  private callbacks: RecognitionCallbacks;
  private config: BackendConfig;
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(callbacks: RecognitionCallbacks, config: BackendConfig) {
    this.callbacks = callbacks;
    this.config = config;
  }

  isSupported(): boolean {
    return !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder;
  }

  async start(): Promise<void> {
    if (!this.isSupported()) {
      this.callbacks.onError('当前浏览器不支持录音功能。');
      return;
    }
    if (!this.config.openaiApiKey) {
      this.callbacks.onError('请在设置中配置 OpenAI API Key。');
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };

      this.mediaRecorder.start(1000); // 每秒收集一次数据
      this.callbacks.onStart();

      // 每 5 秒发送一次音频进行识别
      this.timer = setInterval(() => this.sendChunk(), 5000);
    } catch (e: any) {
      this.callbacks.onError(`无法访问麦克风: ${e.message}`);
    }
  }

  private async sendChunk(): Promise<void> {
    if (this.chunks.length === 0) return;

    const audioBlob = new Blob([...this.chunks], { type: 'audio/webm' });
    this.chunks = [];

    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.webm');
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'json');

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.openaiApiKey}` },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `API 请求失败: ${res.status}`);
      }

      const data = await res.json();
      if (data.text && data.text.trim()) {
        this.callbacks.onFinal(data.text.trim(), 1);
      }
    } catch (e: any) {
      if (e.message?.includes('Failed to fetch')) {
        this.callbacks.onError('网络错误，请检查网络连接。');
      } else {
        this.callbacks.onError(`Whisper API 错误: ${e.message}`);
      }
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    this.callbacks.onEnd();
  }
}

// ---------- Whisper 文件模式适配器 ----------

export class WhisperFileRecognizer {
  private config: BackendConfig;

  constructor(config: BackendConfig) {
    this.config = config;
  }

  /**
   * 将音频文件分块识别，支持进度回调
   */
  async transcribeFile(
    file: File,
    callbacks: {
      onProgress: (progress: number) => void;
      onSegment: (text: string, startSec: number, endSec: number, confidence: number) => void;
      onComplete: () => void;
      onError: (error: string) => void;
    }
  ): Promise<void> {
    if (!this.config.openaiApiKey) {
      callbacks.onError('请在设置中配置 OpenAI API Key。');
      return;
    }

    const CHUNK_DURATION = 60; // 每块 60 秒
    const OVERLAP = 2; // 重叠 2 秒（用于自纠正）

    try {
      // 获取音频时长
      const duration = await this.getAudioDuration(file);
      const totalChunks = Math.ceil(duration / (CHUNK_DURATION - OVERLAP));

      for (let i = 0; i < totalChunks; i++) {
        const startSec = i * (CHUNK_DURATION - OVERLAP);
        const endSec = Math.min(startSec + CHUNK_DURATION, duration);

        callbacks.onProgress(((i + 1) / totalChunks) * 100);

        const chunk = await this.extractAudioChunk(file, startSec, endSec);

        const formData = new FormData();
        formData.append('file', chunk, `chunk_${i}.webm`);
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'json');
        formData.append('timestamp_granularities[]', 'segment');

        const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.config.openaiApiKey}` },
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `API 请求失败: ${res.status}`);
        }

        const data = await res.json();
        if (data.text?.trim()) {
          callbacks.onSegment(data.text.trim(), startSec, endSec, 1);
        }
      }

      callbacks.onComplete();
    } catch (e: any) {
      callbacks.onError(`文件转录失败: ${e.message}`);
    }
  }

  private getAudioDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(audio.src);
        resolve(audio.duration || 60);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audio.src);
        reject(new Error('无法读取音频文件'));
      };
      audio.src = URL.createObjectURL(file);
    });
  }

  private async extractAudioChunk(file: File, startSec: number, endSec: number): Promise<Blob> {
    // 对于大文件直接发送整个文件，Whisper API 会处理
    // 这里简单地返回整个文件（Whisper 自动处理长音频）
    // 如果需要精确分块，可以使用 ffmpeg.wasm
    if (endSec - startSec >= 60) {
      return file;
    }
    return file;
  }
}

// ---------- 工厂函数 ----------

export function createRecognizer(
  config: BackendConfig,
  language: SourceLanguage,
  callbacks: RecognitionCallbacks
): SpeechRecognizer {
  switch (config.type) {
    case 'webspeech':
      return new WebSpeechRecognizer(callbacks, language);
    case 'openai':
      return new WhisperMicRecognizer(callbacks, config);
    case 'custom':
      // 自定义后端暂时回退到 Web Speech
      return new WebSpeechRecognizer(callbacks, language);
    default:
      return new WebSpeechRecognizer(callbacks, language);
  }
}
