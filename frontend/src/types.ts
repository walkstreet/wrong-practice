export type ReviewStatus = "not_reviewed" | "reviewed" | "mastered";
export type ErrorRateLevel = "high" | "medium" | "low";
export type IngestSource = "manual" | "ocr";
export type UserRole = "superadmin" | "teacher" | "student";
export type ClaimRequestStatus = "pending" | "approved" | "rejected";
export type UserAssignmentStatus = "assigned" | "in_progress" | "submitted" | "graded";
export type OptionItem = string | string[];
export type AnswerItem = string | string[] | null;

export type SentenceRole = "subject" | "predicate" | "object" | "attributive" | "adverbial" | "complement";

export type PartOfSpeech =
  | "noun"
  | "verb"
  | "adjective"
  | "adverb"
  | "pronoun"
  | "preposition"
  | "conjunction"
  | "determiner"
  | "numeral"
  | string;

export interface SentenceSegment {
  text: string;
  role: SentenceRole | string;
  role_label: string;
  pos?: PartOfSpeech | string;
  pos_label?: string;
  group_id?: string | null;
  is_head?: boolean;
  is_clause?: boolean;
}

export interface SentenceClause {
  clause_type: "main" | "subordinate" | string;
  clause_label: string;
  segments: SentenceSegment[];
}

export interface SentenceToken {
  text: string;
  pos?: PartOfSpeech | string;
  pos_label?: string;
  inner_role?: SentenceRole | string;
  inner_role_label?: string;
  is_head?: boolean;
}

export interface SentenceComponent {
  role: SentenceRole | string;
  role_label: string;
  is_clause?: boolean;
  tokens: SentenceToken[];
}

export interface SentenceAnalysis {
  target_sentence: string;
  components?: SentenceComponent[];
  highlights?: SentenceSegment[];
  clauses?: SentenceClause[];
  summary: string;
  focus?: string | null;
}

export interface SolvingAnalysis {
  correct_answer: string;
  correct_answer_text: string;
  wrong_answer?: string;
  wrong_answer_text?: string;
  explanation: string;
}

export interface AiAnalysis {
  sentence_analysis: SentenceAnalysis;
  sentence_analyses?: SentenceAnalysis[];
  solving_analysis: SolvingAnalysis;
  analyzed_at: string;
  model: string;
}

export interface WrongQuestionAiAnalysisOut {
  sentence_analysis: SentenceAnalysis;
  sentence_analyses?: SentenceAnalysis[];
  solving_analysis: SolvingAnalysis;
  analyzed_at: string;
  model: string;
}

export interface WrongQuestion {
  id: number;
  stem: string;
  options: OptionItem[];
  correct_answer: AnswerItem[];
  wrong_answer: AnswerItem[];
  question_type_id: number;
  knowledge_tag_ids: number[];
  difficulty?: number | null;
  source?: string | null;
  ingest_source: IngestSource;
  external_trace_id?: string | null;
  note?: string | null;
  wrong_at?: string | null;
  review_status: ReviewStatus;
  ai_analysis?: AiAnalysis | null;
  ai_analyzed_at?: string | null;
  ai_model?: string | null;
  created_at: string;
  updated_at: string;
  created_by?: number | null;
  created_by_username?: string | null;
  total_attempts?: number;
  error_rate?: number | null;
  error_rate_level?: ErrorRateLevel | null;
}

export interface QuestionClaimRequest {
  id: number;
  requester_id: number;
  requester_username: string;
  status: ClaimRequestStatus;
  reason?: string | null;
  reviewer_id?: number | null;
  reviewer_username?: string | null;
  review_note?: string | null;
  created_at: string;
  reviewed_at?: string | null;
}

export interface QuestionClaimListResponse {
  total: number;
  items: QuestionClaimRequest[];
}

export interface ActivityLog {
  id: number;
  actor_id?: number | null;
  actor_username?: string | null;
  action: string;
  action_label: string;
  resource_type: string;
  resource_id?: number | null;
  summary: string;
  extra?: Record<string, unknown> | null;
  created_at: string;
}

export interface ActivityLogListResponse {
  total: number;
  items: ActivityLog[];
}

export interface WrongQuestionListResponse {
  total: number;
  items: WrongQuestion[];
}

export interface QuestionType {
  id: number;
  name: string;
  description?: string | null;
  category?: string;
  sort_order?: number;
  status: string;
}

export interface KnowledgeTag {
  id: number;
  name: string;
  parent_id?: number | null;
  status: string;
}

export interface PracticeRecord {
  id: number;
  wrong_question_id: number;
  wrong_question_stem: string;
  generated_question: Record<string, unknown>;
  is_correct: boolean;
  answered_at: string;
  created_at: string;
}

export interface PracticeRecordListResponse {
  total: number;
  items: PracticeRecord[];
}

export interface LearnerPracticeRecord {
  id: number;
  assignment_id: number;
  user_id: number;
  username: string;
  status: UserAssignmentStatus;
  submitted_at?: string | null;
  score?: number | null;
  accuracy_rate?: number | null;
  answered_questions: number;
  correct_questions: number;
}

export type LearnerPracticeRecordDetail = AssignmentSubmissionDetail;

export interface LearnerPracticeRecordListResponse {
  total: number;
  items: LearnerPracticeRecord[];
}

export interface WrongQuestionAccuracyStat {
  wrong_question_id: number;
  stem: string;
  total_attempts: number;
  correct_attempts: number;
  accuracy_rate: number;
}

export interface LearningWeakArea {
  name: string;
  severity: string;
  evidence?: string;
  related_question_ids?: number[];
}

export interface LearningWeaknessAnalysis {
  id?: number | null;
  overall_summary: string;
  weak_areas: LearningWeakArea[];
  gap_fill_suggestions: string[];
  study_methods: string[];
  weekly_plan: string[];
  analyzed_count: number;
  username?: string | null;
  wrong_question_id?: number | null;
  scope_note?: string | null;
  source_items?: Record<string, unknown>[];
  analyzed_at: string;
  model: string;
}

export interface LearningWeaknessAnalysisListItem {
  id: number;
  username?: string | null;
  wrong_question_id?: number | null;
  scope_note?: string | null;
  analyzed_count: number;
  overall_summary: string;
  model?: string | null;
  analyzed_at: string;
}

export interface LearningWeaknessAnalysisListResponse {
  total: number;
  items: LearningWeaknessAnalysisListItem[];
}

export interface KnowledgeLessonExample {
  sentence: string;
  translation: string;
  analysis: string;
}

export interface KnowledgeLessonQuiz {
  stem: string;
  options: string[];
  correct_answer: string;
  hint?: string;
}

export interface KnowledgeLesson {
  id?: number | null;
  knowledge_point: string;
  explanation: string;
  key_points: string[];
  examples: KnowledgeLessonExample[];
  quiz: KnowledgeLessonQuiz;
  model: string;
  weakness_analysis_id?: number | null;
  updated_at?: string | null;
}

export interface KnowledgeGradeResult {
  is_correct: boolean;
  correct_answer: string;
  brief_explanation: string;
  encouragement: string;
  model: string;
}

export interface AdminUser {
  id: number;
  username: string;
  role: UserRole;
  is_active: boolean;
  created_by?: number | null;
  created_at: string;
}

export interface Assignment {
  id: number;
  title: string;
  description?: string | null;
  status: "draft" | "published" | "closed";
  publish_at?: string | null;
  due_at?: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  question_count: number;
  assigned_user_count: number;
  assigned_users: string[];
}

export interface AssignmentQuestion {
  wrong_question_id: number;
  question_order: number;
  stem: string;
  options: OptionItem[];
  correct_answer: AnswerItem[];
  question_type_id: number;
  knowledge_tag_ids: number[];
}

export interface AssignmentDetail extends Assignment {
  questions: AssignmentQuestion[];
}

export interface AssignmentSubmissionItem {
  user_id: number;
  username: string;
  status: UserAssignmentStatus;
  started_at?: string | null;
  submitted_at?: string | null;
  score?: number | null;
  accuracy_rate?: number | null;
  answered_questions: number;
  correct_questions: number;
}

export interface UserAnswer {
  id: number;
  assignment_id: number;
  user_id: number;
  wrong_question_id: number;
  wrong_question_stem?: string | null;
  user_answer: AnswerItem[];
  standard_answer?: AnswerItem[] | null;
  is_correct: boolean;
  answered_at: string;
}

export interface AssignmentSubmissionDetail extends AssignmentSubmissionItem {
  assignment_id: number;
  answers: UserAnswer[];
}

export interface LearnerAssignmentListItem {
  assignment_id: number;
  title: string;
  status: UserAssignmentStatus;
  due_at?: string | null;
  submitted_at?: string | null;
  score?: number | null;
  accuracy_rate?: number | null;
  question_count: number;
}

export interface LearnerAssignmentDetail {
  assignment_id: number;
  title: string;
  description?: string | null;
  status: UserAssignmentStatus;
  due_at?: string | null;
  submitted_at?: string | null;
  score?: number | null;
  accuracy_rate?: number | null;
  questions: AssignmentQuestion[];
}

export interface SubmitAssignmentResult {
  assignment_id: number;
  user_id: number;
  total_questions: number;
  answered_questions: number;
  correct_questions: number;
  score: number;
  accuracy_rate: number;
  answers: UserAnswer[];
}
