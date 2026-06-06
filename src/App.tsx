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
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['defaultLanguage', 'autoStart'], (result: Record<string, any>) => {
      if (result.defaultLanguage) setLanguage(result.defaultLanguage as string);
      if (result.autoStart !== undefined) setAutoStart(result.autoStart as boolean);
    });
  }, []);

  const handleSave = () => {
    chrome.storage.local.set({ defaultLanguage: language, autoStart }, () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <div className="w-[320px] bg-slate-900 text-white font-sans">
      {/* 头部 */}
      <div className="px-5 py-4 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-sm font-bold">
            L
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-wide">
              LinguaSync <span className="text-indigo-400">Pro</span>
            </h1>
            <p className="text-[10px] text-slate-400">AI 视频同声传译</p>
          </div>
        </div>
      </div>

      {/* 设置区 */}
      <div className="p-5 space-y-4">
        {/* 源语言 */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">
            源语言
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white outline-none focus:border-indigo-500 transition-colors"
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
          <span className="text-xs text-slate-300">检测到视频时自动开始</span>
          <button
            onClick={() => setAutoStart(!autoStart)}
            className={`w-9 h-5 rounded-full transition-colors relative ${
              autoStart ? 'bg-indigo-600' : 'bg-slate-700'
            }`}
          >
            <div
              className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all ${
                autoStart ? 'left-[18px]' : 'left-[3px]'
              }`}
            />
          </button>
        </div>

        {/* 保存按钮 */}
        <button
          onClick={handleSave}
          className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
        >
          {saved ? '已保存' : '保存设置'}
        </button>
      </div>

      {/* 底部提示 */}
      <div className="px-5 pb-4">
        <p className="text-[10px] text-slate-500 leading-relaxed">
          打开任意含视频的网页，LinguaSync 悬浮窗将自动出现。
          点击"开始同传"即可实时翻译。推荐使用 Chrome 浏览器。
        </p>
      </div>
    </div>
  );
}
