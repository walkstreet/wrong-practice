import type {
  ClaimRequestStatus,
  IngestSource,
  ReviewStatus,
  UserAssignmentStatus,
} from "../types";

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
  ai: "AI出题",
};

export const ASSIGNMENT_STATUS_LABELS: Record<"draft" | "published" | "closed", string> = {
  draft: "草稿",
  published: "已发布",
  closed: "已关闭",
};

export const USER_ASSIGNMENT_STATUS_LABELS: Record<UserAssignmentStatus, string> = {
  assigned: "未开始",
  in_progress: "进行中",
  submitted: "已提交",
  graded: "已批改",
};

export const PORTRAIT_STATUS_LABELS: Record<"lagging" | "watch" | "stable" | "insufficient", string> = {
  lagging: "掉队",
  watch: "需关注",
  stable: "稳定",
  insufficient: "数据不足",
};

export const CLAIM_STATUS_LABELS: Record<ClaimRequestStatus, string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已驳回",
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

export function assignmentStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return ASSIGNMENT_STATUS_LABELS[status as keyof typeof ASSIGNMENT_STATUS_LABELS] || status;
}

export function userAssignmentStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return USER_ASSIGNMENT_STATUS_LABELS[status as UserAssignmentStatus] || status;
}

export function portraitStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return PORTRAIT_STATUS_LABELS[status as keyof typeof PORTRAIT_STATUS_LABELS] || status;
}

export function claimStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return CLAIM_STATUS_LABELS[status as ClaimRequestStatus] || status;
}
