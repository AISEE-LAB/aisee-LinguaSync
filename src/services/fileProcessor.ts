/**
 * 音视频文件处理器
 *
 * 支持:
 *  - 通过 Whisper API 转录上传的音视频文件
 *  - 通过浏览器 MediaElement 播放 + Web Speech API 实时识别
 */

export interface FileProcessorCallbacks {
  onProgress: (progress: number) => void;
  onSegment: (text: string, startSec: number, endSec: number) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}

/**
 * 使用 Web Speech API + 音频播放进行文件识别 (免费方案)
 */
export async function processFileWithWebSpeech(
  file: File,
  callbacks: FileProcessorCallbacks,
  language: string
): Promise<() => void> {
  // 创建音频元素播放文件
  const audioUrl = URL.createObjectURL(file);
  const audio = new Audio(audioUrl);

  // 检查浏览器支持
  const SpeechRecognition =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    callbacks.onError('当前浏览器不支持语音识别');
    return () => {};
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = language === 'auto' ? 'en-US' : language;

  let currentTime = 0;

  recognition.onresult = (event: any) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        const text = event.results[i][0].transcript;
        const startSec = currentTime;
        currentTime = audio.currentTime;
        callbacks.onSegment(text, startSec, currentTime);
      }
    }

    // 更新进度
    if (audio.duration) {
      callbacks.onProgress((audio.currentTime / audio.duration) * 100);
    }
  };

  recognition.onerror = (event: any) => {
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      callbacks.onError(`识别错误: ${event.error}`);
    }
  };

  audio.onended = () => {
    recognition.stop();
    callbacks.onComplete();
    URL.revokeObjectURL(audioUrl);
  };

  audio.onerror = () => {
    callbacks.onError('无法播放音频文件，请检查文件格式。');
    URL.revokeObjectURL(audioUrl);
  };

  // 播放音频 + 启动识别
  recognition.start();
  try {
    await audio.play();
  } catch (e: any) {
    callbacks.onError(`播放音频失败: ${e.message}`);
    recognition.stop();
  }

  // 返回停止函数
  return () => {
    audio.pause();
    recognition.stop();
    URL.revokeObjectURL(audioUrl);
  };
}

/**
 * 格式化时间戳为可读字符串
 */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}
