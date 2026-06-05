import { useCallback, useRef, useEffect } from 'react';
import { Header } from './components/Header';
import { SubtitlePanel } from './components/SubtitlePanel';
import { ControlBar } from './components/ControlBar';
import { InterimDisplay } from './components/InterimDisplay';
import { SettingsModal } from './components/SettingsModal';
import { StatsBar } from './components/StatsBar';
import { useAppStore } from './store';
import { createRecognizer, WhisperFileRecognizer } from './services/speechRecognition';
import type { SpeechRecognizer } from './services/speechRecognition';
import { createTranslator } from './services/translation';
import { correctionEngine } from './services/correctionEngine';
import { processFileWithWebSpeech } from './services/fileProcessor';

let segIdCounter = 0;
function nextId() {
  return `seg-${Date.now()}-${++segIdCounter}`;
}

export default function App() {
  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopFileRef = useRef<(() => void) | null>(null);

  // Store actions
  const setRecording = useAppStore((s) => s.setRecording);
  const setProcessing = useAppStore((s) => s.setProcessing);
  const setInterimOriginal = useAppStore((s) => s.setInterimOriginal);
  const setInterimTranslated = useAppStore((s) => s.setInterimTranslated);
  const addSegment = useAppStore((s) => s.addSegment);
  const updateSegment = useAppStore((s) => s.updateSegment);
  const setError = useAppStore((s) => s.setError);
  const setAudioLevel = useAppStore((s) => s.setAudioLevel);
  const setElapsedTime = useAppStore((s) => s.setElapsedTime);
  const setFileName = useAppStore((s) => s.setFileName);
  const setFileProgress = useAppStore((s) => s.setFileProgress);

  // Store state
  const backend = useAppStore((s) => s.backend);
  const sourceLanguage = useAppStore((s) => s.sourceLanguage);
  const error = useAppStore((s) => s.error);

  // ---------- 处理识别到的最终文本 ----------
  const handleFinalText = useCallback(
    async (text: string, confidence: number) => {
      const translator = createTranslator(
        useAppStore.getState().backend,
        useAppStore.getState().sourceLanguage
      );
      const segments = useAppStore.getState().segments;
      const context = correctionEngine.getCorrectionContext(segments);

      // 翻译
      const translated = await translator.translate(text, context);

      const startTime = segments.length > 0
        ? segments[segments.length - 1].endTime
        : 0;
      const endTime = startTime + Math.max(1, text.split(/\s+/).length * 0.3);

      const segment = {
        id: nextId(),
        originalText: text,
        translatedText: translated,
        startTime,
        endTime,
        isFinal: true,
        isCorrected: false,
        confidence,
        correctionCount: 0,
      };

      // 自纠正检查
      const corrections = correctionEngine.checkCorrections(segment, segments);
      for (const correction of corrections) {
        // 重新翻译修正后的文本
        const newTranslation = await translator.translate(
          correction.newText,
          correctionEngine.getCorrectionContext(segments)
        );
        updateSegment(correction.segmentId, {
          originalText: correction.newText,
          translatedText: newTranslation,
        });
      }

      addSegment(segment);

      // 清除临时显示
      setInterimOriginal('');
      setInterimTranslated('');
    },
    [addSegment, updateSegment, setInterimOriginal, setInterimTranslated]
  );

  // ---------- 处理临时识别结果 ----------
  const handleInterimText = useCallback(
    async (text: string) => {
      setInterimOriginal(text);

      // 对临时结果也提供翻译预览（使用防抖）
      if (text.length > 5) {
        const translator = createTranslator(
          useAppStore.getState().backend,
          useAppStore.getState().sourceLanguage
        );
        try {
          const translated = await translator.translate(text);
          setInterimTranslated(translated);
        } catch {
          // 临时翻译失败不显示错误
        }
      }
    },
    [setInterimOriginal, setInterimTranslated]
  );

  // ---------- 开始录音 ----------
  const handleStartRecording = useCallback(() => {
    setError(null);

    const recognizer = createRecognizer(backend, sourceLanguage, {
      onInterim: handleInterimText,
      onFinal: handleFinalText,
      onError: (err) => setError(err),
      onStart: () => {
        setRecording(true);
        // 启动计时器
        let elapsed = useAppStore.getState().elapsedTime;
        timerRef.current = setInterval(() => {
          elapsed += 1;
          setElapsedTime(elapsed);
          // 模拟音频电平 (随机波动)
          setAudioLevel(0.3 + Math.random() * 0.7);
        }, 1000);
      },
      onEnd: () => {
        setRecording(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setAudioLevel(0);
      },
    });

    if (!recognizer.isSupported()) {
      setError('当前浏览器不支持语音识别，请使用 Chrome 或 Edge 浏览器。');
      return;
    }

    recognizerRef.current = recognizer;
    recognizer.start();
  }, [backend, sourceLanguage, handleInterimText, handleFinalText, setRecording, setElapsedTime, setAudioLevel, setError]);

  // ---------- 停止录音 ----------
  const handleStopRecording = useCallback(() => {
    if (recognizerRef.current) {
      recognizerRef.current.stop();
      recognizerRef.current = null;
    }
    setInterimOriginal('');
    setInterimTranslated('');
  }, [setInterimOriginal, setInterimTranslated]);

  // ---------- 文件处理 ----------
  const handleFileSelect = useCallback(
    async (file: File) => {
      setError(null);
      setFileName(file.name);
      setProcessing(true);
      setFileProgress(0);

      const currentBackend = useAppStore.getState().backend;
      const currentLanguage = useAppStore.getState().sourceLanguage;

      if (currentBackend.type === 'webspeech') {
        // 使用 Web Speech API + 音频播放
        try {
          const stopFn = await processFileWithWebSpeech(
            file,
            {
              onProgress: (p) => setFileProgress(p),
              onSegment: async (text, startSec, endSec) => {
                const translator = createTranslator(currentBackend, currentLanguage);
                const segments = useAppStore.getState().segments;
                const context = correctionEngine.getCorrectionContext(segments);
                const translated = await translator.translate(text, context);

                addSegment({
                  id: nextId(),
                  originalText: text,
                  translatedText: translated,
                  startTime: startSec,
                  endTime: endSec,
                  isFinal: true,
                  isCorrected: false,
                  confidence: 0.8,
                  correctionCount: 0,
                });
              },
              onComplete: () => {
                setProcessing(false);
                setFileProgress(100);
              },
              onError: (err) => {
                setError(err);
                setProcessing(false);
              },
            },
            currentLanguage === 'auto' ? 'en-US' : currentLanguage
          );
          stopFileRef.current = stopFn;
        } catch (e: any) {
          setError(`文件处理失败: ${e.message}`);
          setProcessing(false);
        }
      } else {
        // OpenAI Whisper 文件处理
        try {
          const whisperRecognizer = new WhisperFileRecognizer(currentBackend);

          await whisperRecognizer.transcribeFile(file, {
            onProgress: (p) => setFileProgress(p),
            onSegment: async (text, startSec, endSec) => {
              const translator = createTranslator(currentBackend, currentLanguage);
              const segments = useAppStore.getState().segments;
              const context = correctionEngine.getCorrectionContext(segments);
              const translated = await translator.translate(text, context);

              // 重叠纠正检查
              const newSegment = {
                id: nextId(),
                originalText: text,
                translatedText: translated,
                startTime: startSec,
                endTime: endSec,
                isFinal: true,
                isCorrected: false,
                confidence: 1,
                correctionCount: 0,
              };

              const corrections = correctionEngine.checkOverlapCorrections(
                newSegment,
                segments
              );
              for (const c of corrections) {
                updateSegment(c.segmentId, {
                  originalText: c.newText,
                  translatedText: c.newTranslation,
                });
              }

              addSegment(newSegment);
            },
            onComplete: () => {
              setProcessing(false);
              setFileProgress(100);
            },
            onError: (err) => {
              setError(err);
              setProcessing(false);
            },
          });
        } catch (e: any) {
          setError(`文件处理失败: ${e.message}`);
          setProcessing(false);
        }
      }
    },
    [addSegment, updateSegment, setError, setFileName, setProcessing, setFileProgress]
  );

  // ---------- 清理 ----------
  useEffect(() => {
    return () => {
      if (recognizerRef.current) {
        recognizerRef.current.stop();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (stopFileRef.current) {
        stopFileRef.current();
      }
    };
  }, []);

  return (
    <div className="h-screen flex flex-col bg-[#0c0a1d] text-white overflow-hidden">
      <Header />
      <SubtitlePanel />
      <InterimDisplay />
      <ControlBar
        onStartRecording={handleStartRecording}
        onStopRecording={handleStopRecording}
        onFileSelect={handleFileSelect}
      />
      <StatsBar />
      <SettingsModal />

      {/* 全局错误提示 */}
      {error && (
        <div className="fixed top-4 right-4 z-50 max-w-sm p-4 rounded-xl bg-red-950/90 border border-red-700/30 shadow-2xl backdrop-blur-sm">
          <div className="flex items-start gap-2">
            <span className="text-red-400 text-sm">⚠</span>
            <div>
              <p className="text-sm text-red-200">{error}</p>
              <button
                onClick={() => setError(null)}
                className="mt-2 text-xs text-red-400 hover:text-red-300 cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
