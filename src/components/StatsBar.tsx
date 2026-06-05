import { useAppStore } from '../store';
import { formatTimestamp } from '../services/fileProcessor';

export function StatsBar() {
  const isRecording = useAppStore((s) => s.isRecording);
  const isProcessing = useAppStore((s) => s.isProcessing);
  const elapsedTime = useAppStore((s) => s.elapsedTime);
  const segments = useAppStore((s) => s.segments);
  const backend = useAppStore((s) => s.backend);
  const fileName = useAppStore((s) => s.fileName);
  const fileProgress = useAppStore((s) => s.fileProgress);
  const inputMode = useAppStore((s) => s.inputMode);

  const finalCount = segments.filter((s) => s.isFinal).length;
  const correctedCount = segments.filter((s) => s.isCorrected).length;

  const backendLabel = {
    webspeech: 'Web Speech',
    openai: 'OpenAI',
    custom: '自定义',
  }[backend.type];

  return (
    <div className="flex items-center gap-4 px-4 py-2 text-xs text-indigo-400/50 border-t border-indigo-800/10 bg-indigo-950/80">
      <span>后端: {backendLabel}</span>
      <span className="w-px h-3 bg-indigo-700/30" />

      {inputMode === 'microphone' ? (
        <span>
          时长: {formatTimestamp(elapsedTime)}
        </span>
      ) : (
        <>
          {fileName && <span>文件: {fileName}</span>}
          {isProcessing && <span>进度: {fileProgress.toFixed(0)}%</span>}
        </>
      )}

      <span className="w-px h-3 bg-indigo-700/30" />
      <span>已识别: {finalCount} 句</span>

      {correctedCount > 0 && (
        <>
          <span className="w-px h-3 bg-indigo-700/30" />
          <span className="text-amber-400/60">自动修正: {correctedCount} 次</span>
        </>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isRecording || isProcessing
              ? 'bg-emerald-400 animate-pulse'
              : 'bg-indigo-600'
          }`}
        />
        <span>
          {isRecording ? '录音中' : isProcessing ? '处理中' : '就绪'}
        </span>
      </div>
    </div>
  );
}
