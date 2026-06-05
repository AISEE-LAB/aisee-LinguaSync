import { useRef, useCallback } from 'react';
import { Mic, MicOff, Square, Download, Trash2, Upload } from 'lucide-react';
import { useAppStore } from '../store';
import { LANGUAGE_LABELS } from '../types';
import type { SourceLanguage } from '../types';

interface ControlBarProps {
  onStartRecording: () => void;
  onStopRecording: () => void;
  onFileSelect: (file: File) => void;
}

export function ControlBar({ onStartRecording, onStopRecording, onFileSelect }: ControlBarProps) {
  const isRecording = useAppStore((s) => s.isRecording);
  const isProcessing = useAppStore((s) => s.isProcessing);
  const inputMode = useAppStore((s) => s.inputMode);
  const setInputMode = useAppStore((s) => s.setInputMode);
  const sourceLanguage = useAppStore((s) => s.sourceLanguage);
  const setSourceLanguage = useAppStore((s) => s.setSourceLanguage);
  const exportTranscript = useAppStore((s) => s.exportTranscript);
  const clearSegments = useAppStore((s) => s.clearSegments);
  const segments = useAppStore((s) => s.segments);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  const handleExport = useCallback(() => {
    const text = exportTranscript();
    if (!text.trim()) return;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportTranscript]);

  const hasSegments = segments.length > 0;

  return (
    <div className="px-4 py-3 border-t border-indigo-800/20 bg-indigo-950/60">
      <div className="flex flex-wrap items-center gap-3">
        {/* 输入模式切换 */}
        <div className="flex rounded-xl bg-indigo-900/50 p-1">
          <button
            onClick={() => setInputMode('microphone')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
              inputMode === 'microphone'
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'text-indigo-300 hover:text-white'
            }`}
          >
            <Mic className="w-4 h-4 inline mr-1.5" />
            麦克风
          </button>
          <button
            onClick={() => setInputMode('file')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
              inputMode === 'file'
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'text-indigo-300 hover:text-white'
            }`}
          >
            <Upload className="w-4 h-4 inline mr-1.5" />
            文件
          </button>
        </div>

        {/* 语言选择 */}
        <select
          value={sourceLanguage}
          onChange={(e) => setSourceLanguage(e.target.value as SourceLanguage)}
          className="px-3 py-2 rounded-xl bg-indigo-900/50 border border-indigo-700/30 text-sm text-indigo-200 outline-none focus:border-indigo-500 cursor-pointer"
        >
          {Object.entries(LANGUAGE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        {/* 分隔线 */}
        <div className="w-px h-8 bg-indigo-700/30" />

        {/* 主控制按钮 */}
        {inputMode === 'microphone' ? (
          isRecording ? (
            <button
              onClick={onStopRecording}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium transition-all duration-200 shadow-lg shadow-red-900/30 cursor-pointer"
            >
              <Square className="w-4 h-4 fill-current" />
              停止录音
            </button>
          ) : (
            <button
              onClick={onStartRecording}
              disabled={isProcessing}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-600 text-white font-medium transition-all duration-200 shadow-lg shadow-emerald-900/30 cursor-pointer"
            >
              <Mic className="w-4 h-4" />
              开始录音
            </button>
          )
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-600 text-white font-medium transition-all duration-200 shadow-lg cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              上传音视频文件
            </button>
          </>
        )}

        {/* 右侧工具按钮 */}
        <div className="ml-auto flex items-center gap-2">
          {hasSegments && (
            <>
              <button
                onClick={handleExport}
                className="p-2.5 rounded-xl bg-indigo-900/40 hover:bg-indigo-800/60 text-indigo-300 hover:text-white transition-all cursor-pointer"
                title="导出字幕"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={clearSegments}
                className="p-2.5 rounded-xl bg-indigo-900/40 hover:bg-indigo-800/60 text-indigo-300 hover:text-white transition-all cursor-pointer"
                title="清空记录"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
          {isRecording && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/20">
              <MicOff className="w-3.5 h-3.5 text-red-400 animate-pulse" />
              <span className="text-xs text-red-300 font-medium">录音中</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
