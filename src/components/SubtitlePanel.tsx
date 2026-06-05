import { useEffect, useRef } from 'react';
import { CheckCircle, RefreshCw } from 'lucide-react';
import { useAppStore } from '../store';
import { formatTimestamp } from '../services/fileProcessor';

export function SubtitlePanel() {
  const segments = useAppStore((s) => s.segments);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments]);

  const finalSegments = segments.filter((s) => s.isFinal);

  return (
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0 p-4">
      {/* 原文面板 */}
      <div className="flex flex-col rounded-2xl bg-indigo-950/40 border border-indigo-800/20 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-indigo-800/20">
          <span className="w-2 h-2 rounded-full bg-blue-400" />
          <span className="text-sm font-medium text-indigo-200">原文 Original</span>
          <span className="ml-auto text-xs text-indigo-400/50">
            {finalSegments.length} 句
          </span>
        </div>
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth"
        >
          {finalSegments.length === 0 ? (
            <div className="flex items-center justify-center h-full text-indigo-400/40 text-sm">
              开始录音或上传文件后，原文将显示在这里
            </div>
          ) : (
            finalSegments.map((seg) => (
              <div
                key={seg.id}
                className={`group relative transition-all duration-300 ${
                  seg.isCorrected ? 'animate-pulse-once' : ''
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="text-xs text-indigo-500/60 font-mono mt-1 shrink-0">
                    {formatTimestamp(seg.startTime)}
                  </span>
                  <p className="text-indigo-100 leading-relaxed">{seg.originalText}</p>
                </div>
                {seg.isCorrected && (
                  <div className="flex items-center gap-1 mt-1 ml-8">
                    <RefreshCw className="w-3 h-3 text-amber-400" />
                    <span className="text-xs text-amber-400/70">已修正</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 译文面板 */}
      <div className="flex flex-col rounded-2xl bg-indigo-950/40 border border-indigo-800/20 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-indigo-800/20">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-sm font-medium text-indigo-200">译文 中文翻译</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth">
          {finalSegments.length === 0 ? (
            <div className="flex items-center justify-center h-full text-indigo-400/40 text-sm">
              翻译结果将同步显示在这里
            </div>
          ) : (
            finalSegments.map((seg) => (
              <div
                key={seg.id + '-zh'}
                className="group relative transition-all duration-300"
              >
                <div className="flex items-start gap-2">
                  <span className="text-xs text-indigo-500/60 font-mono mt-1 shrink-0">
                    {formatTimestamp(seg.startTime)}
                  </span>
                  <p className="text-white leading-relaxed">{seg.translatedText}</p>
                </div>
                {seg.isCorrected && (
                  <div className="flex items-center gap-1 mt-1 ml-8">
                    <CheckCircle className="w-3 h-3 text-emerald-400" />
                    <span className="text-xs text-emerald-400/70">已更新</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
