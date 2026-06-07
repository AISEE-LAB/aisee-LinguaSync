/**
 * LinguaSync Pro v2 - 后台 Service Worker
 *
 * 职责:
 *  - 翻译请求分发 (MyMemory / OpenAI GPT)
 *  - 标签页音频捕获协调 (tabCapture)
 *  - 快捷键命令转发
 *  - Offscreen Document 管理
 */

// ---------- 翻译 ----------

async function handleTranslation(
  text: string,
  backend: string,
  apiKey: string
): Promise<{ translated: string }> {
  // OpenAI GPT 翻译
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
                '你是专业同声传译员，将文本翻译为流畅自然的中文。技术术语保留原文（如 React、API）。仅输出翻译结果，不加任何说明。',
            },
            { role: 'user', content: text },
          ],
          temperature: 0.3,
          max_tokens: 512,
        }),
      });
      const data = await res.json();
      const translated = data.choices?.[0]?.message?.content?.trim();
      if (translated) return { translated };
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
    if (data.responseStatus === 200 && data.responseData?.translatedText) {
      const t = data.responseData.translatedText;
      if (t !== text) return { translated: t };
    }
  } catch {
    // ignore
  }

  // Google Translate 免费端点 (备用)
  try {
    const res = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`
    );
    const data = await res.json();
    if (data && data[0]) {
      const translated = data[0].map((item: any[]) => item[0]).filter(Boolean).join('');
      if (translated && translated !== text) return { translated };
    }
  } catch {
    // ignore
  }

  return { translated: text };
}

// ---------- 标签页音频捕获 ----------

async function captureTabAudio(tabId: number): Promise<string | null> {
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    return String(streamId);
  } catch {
    return null;
  }
}

// ---------- Offscreen Document ----------

async function ensureOffscreenDocument() {
  try {
    const existingContexts = await (chrome.runtime as any).getContexts?.({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (existingContexts?.length > 0) return;
  } catch {
    // getContexts may not be available
  }

  try {
    await (chrome.offscreen as any).createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'OCR processing via Tesseract.js for screen-aware translation',
    });
  } catch {
    // already exists or not supported
  }
}

// ---------- 屏幕截图 OCR ----------

/** 截取当前标签页可见区域 */
async function captureVisibleScreen(): Promise<string | null> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({
      format: 'jpeg',
      quality: 75,
    } as any);
    return dataUrl;
  } catch {
    return null;
  }
}

/** 通过 Offscreen Document 执行 OCR */
async function performScreenOCR(imageDataUrl: string): Promise<{
  text: string;
  confidence: number;
  words: string[];
}> {
  await ensureOffscreenDocument();
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'SCREEN_OCR', imageDataUrl },
      (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ text: '', confidence: 0, words: [] });
          return;
        }
        resolve(response);
      }
    );
  });
}

// ---------- AI 待办提取 ----------

async function extractTodos(text: string, apiKey: string): Promise<{ todos: string[] }> {
  if (!apiKey) return { todos: [] };
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
              '你是会议待办提取助手。从给定文本中提取可操作的待办事项（action items）。仅输出 JSON 数组，每项为一条待办。如果没有待办，输出空数组 []。不要添加任何额外说明。',
          },
          { role: 'user', content: text },
        ],
        temperature: 0.2,
        max_tokens: 256,
      }),
    });
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (content) {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return { todos: parsed.filter((t: unknown) => typeof t === 'string') };
    }
  } catch {
    // ignore
  }
  return { todos: [] };
}

// ---------- 消息路由 ----------

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    defaultLanguage: 'en-US',
    translationBackend: 'mymemory',
    openaiApiKey: '',
    autoStart: false,
    audioMode: 'microphone', // 'microphone' | 'tabAudio'
    ttsEnabled: false,
    subtitleEnabled: true,
    screenVisionEnabled: false,
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  // 忽略来自 Offscreen Document 的内部消息
  if (message.type === 'SCREEN_OCR') return false;

  // 翻译请求
  if (message.type === 'TRANSLATE') {
    handleTranslation(message.text, message.backend, message.apiKey)
      .then(sendResponse)
      .catch((err: Error) => sendResponse({ error: err.message }));
    return true;
  }

  // 标签页音频捕获请求
  if (message.type === 'CAPTURE_TAB_AUDIO' && tabId) {
    captureTabAudio(tabId).then((streamId) => {
      sendResponse({ streamId });
    });
    return true;
  }

  // 初始化 Offscreen Document
  if (message.type === 'ENSURE_OFFSCREEN') {
    ensureOffscreenDocument().then(() => sendResponse({ ok: true }));
    return true;
  }

  // 获取配置
  if (message.type === 'GET_CONFIG') {
    chrome.storage.local.get(
      ['defaultLanguage', 'translationBackend', 'openaiApiKey', 'autoStart', 'audioMode', 'ttsEnabled', 'subtitleEnabled', 'screenVisionEnabled'],
      (config) => sendResponse(config)
    );
    return true;
  }

  // AI 待办提取
  if (message.type === 'EXTRACT_TODOS') {
    extractTodos(message.text, message.apiKey)
      .then(sendResponse)
      .catch(() => sendResponse({ todos: [] }));
    return true;
  }

  // 屏幕截图
  if (message.type === 'SCREEN_CAPTURE') {
    captureVisibleScreen()
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch(() => sendResponse({ dataUrl: null }));
    return true;
  }

  // 屏幕 OCR
  if (message.type === 'SCREEN_OCR_REQUEST') {
    performScreenOCR(message.imageDataUrl)
      .then(sendResponse)
      .catch(() => sendResponse({ text: '', confidence: 0, words: [] }));
    return true;
  }

  return true;
});

// ---------- 快捷键转发 ----------

chrome.commands.onCommand.addListener((command) => {
  // 将快捷键转发给当前活动标签页的 content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'COMMAND', command });
    }
  });
});
