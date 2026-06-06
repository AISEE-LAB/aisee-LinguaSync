/**
 * LinguaSync Pro - 后台 Service Worker
 * 管理扩展状态和消息传递
 */

interface TabState {
  enabled: boolean;
  language: string;
}

const tabStates = new Map<number, TabState>();

// 扩展安装时设置默认值
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    defaultLanguage: 'en-US',
    translationBackend: 'mymemory',
    openaiApiKey: '',
    autoStart: false,
  });
});

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message.type === 'GET_STATE' && tabId) {
    const state = tabStates.get(tabId) || { enabled: false, language: 'en-US' };
    sendResponse(state);
  }

  if (message.type === 'SET_STATE' && tabId) {
    tabStates.set(tabId, message.state);
    // 转发给 content script
    chrome.tabs.sendMessage(tabId, {
      type: 'STATE_CHANGED',
      state: message.state,
    });
  }

  if (message.type === 'TRANSLATE') {
    handleTranslation(message.text, message.backend, message.apiKey)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // 保持通道开放以异步响应
  }

  return true;
});

// 当标签页关闭时清理状态
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});

// 翻译处理
async function handleTranslation(
  text: string,
  backend: string,
  apiKey: string
): Promise<{ translated: string }> {
  if (backend === 'openai' && apiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                '你是专业同声传译员，将文本翻译为流畅自然的中文。技术术语保留原文。仅输出翻译结果。',
            },
            { role: 'user', content: text },
          ],
          temperature: 0.3,
          max_tokens: 512,
        }),
      });
      const data = await res.json();
      return { translated: data.choices?.[0]?.message?.content?.trim() || text };
    } catch {
      // 降级到 MyMemory
    }
  }

  // MyMemory 免费翻译
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`
    );
    const data = await res.json();
    if (data.responseStatus === 200) {
      return { translated: data.responseData.translatedText };
    }
  } catch {
    // 忽略
  }

  return { translated: `[翻译失败] ${text}` };
}
