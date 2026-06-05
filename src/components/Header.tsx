import { Languages, Settings } from 'lucide-react';
import { useAppStore } from '../store';

export function Header() {
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const isRecording = useAppStore((s) => s.isRecording);

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-indigo-800/30">
      <div className="flex items-center gap-3">
        <div className="relative">
          <Languages className="w-8 h-8 text-indigo-400" />
          {isRecording && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          )}
        </div>
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            AI 同声传译助手
          </h1>
          <p className="text-xs text-indigo-300/60">
            Real-time Speech Translation
          </p>
        </div>
      </div>

      <button
        onClick={() => setShowSettings(true)}
        className="p-2.5 rounded-xl bg-indigo-900/40 hover:bg-indigo-800/60 text-indigo-300 hover:text-white transition-all duration-200 cursor-pointer"
        title="设置"
      >
        <Settings className="w-5 h-5" />
      </button>
    </header>
  );
}
