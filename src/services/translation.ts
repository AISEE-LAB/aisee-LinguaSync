/**
 * 翻译服务 — 多后端适配器
 *
 * 支持:
 *  1. MyMemory API (免费, 无需 API Key)
 *  2. OpenAI GPT (高质量上下文感知翻译)
 *  3. 自定义后端
 */

import type { BackendConfig } from '../types';

// ---------- 公共接口 ----------

export interface Translator {
  translate(text: string, context?: string[]): Promise<string>;
}

// ---------- MyMemory 免费翻译 ----------

export class MyMemoryTranslator implements Translator {
  private sourceLang: string;
  private targetLang: string;

  constructor(sourceLang: string = 'en', targetLang: string = 'zh-CN') {
    this.sourceLang = this.mapLocale(sourceLang);
    this.targetLang = targetLang;
  }

  private mapLocale(locale: string): string {
    const map: Record<string, string> = {
      'en-US': 'en',
      'en-GB': 'en',
      'ja-JP': 'ja',
      'ko-KR': 'ko',
      'fr-FR': 'fr',
      'de-DE': 'de',
      'es-ES': 'es',
      'ru-RU': 'ru',
    };
    return map[locale] || locale.split('-')[0] || 'en';
  }

  async translate(text: string): Promise<string> {
    if (!text.trim()) return '';

    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
        text
      )}&langpair=${this.sourceLang}|${this.targetLang}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`翻译请求失败: ${res.status}`);

      const data = await res.json();
      if (data.responseStatus === 200) {
        return data.responseData.translatedText;
      }
      throw new Error(data.responseDetails || '翻译失败');
    } catch (e: any) {
      console.error('MyMemory translation error:', e);
      return `[翻译失败] ${text}`;
    }
  }
}

// ---------- OpenAI GPT 翻译 ----------

export class OpenAITranslator implements Translator {
  private config: BackendConfig;
  private recentContext: string[] = [];
  private maxContext = 5;

  constructor(config: BackendConfig) {
    this.config = config;
  }

  async translate(text: string, context?: string[]): Promise<string> {
    if (!text.trim()) return '';
    if (!this.config.openaiApiKey) {
      return '[请先配置 OpenAI API Key]';
    }

    const contextStr = context?.length
      ? `\n上下文参考（已翻译的前文）:\n${context.slice(-this.maxContext).join('\n')}`
      : '';

    const model = this.config.translationModel || 'gpt-4o-mini';

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.openaiApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: `你是一位专业的同声传译员。请将以下文本翻译成流畅自然的中文。
要求：
1. 保持原文的信息完整性，不遗漏不增添
2. 使用符合中文表达习惯的自然语句
3. 如果是技术内容，保留关键术语的原文（如 "React", "API" 等）
4. 如果文本不完整（句子被截断），翻译已有部分即可
5. 仅输出翻译结果，不要任何额外说明${contextStr}`,
            },
            { role: 'user', content: text },
          ],
          temperature: 0.3,
          max_tokens: 1024,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `API 请求失败: ${res.status}`);
      }

      const data = await res.json();
      const translated = data.choices?.[0]?.message?.content?.trim();
      if (!translated) throw new Error('翻译结果为空');

      // 更新上下文
      this.recentContext.push(`${text} → ${translated}`);
      if (this.recentContext.length > this.maxContext) {
        this.recentContext.shift();
      }

      return translated;
    } catch (e: any) {
      console.error('OpenAI translation error:', e);
      return `[翻译失败] ${text}`;
    }
  }
}

// ---------- 自定义后端翻译 ----------

export class CustomTranslator implements Translator {
  private endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  async translate(text: string, context?: string[]): Promise<string> {
    if (!text.trim()) return '';
    if (!this.endpoint) return '[请先配置自定义翻译端点]';

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, context: context?.slice(-5) || [] }),
      });

      if (!res.ok) throw new Error(`自定义翻译请求失败: ${res.status}`);
      const data = await res.json();
      return data.translated || data.text || data.result || '[翻译结果为空]';
    } catch (e: any) {
      console.error('Custom translation error:', e);
      return `[翻译失败] ${text}`;
    }
  }
}

// ---------- 工厂函数 ----------

export function createTranslator(
  config: BackendConfig,
  sourceLanguage: string
): Translator {
  switch (config.type) {
    case 'webspeech':
      return new MyMemoryTranslator(sourceLanguage);
    case 'openai':
      return new OpenAITranslator(config);
    case 'custom':
      return config.customEndpoint
        ? new CustomTranslator(config.customEndpoint)
        : new MyMemoryTranslator(sourceLanguage);
    default:
      return new MyMemoryTranslator(sourceLanguage);
  }
}
