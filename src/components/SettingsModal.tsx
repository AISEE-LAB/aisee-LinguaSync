import { useState } from 'react';
import { X, Key, Globe, Cpu } from 'lucide-react';
import { useAppStore } from '../store';
import type { BackendType } from '../types';

export function SettingsModal() {
  const showSettings = useAppStore((s) => s.showSettings);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const backend = useAppStore((s) => s.backend);
  const setBackend = useAppStore((s) => s.setBackend);

  const [activeTab, setActiveTab] = useState<BackendType>(backend.type);

  if (!showSettings) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setShowSettings(false)}
      />

      {/* 模态框 */}
      <div className="relative w-full max-w-lg mx-4 rounded-2xl bg-indigo-950 border border-indigo-700/30 shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-indigo-800/30">
          <h2 className="text-lg font-semibold text-white">设置</h2>
          <button
            onClick={() => setShowSettings(false)}
            className="p-1.5 rounded-lg hover:bg-indigo-800/50 text-indigo-300 hover:text-white transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="p-6 space-y-6">
          {/* 后端选择 */}
          <div>
            <label className="block text-sm font-medium text-indigo-200 mb-3">
              <Cpu className="w-4 h-4 inline mr-1.5" />
              AI 服务后端
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: 'webspeech' as BackendType, label: 'Web Speech', desc: '免费 · 浏览器内置' },
                { key: 'openai' as BackendType, label: 'OpenAI', desc: '高质量 · 需 API Key' },
                { key: 'custom' as BackendType, label: '自定义', desc: '自定义端点' },
              ]).map(({ key, label, desc }) => (
                <button
                  key={key}
                  onClick={() => {
                    setActiveTab(key);
                    setBackend({ type: key });
                  }}
                  className={`p-3 rounded-xl text-center transition-all cursor-pointer ${
                    activeTab === key
                      ? 'bg-indigo-600 text-white shadow-lg ring-2 ring-indigo-400/30'
                      : 'bg-indigo-900/40 text-indigo-300 hover:bg-indigo-800/50'
                  }`}
                >
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs opacity-60 mt-0.5">{desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* OpenAI 配置 */}
          {activeTab === 'openai' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-indigo-200 mb-1.5">
                  <Key className="w-3.5 h-3.5 inline mr-1" />
                  API Key
                </label>
                <input
                  type="password"
                  value={backend.openaiApiKey}
                  onChange={(e) => setBackend({ openaiApiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full px-4 py-2.5 rounded-xl bg-indigo-900/50 border border-indigo-700/30 text-white placeholder-indigo-400/40 outline-none focus:border-indigo-500 transition-colors text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-indigo-200 mb-1.5">
                  语音识别模型
                </label>
                <select
                  value={backend.openaiModel}
                  onChange={(e) => setBackend({ openaiModel: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl bg-indigo-900/50 border border-indigo-700/30 text-white outline-none focus:border-indigo-500 cursor-pointer text-sm"
                >
                  <option value="whisper-1">Whisper-1</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-indigo-200 mb-1.5">
                  翻译模型
                </label>
                <select
                  value={backend.translationModel}
                  onChange={(e) => setBackend({ translationModel: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl bg-indigo-900/50 border border-indigo-700/30 text-white outline-none focus:border-indigo-500 cursor-pointer text-sm"
                >
                  <option value="gpt-4o-mini">GPT-4o Mini (推荐)</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                </select>
              </div>
            </div>
          )}

          {/* 自定义后端配置 */}
          {activeTab === 'custom' && (
            <div>
              <label className="block text-sm font-medium text-indigo-200 mb-1.5">
                <Globe className="w-3.5 h-3.5 inline mr-1" />
                翻译 API 端点
              </label>
              <input
                type="url"
                value={backend.customEndpoint}
                onChange={(e) => setBackend({ customEndpoint: e.target.value })}
                placeholder="https://your-api.com/translate"
                className="w-full px-4 py-2.5 rounded-xl bg-indigo-900/50 border border-indigo-700/30 text-white placeholder-indigo-400/40 outline-none focus:border-indigo-500 transition-colors text-sm"
              />
              <p className="text-xs text-indigo-400/50 mt-1.5">
                端点需接受 POST 请求，body 为 JSON 格式: {'{ "text": "...", "context": [...] }'}，
                返回 {'{ "translated": "..." }'}
              </p>
            </div>
          )}

          {/* Web Speech 说明 */}
          {activeTab === 'webspeech' && (
            <div className="p-4 rounded-xl bg-indigo-900/30 border border-indigo-800/20">
              <p className="text-sm text-indigo-300 leading-relaxed">
                Web Speech API 是浏览器内置的语音识别能力，无需任何 API Key 即可使用。
                翻译功能使用免费的 MyMemory 翻译 API。
              </p>
              <p className="text-xs text-indigo-400/50 mt-2">
                推荐使用 Chrome 或 Edge 浏览器以获得最佳体验。部分浏览器可能不支持此 API。
              </p>
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="flex justify-end px-6 py-4 border-t border-indigo-800/30">
          <button
            onClick={() => setShowSettings(false)}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-all cursor-pointer"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
