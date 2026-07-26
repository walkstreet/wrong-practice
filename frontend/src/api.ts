import axios from "axios";
import type {
  AdminUser,
  Assignment,
  AssignmentDetail,
  AssignmentSubmissionDetail,
  AssignmentSubmissionItem,
  KnowledgeTag,
  LearnerAssignmentDetail,
  LearnerAssignmentListItem,
  LearnerPracticeRecordDetail,
  LearnerPracticeRecordListResponse,
  PracticeRecordListResponse,
  QuestionType,
  SubmitAssignmentResult,
  UserAnswer,
  UserRole,
  WrongQuestion,
  WrongQuestionAiAnalysisOut,
  WrongQuestionAccuracyStat,
  LearningWeaknessAnalysis,
  LearningWeaknessAnalysisListResponse,
  KnowledgeLesson,
  KnowledgeLessonQuiz,
  KnowledgeGradeResult,
  WrongQuestionListResponse,
} from "./types";
import { clearAccessToken, getAccessToken, getTokenRemainingMs, setAccessToken } from "./auth";

/**
 * 默认走当前页面同源（空字符串），由 Vite server/preview 把 /api、/uploads 代理到后端。
 * 这样用域名（如 wrong.eduglow.top）访问时不会跨域打 :3001，也避免 CORS / 防火墙拦截。
 * 若需直连后端，可在 frontend/.env 设置 VITE_API_BASE_URL=http://host:3001
 */
const rawApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
const API_BASE_URL = rawApiBase ? rawApiBase.replace(/\/+$/, "") : "";

/** 剩余有效期低于该阈值则主动续期（默认 30 分钟）。 */
const REFRESH_WHEN_REMAINING_MS = 30 * 60 * 1000;

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const current = getAccessToken();
    if (!current) return null;
    try {
      const { data } = await axios.post<{ access_token: string }>(
        `${API_BASE_URL}/api/v1/auth/refresh`,
        {},
        {
          headers: { Authorization: `Bearer ${current}` },
          timeout: 10000,
        },
      );
      if (data?.access_token) {
        setAccessToken(data.access_token);
        return data.access_token;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

client.interceptors.request.use(async (config) => {
  const url = String(config.url || "");
  const isAuthEndpoint = url.includes("/api/v1/auth/login") || url.includes("/api/v1/auth/refresh");
  let token = getAccessToken();

  // 用户有请求时，若 token 即将过期则先续期
  if (token && !isAuthEndpoint) {
    const remaining = getTokenRemainingMs(token);
    if (remaining > 0 && remaining < REFRESH_WHEN_REMAINING_MS) {
      const refreshed = await refreshAccessToken();
      if (refreshed) token = refreshed;
    }
  }

  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const url = String(error.config?.url || "");
      // 登录 / 续期接口本身的 401 不额外清 token（续期失败才清）
      if (url.includes("/api/v1/auth/login")) {
        return Promise.reject(error);
      }
      if (url.includes("/api/v1/auth/refresh")) {
        clearAccessToken();
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
          const next = `${window.location.pathname}${window.location.search}`;
          window.location.assign(`/login?next=${encodeURIComponent(next)}`);
        }
        return Promise.reject(error);
      }
      clearAccessToken();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/login?next=${encodeURIComponent(next)}`);
      }
    }
    return Promise.reject(error);
  },
);

export interface LoginPayload {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export async function login(payload: LoginPayload) {
  const { data } = await client.post<LoginResponse>("/api/v1/auth/login", payload);
  return data;
}

export interface MeResponse {
  id: number;
  username: string;
  role: UserRole;
  is_active: boolean;
}

export async function me() {
  const { data } = await client.get<MeResponse>("/api/v1/auth/me");
  return data;
}

export interface ChangePasswordPayload {
  current_password: string;
  new_password: string;
}

export async function changePassword(payload: ChangePasswordPayload) {
  const { data } = await client.post<LoginResponse>("/api/v1/auth/change-password", payload);
  return data;
}

export interface ListWrongQuestionParams {
  page: number;
  page_size: number;
  id?: number;
  keyword?: string;
  question_type_id?: number;
  knowledge_tag_id?: number;
  review_status?: string;
}

export async function listWrongQuestions(params: ListWrongQuestionParams) {
  const { data } = await client.get<WrongQuestionListResponse>("/api/v1/wrong-questions", { params });
  return data;
}

export async function listDeletedWrongQuestions(params: ListWrongQuestionParams) {
  const { data } = await client.get<WrongQuestionListResponse>("/api/v1/wrong-questions/recycle-bin", { params });
  return data;
}

export async function getWrongQuestion(id: number) {
  const { data } = await client.get<WrongQuestion>(`/api/v1/wrong-questions/${id}`);
  return data;
}

export async function analyzeWrongQuestion(id: number, focusSentences?: string[]) {
  const payload =
    focusSentences && focusSentences.length > 0
      ? { focus_sentences: focusSentences.slice(0, 3) }
      : {};
  const { data } = await client.post<WrongQuestionAiAnalysisOut>(
    `/api/v1/wrong-questions/${id}/ai-analyze`,
    payload,
    { timeout: 120000 },
  );
  return data;
}

export async function deleteWrongQuestion(id: number) {
  await client.delete(`/api/v1/wrong-questions/${id}`);
}

export interface UpdateWrongQuestionPayload {
  stem?: string;
  options?: (string | string[])[];
  correct_answer?: (string | string[] | null)[];
  wrong_answer?: (string | string[] | null)[];
  question_type_id?: number;
  knowledge_tag_ids?: number[];
  difficulty?: number | null;
  source?: string | null;
  note?: string | null;
  review_status?: string;
}

export async function updateWrongQuestion(id: number, payload: UpdateWrongQuestionPayload) {
  const { data } = await client.put<WrongQuestion>(`/api/v1/wrong-questions/${id}`, payload);
  return data;
}

export interface CreateWrongQuestionPayload {
  stem: string;
  options: (string | string[])[];
  correct_answer: (string | string[] | null)[];
  wrong_answer: (string | string[] | null)[];
  question_type_id: number;
  knowledge_tag_ids: number[];
  difficulty?: number | null;
  source?: string | null;
  note?: string | null;
  wrong_at?: string | null;
  review_status: string;
}

export async function createWrongQuestion(payload: CreateWrongQuestionPayload) {
  const { data } = await client.post<WrongQuestion>("/api/v1/wrong-questions", payload);
  return data;
}

export type AiExtractDraftItem = {
  local_id: string;
  stem: string;
  options: (string | string[])[];
  correct_answer: (string | string[] | null)[];
  wrong_answer: (string | string[] | null)[];
  question_type_id: number | null;
  question_type_name?: string | null;
  knowledge_tag_ids: number[];
  knowledge_tag_names?: string[];
  difficulty?: number | null;
  source?: string | null;
  note?: string | null;
  confidence?: number | null;
  warnings?: string[];
  selected?: boolean;
};

export type AiExtractOut = {
  draft_id: string;
  items: AiExtractDraftItem[];
  image_urls: string[];
  raw_text?: string | null;
  model?: string | null;
};

export type AiExtractConfirmOut = {
  imported_count: number;
  ids: number[];
};

export function resolveMediaUrl(path: string) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function aiExtractWrongQuestions(files: File[]) {
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  const { data } = await client.post<AiExtractOut>("/api/v1/wrong-questions/ai-extract", form, {
    timeout: 300000,
  });
  return data;
}

export async function confirmAiExtract(draftId: string, items: AiExtractDraftItem[]) {
  const { data } = await client.post<AiExtractConfirmOut>(
    `/api/v1/wrong-questions/ai-extract/${draftId}/confirm`,
    { items },
    { timeout: 60000 },
  );
  return data;
}

export async function restoreWrongQuestion(id: number) {
  await client.post(`/api/v1/wrong-questions/${id}/restore`);
}

export async function permanentlyDeleteWrongQuestion(id: number) {
  await client.delete(`/api/v1/wrong-questions/recycle-bin/${id}`);
}

export async function emptyRecycleBin() {
  const { data } = await client.delete<{ status: string; deleted_count: number }>(
    "/api/v1/wrong-questions/recycle-bin",
  );
  return data;
}

export async function listQuestionTypes() {
  const { data } = await client.get<QuestionType[]>("/api/v1/question-types");
  return data;
}

export async function listKnowledgeTags() {
  const { data } = await client.get<KnowledgeTag[]>("/api/v1/knowledge-tags");
  return data;
}

export type SuggestKnowledgeTagItem = {
  id: number;
  name: string;
  confidence?: number | null;
  reason?: string | null;
};

export type SuggestKnowledgeTagsOut = {
  knowledge_tag_ids: number[];
  items: SuggestKnowledgeTagItem[];
  model?: string | null;
  warnings?: string[];
};

export async function suggestKnowledgeTags(payload: {
  stem: string;
  options?: (string | string[])[];
  correct_answer?: (string | string[] | null)[];
  wrong_answer?: (string | string[] | null)[];
  question_type_name?: string | null;
  note?: string | null;
}) {
  const { data } = await client.post<SuggestKnowledgeTagsOut>(
    "/api/v1/wrong-questions/suggest-knowledge-tags",
    payload,
    { timeout: 90000 },
  );
  return data;
}

export interface ListPracticeRecordParams {
  page: number;
  page_size: number;
  wrong_question_id?: number;
}

export async function listPracticeRecords(params: ListPracticeRecordParams) {
  const { data } = await client.get<PracticeRecordListResponse>("/api/v1/practice-records", { params });
  return data;
}

export interface ListLearnerPracticeRecordParams {
  page: number;
  page_size: number;
  wrong_question_id?: number;
  username?: string;
}

export async function listLearnerPracticeRecords(params: ListLearnerPracticeRecordParams) {
  const { data } = await client.get<LearnerPracticeRecordListResponse>("/api/v1/practice-records/learner", { params });
  return data;
}

export async function getLearnerPracticeRecordDetail(recordId: number) {
  const { data } = await client.get<LearnerPracticeRecordDetail>(`/api/v1/practice-records/learner/${recordId}`);
  return data;
}

export async function listWrongQuestionAccuracyStats(
  limit = 50,
  params?: { wrong_question_id?: number; username?: string },
) {
  const { data } = await client.get<WrongQuestionAccuracyStat[]>("/api/v1/practice-stats/wrong-questions", {
    params: { limit, ...(params || {}) },
  });
  return data;
}

export async function analyzeLearningWeaknesses(
  limit = 50,
  params?: { wrong_question_id?: number; username?: string },
) {
  const { data } = await client.post<LearningWeaknessAnalysis>(
    "/api/v1/practice-stats/wrong-questions/ai-weakness-analysis",
    {},
    {
      params: { limit, ...(params || {}) },
      timeout: 120000,
    },
  );
  return data;
}

export async function getLatestLearningWeaknessAnalysis(params?: {
  wrong_question_id?: number;
  username?: string;
}) {
  try {
    const { data } = await client.get<LearningWeaknessAnalysis>(
      "/api/v1/practice-stats/weakness-analyses/latest",
      { params },
    );
    return data;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "response" in error &&
      (error as { response?: { status?: number } }).response?.status === 404
    ) {
      return null;
    }
    throw error;
  }
}

export async function listLearningWeaknessAnalyses(params: {
  page?: number;
  page_size?: number;
  username?: string;
}) {
  const { data } = await client.get<LearningWeaknessAnalysisListResponse>(
    "/api/v1/practice-stats/weakness-analyses",
    { params },
  );
  return data;
}

export async function getLearningWeaknessAnalysis(id: number) {
  const { data } = await client.get<LearningWeaknessAnalysis>(
    `/api/v1/practice-stats/weakness-analyses/${id}`,
  );
  return data;
}

export async function getKnowledgeLesson(params: {
  knowledge_point: string;
  weakness_analysis_id?: number | null;
}) {
  try {
    const { data } = await client.get<KnowledgeLesson>(
      "/api/v1/practice-stats/knowledge-lessons",
      { params },
    );
    return data;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "response" in error &&
      (error as { response?: { status?: number } }).response?.status === 404
    ) {
      return null;
    }
    throw error;
  }
}

export async function createKnowledgeLesson(payload: {
  knowledge_point: string;
  evidence?: string | null;
  overall_summary?: string | null;
  weakness_analysis_id?: number | null;
  force?: boolean;
}) {
  const { data } = await client.post<KnowledgeLesson>(
    "/api/v1/practice-stats/knowledge-lessons",
    payload,
    { timeout: 120000 },
  );
  return data;
}

export async function regenerateKnowledgeLessonQuiz(payload: {
  knowledge_point: string;
  evidence?: string | null;
  avoid_stems?: string[];
  lesson_id?: number | null;
  weakness_analysis_id?: number | null;
}) {
  const { data } = await client.post<KnowledgeLessonQuiz>(
    "/api/v1/practice-stats/knowledge-lessons/quiz",
    payload,
    { timeout: 60000 },
  );
  return data;
}

export async function gradeKnowledgeLesson(payload: {
  knowledge_point: string;
  quiz_stem: string;
  options: string[];
  correct_answer: string;
  user_answer: string;
}) {
  const { data } = await client.post<KnowledgeGradeResult>(
    "/api/v1/practice-stats/knowledge-lessons/grade",
    payload,
    { timeout: 60000 },
  );
  return data;
}

export interface AdminCreateUserPayload {
  username: string;
  password: string;
  role?: UserRole;
  is_active?: boolean;
}

export async function listAdminUsers() {
  const { data } = await client.get<AdminUser[]>("/api/v1/admin/users");
  return data;
}

export async function createAdminUser(payload: AdminCreateUserPayload) {
  const { data } = await client.post<AdminUser>("/api/v1/admin/users", payload);
  return data;
}

export async function getLocalIpForShare() {
  const { data } = await client.get<{ ip: string }>("/api/v1/admin/system/local-ip");
  return data;
}

export interface CreateAssignmentPayload {
  title: string;
  description?: string;
  question_type_id: number;
  question_count: number;
}

export async function createAssignment(payload: CreateAssignmentPayload) {
  const { data } = await client.post<Assignment>("/api/v1/admin/assignments", payload);
  return data;
}

export async function listAssignments() {
  const { data } = await client.get<Assignment[]>("/api/v1/admin/assignments");
  return data;
}

export async function getAssignment(id: number) {
  const { data } = await client.get<AssignmentDetail>(`/api/v1/admin/assignments/${id}`);
  return data;
}

export async function closeAssignment(assignmentId: number) {
  const { data } = await client.post<Assignment>(`/api/v1/admin/assignments/${assignmentId}/close`);
  return data;
}

export async function deleteAssignment(assignmentId: number) {
  await client.delete(`/api/v1/admin/assignments/${assignmentId}`);
}

export async function assignUsers(assignmentId: number, userIds: number[]) {
  const { data } = await client.post<{ created: number }>(`/api/v1/admin/assignments/${assignmentId}/assign-users`, {
    user_ids: userIds,
  });
  return data;
}

export async function listAssignmentSubmissions(assignmentId: number) {
  const { data } = await client.get<AssignmentSubmissionItem[]>(`/api/v1/admin/assignments/${assignmentId}/submissions`);
  return data;
}

export async function getAssignmentSubmissionDetail(assignmentId: number, userId: number) {
  const { data } = await client.get<AssignmentSubmissionDetail>(
    `/api/v1/admin/assignments/${assignmentId}/submissions/${userId}`,
  );
  return data;
}

export async function listMyAssignments() {
  const { data } = await client.get<LearnerAssignmentListItem[]>("/api/v1/me/assignments");
  return data;
}

export async function getMyAssignment(id: number) {
  const { data } = await client.get<LearnerAssignmentDetail>(`/api/v1/me/assignments/${id}`);
  return data;
}

export async function saveMyAnswer(assignmentId: number, wrongQuestionId: number, userAnswer: unknown[]) {
  const { data } = await client.post<UserAnswer>(`/api/v1/me/assignments/${assignmentId}/answers`, {
    wrong_question_id: wrongQuestionId,
    user_answer: userAnswer,
  });
  return data;
}

export async function submitMyAssignment(assignmentId: number) {
  const { data } = await client.post<SubmitAssignmentResult>(`/api/v1/me/assignments/${assignmentId}/submit`);
  return data;
}
