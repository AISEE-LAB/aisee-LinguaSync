/**
 * LinguaSync Pro - Offscreen Document for Tesseract.js OCR
 *
 * 职责:
 *  - 接收 SCREEN_OCR 消息
 *  - 使用 Tesseract.js 识别截图中的英文文本
 *  - 返回识别结果给 background service worker
 */

let workerReady = false;
let worker = null;

/** 初始化 Tesseract worker (懒加载) */
async function getWorker() {
  if (workerReady && worker) return worker;
  // Tesseract.js v5 API
  if (typeof Tesseract === 'undefined') {
    throw new Error('Tesseract.js not loaded');
  }
  worker = await Tesseract.createWorker('eng', 1, {
    logger: () => {}, // 静默
  });
  // 优化参数：针对幻灯片/PPT 文字
  await worker.setParameters({
    tessedit_pageseg_mode: '6', // 假设为单一文本块
    preserve_interword_spaces: '1',
  });
  workerReady = true;
  return worker;
}

/** 对图片执行 OCR */
async function performOCR(imageDataUrl) {
  try {
    const w = await getWorker();
    const result = await w.recognize(imageDataUrl);
    const text = result.data.text || '';
    const confidence = result.data.confidence || 0;
    // 提取单词级别的信息（用于术语高亮）
    const words = (result.data.words || [])
      .filter(w => w.confidence > 60 && w.text.trim().length > 1)
      .map(w => w.text.trim());
    return { text: text.trim(), confidence, words };
  } catch (err) {
    return { text: '', confidence: 0, words: [], error: err.message };
  }
}

/** 消息监听 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SCREEN_OCR') {
    performOCR(message.imageDataUrl)
      .then(sendResponse)
      .catch((err) => sendResponse({ text: '', confidence: 0, words: [], error: err.message }));
    return true; // 异步响应
  }

  if (message.type === 'OCR_TERMINATE') {
    if (worker) {
      worker.terminate();
      worker = null;
      workerReady = false;
    }
    sendResponse({ ok: true });
    return true;
  }
});
