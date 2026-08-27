import type { IngestSource, ReviewStatus } from "../types";

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  not_reviewed: "未复习",
  reviewed: "已复习",
  mastered: "已掌握",
};

export const ERROR_RATE_LEVEL_LABELS: Record<"high" | "medium" | "low", string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export const INGEST_SOURCE_LABELS: Record<IngestSource, string> = {
  manual: "手动录入",
  ocr: "识别录入",
};

export function reviewStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return REVIEW_STATUS_LABELS[status as ReviewStatus] || status;
}

export function errorRateLevelLabel(level: string | null | undefined): string {
  if (!level) return "未练";
  return ERROR_RATE_LEVEL_LABELS[level as "high" | "medium" | "low"] || level;
}

export function ingestSourceLabel(source: string | null | undefined): string {
  if (!source) return "—";
  return INGEST_SOURCE_LABELS[source as IngestSource] || source;
}
