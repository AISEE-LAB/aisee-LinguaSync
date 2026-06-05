import { create } from 'zustand';
import type { AppState, TranscriptSegment, BackendConfig, SourceLanguage } from '../types';

interface AppActions {
  // 录音控制
  setRecording: (v: boolean) => void;
  setProcessing: (v: boolean) => void;

  // 实时识别
  setInterimOriginal: (text: string) => void;
  setInterimTranslated: (text: string) => void;

  // 字幕段落
  addSegment: (segment: TranscriptSegment) => void;
  updateSegment: (id: string, patch: Partial<TranscriptSegment>) => void;
  clearSegments: () => void;

  // 设置
  setBackend: (config: Partial<BackendConfig>) => void;
  setSourceLanguage: (lang: SourceLanguage) => void;
  setShowSettings: (v: boolean) => void;

  // 输入模式
  setInputMode: (mode: 'microphone' | 'file') => void;
  setFileName: (name: string | null) => void;
  setFileProgress: (progress: number) => void;

  // 音频
  setAudioLevel: (level: number) => void;
  setElapsedTime: (t: number) => void;

  // 错误
  setError: (error: string | null) => void;

  // 导出
  exportTranscript: () => string;
}

const STORAGE_KEY = 'ai-interpreter-backend';

function loadBackend(): BackendConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return {
    type: 'webspeech',
    openaiApiKey: '',
    openaiModel: 'whisper-1',
    translationModel: 'gpt-4o-mini',
    customEndpoint: '',
  };
}

function saveBackend(config: BackendConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {}
}

export const useAppStore = create<AppState & AppActions>((set, get) => ({
  // --- 初始状态 ---
  isRecording: false,
  isProcessing: false,
  interimOriginal: '',
  interimTranslated: '',
  segments: [],
  backend: loadBackend(),
  sourceLanguage: 'en-US',
  targetLanguage: 'zh-CN',
  audioLevel: 0,
  elapsedTime: 0,
  error: null,
  showSettings: false,
  inputMode: 'microphone',
  fileName: null,
  fileProgress: 0,

  // --- Actions ---
  setRecording: (v) => set({ isRecording: v }),
  setProcessing: (v) => set({ isProcessing: v }),
  setInterimOriginal: (text) => set({ interimOriginal: text }),
  setInterimTranslated: (text) => set({ interimTranslated: text }),

  addSegment: (segment) =>
    set((state) => ({ segments: [...state.segments, segment] })),

  updateSegment: (id, patch) =>
    set((state) => ({
      segments: state.segments.map((s) =>
        s.id === id ? { ...s, ...patch, isCorrected: true, correctionCount: s.correctionCount + 1 } : s
      ),
    })),

  clearSegments: () => set({ segments: [], elapsedTime: 0 }),

  setBackend: (config) =>
    set((state) => {
      const newBackend = { ...state.backend, ...config };
      saveBackend(newBackend);
      return { backend: newBackend };
    }),

  setSourceLanguage: (lang) => set({ sourceLanguage: lang }),
  setShowSettings: (v) => set({ showSettings: v }),
  setInputMode: (mode) => set({ inputMode: mode, fileName: null, fileProgress: 0 }),
  setFileName: (name) => set({ fileName: name }),
  setFileProgress: (progress) => set({ fileProgress: progress }),
  setAudioLevel: (level) => set({ audioLevel: level }),
  setElapsedTime: (t) => set({ elapsedTime: t }),
  setError: (error) => set({ error }),

  exportTranscript: () => {
    const { segments } = get();
    const lines = segments
      .filter((s) => s.isFinal)
      .map((s) => {
        const ts = `[${formatTime(s.startTime)}]`;
        return `${ts} ${s.originalText}\n${ts} ${s.translatedText}\n`;
      });
    return lines.join('\n');
  },
}));

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
