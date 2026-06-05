export type BackendType = 'webspeech' | 'openai' | 'custom';

export type SourceLanguage =
  | 'en-US'
  | 'en-GB'
  | 'ja-JP'
  | 'ko-KR'
  | 'fr-FR'
  | 'de-DE'
  | 'es-ES'
  | 'ru-RU'
  | 'auto';

export interface BackendConfig {
  type: BackendType;
  openaiApiKey: string;
  openaiModel: string;
  translationModel: string;
  customEndpoint: string;
}

export interface TranscriptSegment {
  id: string;
  originalText: string;
  translatedText: string;
  startTime: number;
  endTime: number;
  isFinal: boolean;
  isCorrected: boolean;
  confidence: number;
  correctionCount: number;
}

export interface AppState {
  isRecording: boolean;
  isProcessing: boolean;
  interimOriginal: string;
  interimTranslated: string;
  segments: TranscriptSegment[];
  backend: BackendConfig;
  sourceLanguage: SourceLanguage;
  targetLanguage: string;
  audioLevel: number;
  elapsedTime: number;
  error: string | null;
  showSettings: boolean;
  inputMode: 'microphone' | 'file';
  fileName: string | null;
  fileProgress: number;
}

export const LANGUAGE_LABELS: Record<SourceLanguage, string> = {
  'auto': '自动检测',
  'en-US': '英语 (美国)',
  'en-GB': '英语 (英国)',
  'ja-JP': '日语',
  'ko-KR': '韩语',
  'fr-FR': '法语',
  'de-DE': '德语',
  'es-ES': '西班牙语',
  'ru-RU': '俄语',
};
