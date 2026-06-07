import { useState, useEffect } from 'react';

const LANGUAGES = [
  { value: 'en-US', label: '英语 (美国)' },
  { value: 'en-GB', label: '英语 (英国)' },
  { value: 'ja-JP', label: '日语' },
  { value: 'ko-KR', label: '韩语' },
  { value: 'fr-FR', label: '法语' },
  { value: 'de-DE', label: '德语' },
  { value: 'es-ES', label: '西班牙语' },
  { value: 'ru-RU', label: '俄语' },
];

export default function Popup() {
  const [language, setLanguage] = useState('en-US');
  const [autoStart, setAutoStart] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [subtitleEnabled, setSubtitleEnabled] = useState(true);
  const [screenVisionEnabled, setScreenVisionEnabled] = useState(false);
  const [tooltipsEnabled, setTooltipsEnabled] = useState(true);
  const [mindmapEnabled, setMindmapEnabled] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['defaultLanguage', 'autoStart', 'ttsEnabled', 'subtitleEnabled', 'screenVisionEnabled', 'tooltipsEnabled', 'mindmapEnabled'], (result: Record<string, any>) => {
      if (result.defaultLanguage) setLanguage(result.defaultLanguage as string);
      if (result.autoStart !== undefined) setAutoStart(result.autoStart as boolean);
      if (result.ttsEnabled !== undefined) setTtsEnabled(result.ttsEnabled as boolean);
      if (result.subtitleEnabled !== undefined) setSubtitleEnabled(result.subtitleEnabled as boolean);
      if (result.screenVisionEnabled !== undefined) setScreenVisionEnabled(result.screenVisionEnabled as boolean);
      if (result.tooltipsEnabled !== undefined) setTooltipsEnabled(result.tooltipsEnabled as boolean);
      if (result.mindmapEnabled !== undefined) setMindmapEnabled(result.mindmapEnabled as boolean);
    });
  }, []);

  const handleSave = () => {
    chrome.storage.local.set({ defaultLanguage: language, autoStart, ttsEnabled, subtitleEnabled, screenVisionEnabled, tooltipsEnabled, mindmapEnabled }, () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <div className="w-[320px] bg-[#0D1117] text-white font-mono">
      {/* 头部 — 终端标题栏 */}
      <div className="px-5 py-4 border-b border-[#21262D] bg-[#010409]">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded flex items-center justify-center text-sm font-bold bg-[#161B22] border border-[#30363D] text-[#58A6FF]">
            {'>'}
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-wider text-[#C9D1D9]" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace" }}>
              LinguaSync<span className="text-[#58A6FF] ml-1 text-xs bg-[rgba(88,166,255,0.1)] px-1.5 py-0.5 rounded border border-[rgba(88,166,255,0.2)]">PRO</span>
            </h1>
            <p className="text-[10px] text-[#6E7681] mt-0.5">// AI 视频同声传译</p>
          </div>
        </div>
      </div>

      {/* 设置区 — 终端配置面板 */}
      <div className="p-5 space-y-4">
        {/* 源语言 */}
        <div>
          <label className="block text-[11px] font-medium text-[#8B949E] mb-2" style={{ fontFamily: "'JetBrains Mono', Consolas, monospace" }}>
            <span className="text-[#6E7681]">$ </span>source_language
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full px-3 py-2 rounded bg-[#161B22] border border-[#30363D] text-sm text-[#C9D1D9] outline-none focus:border-[#58A6FF] transition-colors"
            style={{ fontFamily: "'JetBrains Mono', Consolas, monospace" }}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>

        {/* 自动开始 */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[#8B949E]"><span className="text-[#6E7681]">$ </span>auto_start</span>
          <button
            onClick={() => setAutoStart(!autoStart)}
            className={`w-9 h-5 rounded transition-colors relative ${
              autoStart ? 'bg-[#1F6FEB]' : 'bg-[#21262D]'
            }`}
          >
            <div
              className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all ${
                autoStart ? 'left-[18px]' : 'left-[3px]'
              }`}
            />
          </button>
        </div>

        {/* 语音朗读 */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[#8B949E]"><span className="text-[#6E7681]">$ </span>tts_voice</span>
          <button
            onClick={() => setTtsEnabled(!ttsEnabled)}
            className={`w-9 h-5 rounded transition-colors relative ${
              ttsEnabled ? 'bg-[#238636]' : 'bg-[#21262D]'
            }`}
          >
            <div
              className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all ${
                ttsEnabled ? 'left-[18px]' : 'left-[3px]'
              }`}
            />
          </button>
        </div>

        {/* 字幕叠加 */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[#8B949E]"><span className="text-[#6E7681]">$ </span>subtitle_overlay</span>
          <button
            onClick={() => setSubtitleEnabled(!subtitleEnabled)}
            className={`w-9 h-5 rounded transition-colors relative ${
              subtitleEnabled ? 'bg-[#9E6A03]' : 'bg-[#21262D]'
            }`}
          >
            <div
              className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all ${
                subtitleEnabled ? 'left-[18px]' : 'left-[3px]'
              }`}
            />
          </button>
        </div>

        {/* 屏幕视界增强 */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[#8B949E]"><span className="text-[#6E7681]">$ </span>screen_vision</span>
          <button
            onClick={() => setScreenVisionEnabled(!screenVisionEnabled)}
            className={`w-9 h-5 rounded transition-colors relative ${
              screenVisionEnabled ? 'bg-[#8957E5]' : 'bg-[#21262D]'
            }`}
          >
            <div
              className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all ${
                screenVisionEnabled ? 'left-[18px]' : 'left-[3px]'
              }`}
            />
          </button>
        </div>

        {/* 知识胶囊 */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[#8B949E]"><span className="text-[#6E7681]">$ </span>live_tooltips</span>
          <button
            onClick={() => setTooltipsEnabled(!tooltipsEnabled)}
            className={`w-9 h-5 rounded transition-colors relative ${
              tooltipsEnabled ? 'bg-[#D2A8FF]/40' : 'bg-[#21262D]'
            }`}
          >
            <div
              className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all ${
                tooltipsEnabled ? 'left-[18px]' : 'left-[3px]'
              }`}
            />
          </button>
        </div>

        {/* 实时思维导图 */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[#8B949E]"><span className="text-[#6E7681]">$ </span>auto_mindmap</span>
          <button
            onClick={() => setMindmapEnabled(!mindmapEnabled)}
            className={`w-9 h-5 rounded transition-colors relative ${
              mindmapEnabled ? 'bg-[#F78166]/50' : 'bg-[#21262D]'
            }`}
          >
            <div
              className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all ${
                mindmapEnabled ? 'left-[18px]' : 'left-[3px]'
              }`}
            />
          </button>
        </div>

        {/* 保存按钮 */}
        <button
          onClick={handleSave}
          className="w-full py-2 rounded bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] hover:border-[#484F58] text-[#C9D1D9] text-sm font-medium transition-colors"
          style={{ fontFamily: "'JetBrains Mono', Consolas, monospace" }}
        >
          {saved ? (
            <span><span className="text-[#3FB950]">✓</span> saved</span>
          ) : (
            <span><span className="text-[#6E7681]">$ </span>save_config</span>
          )}
        </button>
      </div>

      {/* 底部提示 */}
      <div className="px-5 pb-4 border-t border-[#21262D] pt-3">
        <p className="text-[10px] text-[#484F58] leading-relaxed" style={{ fontFamily: "'JetBrains Mono', Consolas, monospace" }}>
          <span className="text-[#6E7681]">// </span>
          打开含视频网页 → 悬浮窗自动浮现 → 开始同传
        </p>
        <p className="text-[10px] text-[#484F58] leading-relaxed mt-1" style={{ fontFamily: "'JetBrains Mono', Consolas, monospace" }}>
          <span className="text-[#6E7681]">// </span>
          <kbd className="text-[#58A6FF] bg-[#161B22] px-1 rounded border border-[#30363D]">Alt+T</kbd> 开关
          <span className="mx-1">·</span>
          <kbd className="text-[#58A6FF] bg-[#161B22] px-1 rounded border border-[#30363D]">Alt+E</kbd> 导出
        </p>
      </div>
    </div>
  );
}
