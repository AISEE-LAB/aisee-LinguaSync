/**
 * 自纠正引擎
 *
 * 核心能力：
 *  1. 利用 Web Speech API 的 interim → final 过渡进行实时修正
 *  2. 对 Whisper 结果进行重叠窗口对比纠正
 *  3. 基于上下文相似度检测并修正翻译错误
 */

import type { TranscriptSegment } from '../types';

// ---------- 文本相似度计算 (Levenshtein) ----------

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ---------- 纠正引擎 ----------

export interface CorrectionResult {
  segmentId: string;
  oldText: string;
  newText: string;
  oldTranslation: string;
  newTranslation: string;
}

export class CorrectionEngine {
  private recentSegments: TranscriptSegment[] = [];
  private maxHistory = 10;

  /**
   * 处理新的最终识别结果，检查是否需要纠正之前的段落
   */
  checkCorrections(
    newSegment: TranscriptSegment,
    existingSegments: TranscriptSegment[]
  ): CorrectionResult[] {
    const corrections: CorrectionResult[] = [];
    this.recentSegments = existingSegments.slice(-this.maxHistory);

    // 检查新文本是否是对最近段落的修正
    for (let i = this.recentSegments.length - 1; i >= 0; i--) {
      const existing = this.recentSegments[i];
      if (!existing.isFinal) continue;

      const sim = similarity(
        existing.originalText.toLowerCase().trim(),
        newSegment.originalText.toLowerCase().trim()
      );

      // 如果相似度在 0.4 ~ 0.95 之间，认为是同一段话的修正版本
      if (sim >= 0.4 && sim < 0.95) {
        // 新版本更长或置信度更高时进行替换
        if (
          newSegment.originalText.length > existing.originalText.length ||
          newSegment.confidence > existing.confidence
        ) {
          corrections.push({
            segmentId: existing.id,
            oldText: existing.originalText,
            newText: newSegment.originalText,
            oldTranslation: existing.translatedText,
            newTranslation: newSegment.translatedText,
          });
        }
      }
    }

    return corrections;
  }

  /**
   * 利用 Whisper 时间戳重叠进行纠正
   */
  checkOverlapCorrections(
    newSegment: TranscriptSegment,
    existingSegments: TranscriptSegment[],
    overlapThreshold: number = 2
  ): CorrectionResult[] {
    const corrections: CorrectionResult[] = [];

    for (const existing of existingSegments.slice(-5)) {
      if (!existing.isFinal) continue;

      // 检查时间重叠
      const overlap =
        Math.min(newSegment.endTime, existing.endTime) -
        Math.max(newSegment.startTime, existing.startTime);

      if (overlap > 0 && overlap <= overlapThreshold) {
        const sim = similarity(
          existing.originalText.slice(-20).toLowerCase(),
          newSegment.originalText.slice(0, 20).toLowerCase()
        );

        if (sim > 0.5) {
          corrections.push({
            segmentId: existing.id,
            oldText: existing.originalText,
            newText: existing.originalText, // 保留原文，仅标记为已校验
            oldTranslation: existing.translatedText,
            newTranslation: existing.translatedText,
          });
        }
      }
    }

    return corrections;
  }

  /**
   * 生成用于翻译纠正的上下文提示
   */
  getCorrectionContext(segments: TranscriptSegment[]): string[] {
    return segments
      .filter((s) => s.isFinal)
      .slice(-5)
      .map((s) => `原文: ${s.originalText}\n译文: ${s.translatedText}`);
  }
}

export const correctionEngine = new CorrectionEngine();
