# AI 同声传译助手

一款基于 AI 的实时同声传译工具，帮助用户降低语言门槛，提升信息获取效率。

## 功能特性

- **双模式音频输入**：支持实时麦克风采集和音视频文件上传
- **多后端可配置**：Web Speech API（免费）/ OpenAI Whisper + GPT（高质量）/ 自定义端点
- **自纠正引擎**：基于 Levenshtein 相似度算法，自动纠正识别和翻译错误
- **双栏字幕显示**：原文与中文翻译同步显示，带时间戳
- **多语言支持**：英语、日语、韩语、法语、德语、西班牙语、俄语
- **一键导出**：导出带时间戳的双语字幕文本

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

启动后在浏览器打开 `http://localhost:5173/` 即可使用。

> 推荐使用 Chrome 或 Edge 浏览器以获得最佳 Web Speech API 兼容性。

## 技术栈

- React 18 + TypeScript + Vite
- Tailwind CSS v4
- Zustand 状态管理
- Web Speech API / OpenAI Whisper API
- MyMemory Translation API / OpenAI GPT

## 使用说明

1. 点击右上角设置图标选择 AI 后端
2. 选择输入模式（麦克风 / 文件上传）
3. 选择源语言
4. 点击"开始录音"或上传音视频文件
5. 实时查看原文识别和中文翻译结果
