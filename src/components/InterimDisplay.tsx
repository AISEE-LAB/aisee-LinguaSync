import { useAppStore } from '../store';

export function InterimDisplay() {
  const interimOriginal = useAppStore((s) => s.interimOriginal);
  const interimTranslated = useAppStore((s) => s.interimTranslated);
  const isRecording = useAppStore((s) => s.isRecording);
  const isProcessing = useAppStore((s) => s.isProcessing);
  const audioLevel = useAppStore((s) => s.audioLevel);

  const showInterim = interimOriginal || interimTranslated;
  const isActive = isRecording || isProcessing;

  return (
    <div className="px-4 py-3 border-t border-indigo-800/20 bg-gradient-to-t from-indigo-950/80 to-transparent">
      {/* 音频可视化 */}
      {isActive && (
        <div className="flex items-center gap-1 mb-2 justify-center">
          {Array.from({ length: 20 }).map((_, i) => {
            const height = isActive ? Math.max(2, audioLevel * (Math.sin(i * 0.8) * 0.5 + 0.5) * 24) : 2;
            return (
              <div
                key={i}
                className="w-1 rounded-full bg-indigo-400/60 transition-all duration-100"
                style={{ height: `${height}px` }}
              />
            );
          })}
        </div>
      )}

      {/* 实时识别文本 */}
      {showInterim ? (
        <div className="space-y-1">
          <div className="flex items-start gap-2">
            <span className="text-xs text-blue-400/60 font-mono shrink-0 mt-0.5">...</span>
            <p className="text-blue-200/70 text-sm italic leading-relaxed">
              {interimOriginal}
            </p>
          </div>
          {interimTranslated && (
            <div className="flex items-start gap-2">
              <span className="text-xs text-emerald-400/60 font-mono shrink-0 mt-0.5">...</span>
              <p className="text-emerald-200/60 text-sm italic leading-relaxed">
                {interimTranslated}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center">
          <p className="text-indigo-400/30 text-sm">
            {isActive
              ? '正在聆听...'
              : '点击下方按钮开始录音，或上传音视频文件'}
          </p>
        </div>
      )}
    </div>
  );
}
