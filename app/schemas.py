from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.models import (
    AssignmentStatus,
    ClaimRequestStatus,
    IngestSource,
    ReviewStatus,
    UserAssignmentStatus,
    UserRole,
)

OptionItem = str | list[str]
AnswerItem = str | list[str] | None


class ErrorRateLevel(str, Enum):
    """练习/作答错误率档：高 ≥75%，中 50%–75%，低 <50%。未练不计档。"""

    high = "high"
    medium = "medium"
    low = "low"


def _validate_wrong_question_options(options: list[OptionItem]) -> None:
    for option in options:
        if isinstance(option, list):
            if len(option) == 0:
                raise ValueError("each option group cannot be empty")
            if not all(isinstance(item, str) and item.strip() for item in option):
                raise ValueError("option group items must be non-empty strings")
        elif not (isinstance(option, str) and option.strip()):
            raise ValueError("option items must be non-empty strings")


def _validate_answer_list_strict_nonempty(answers: list[AnswerItem]) -> None:
    for answer in answers:
        if answer is None:
            continue
        if isinstance(answer, list):
            if len(answer) == 0:
                raise ValueError("answer group cannot be empty")
            if not all(isinstance(item, str) and item.strip() for item in answer):
                raise ValueError("answer group items must be non-empty strings")
        elif not (isinstance(answer, str) and answer.strip()):
            raise ValueError("answer items must be non-empty strings")


def _answers_simple_strings(answers: list[AnswerItem]) -> list[str]:
    return [item for item in answers if isinstance(item, str)]


class WrongQuestionBase(BaseModel):
    stem: str = Field(min_length=1)
    # 兼容三类输入：
    # 1) 单题单组选项: ["A.xxx", "B.xxx"]
    # 2) 多组选项: [["A1", "B1"], ["A2", "B2"]]
    # 3) 无选项题: []
    options: list[OptionItem] = Field(default_factory=list, max_length=100)
    # 兼容单题答案和多组答案（例如完形/阅读多小题、语法填空多空）
    correct_answer: list[AnswerItem] = Field(min_length=1, max_length=100)
    wrong_answer: list[AnswerItem] = Field(min_length=1, max_length=100)
    question_type_id: int
    knowledge_tag_ids: list[int] = Field(min_length=1)
    difficulty: int | None = Field(default=None, ge=1, le=5)
    source: str | None = None
    note: str | None = None
    wrong_at: datetime | None = None
    review_status: ReviewStatus = ReviewStatus.not_reviewed
    external_trace_id: str | None = None
    ocr_raw_text: str | None = None
    ocr_payload: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_answers(self) -> "WrongQuestionBase":
        _validate_wrong_question_options(self.options)
        _validate_answer_list_strict_nonempty(self.correct_answer)
        _validate_answer_list_strict_nonempty(self.wrong_answer)

        # 仅在简单字符串答案场景下做“完全相同”校验（忽略 None 占位）
        simple_correct = _answers_simple_strings(self.correct_answer)
        simple_wrong = _answers_simple_strings(self.wrong_answer)
        if simple_correct and simple_wrong and set(simple_correct) == set(simple_wrong):
            raise ValueError(
                "wrong_answer 与 correct_answer 完全相同。"
                "请填写真实错误样本（例如 correct=['A'] 时 wrong 可填 ['C'] 或错误选项文本）；"
                "若学生本题答对，请不要作为错题入库。"
            )
        return self


class WrongQuestionCreate(WrongQuestionBase):
    ingest_source: IngestSource = IngestSource.manual


class OCRIngestRequest(BaseModel):
    image_url: str | None = None
    raw_text: str | None = None
    extracted: WrongQuestionBase | None = None

    @model_validator(mode="after")
    def validate_source(self) -> "OCRIngestRequest":
        if not self.image_url and not self.raw_text and not self.extracted:
            raise ValueError("At least one of image_url/raw_text/extracted is required")
        return self


class AiExtractDraftItem(BaseModel):
    """AI 识别草稿项：字段可缺省，供人工审核补全后再确认入库。"""

    local_id: str
    stem: str = ""
    options: list[OptionItem] = Field(default_factory=list, max_length=100)
    correct_answer: list[AnswerItem] = Field(default_factory=list, max_length=100)
    wrong_answer: list[AnswerItem] = Field(default_factory=list, max_length=100)
    question_type_id: int | None = None
    question_type_name: str | None = None
    knowledge_tag_ids: list[int] = Field(default_factory=list)
    knowledge_tag_names: list[str] = Field(default_factory=list)
    difficulty: int | None = Field(default=None, ge=1, le=5)
    source: str | None = None
    note: str | None = None
    confidence: float | None = None
    warnings: list[str] = Field(default_factory=list)
    selected: bool = True


class AiExtractOut(BaseModel):
    draft_id: str
    items: list[AiExtractDraftItem]
    image_urls: list[str] = Field(default_factory=list)
    raw_text: str | None = None
    model: str | None = None


class AiExtractConfirmIn(BaseModel):
    items: list[AiExtractDraftItem] = Field(min_length=1)


class AiExtractConfirmOut(BaseModel):
    imported_count: int
    ids: list[int]


class SuggestKnowledgeTagsIn(BaseModel):
    stem: str = Field(min_length=1)
    options: list[OptionItem] = Field(default_factory=list)
    correct_answer: list[AnswerItem] = Field(default_factory=list)
    wrong_answer: list[AnswerItem] = Field(default_factory=list)
    question_type_name: str | None = None
    note: str | None = None


class SuggestKnowledgeTagItem(BaseModel):
    id: int
    name: str
    confidence: float | None = None
    reason: str | None = None


class SuggestKnowledgeTagsOut(BaseModel):
    knowledge_tag_ids: list[int]
    items: list[SuggestKnowledgeTagItem] = Field(default_factory=list)
    model: str | None = None
    warnings: list[str] = Field(default_factory=list)


class WrongQuestionUpdate(BaseModel):
    stem: str | None = None
    options: list[OptionItem] | None = Field(default=None, max_length=100)
    correct_answer: list[AnswerItem] | None = None
    wrong_answer: list[AnswerItem] | None = None
    question_type_id: int | None = None
    knowledge_tag_ids: list[int] | None = None
    difficulty: int | None = Field(default=None, ge=1, le=5)
    source: str | None = None
    note: str | None = None
    wrong_at: datetime | None = None
    review_status: ReviewStatus | None = None


class WrongQuestionOut(BaseModel):
    id: int
    stem: str
    options: list[OptionItem]
    correct_answer: list[AnswerItem]
    wrong_answer: list[AnswerItem]
    question_type_id: int
    knowledge_tag_ids: list[int]
    difficulty: int | None
    source: str | None
    ingest_source: IngestSource
    external_trace_id: str | None
    note: str | None
    wrong_at: datetime | None
    review_status: ReviewStatus
    ai_analysis: dict[str, Any] | None = None
    ai_analyzed_at: datetime | None = None
    ai_model: str | None = None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None
    created_by: int | None = None
    created_by_username: str | None = None
    total_attempts: int = 0
    error_rate: float | None = None
    error_rate_level: ErrorRateLevel | None = None

    model_config = {"from_attributes": True}


class QuestionClaimCreateIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class QuestionClaimReviewIn(BaseModel):
    review_note: str | None = Field(default=None, max_length=500)


class QuestionClaimOut(BaseModel):
    id: int
    requester_id: int
    requester_username: str
    status: ClaimRequestStatus
    reason: str | None
    reviewer_id: int | None
    reviewer_username: str | None
    review_note: str | None
    created_at: datetime
    reviewed_at: datetime | None

    model_config = {"from_attributes": True}


class QuestionClaimListOut(BaseModel):
    total: int
    items: list[QuestionClaimOut]


class ActivityLogOut(BaseModel):
    id: int
    actor_id: int | None
    actor_username: str | None
    action: str
    action_label: str
    resource_type: str
    resource_id: int | None
    summary: str
    extra: dict[str, Any] | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ActivityLogListOut(BaseModel):
    total: int
    items: list[ActivityLogOut]


class WrongQuestionAiAnalyzeIn(BaseModel):
    """可选：指定要做成分分析的句子（最多 3 句）。为空则由模型自动抽取。"""

    focus_sentences: list[str] = Field(default_factory=list, max_length=5)


class WrongQuestionAiAnalysisOut(BaseModel):
    sentence_analysis: dict[str, Any]
    sentence_analyses: list[dict[str, Any]] = Field(default_factory=list)
    solving_analysis: dict[str, Any]
    analyzed_at: datetime
    model: str


class WrongQuestionListOut(BaseModel):
    total: int
    items: list[WrongQuestionOut]


class WrongQuestionBatchIn(BaseModel):
    items: list[WrongQuestionCreate] = Field(min_length=1, max_length=200)


class WrongQuestionBatchOut(BaseModel):
    total: int
    items: list[WrongQuestionOut]


class KnowledgeTagCreate(BaseModel):
    name: str
    parent_id: int | None = None
    status: str = "active"


class KnowledgeTagOut(KnowledgeTagCreate):
    id: int

    model_config = {"from_attributes": True}


class QuestionTypeCreate(BaseModel):
    name: str
    description: str | None = None
    category: str = "其他"
    sort_order: int = 100
    status: str = "active"


class QuestionTypeOut(QuestionTypeCreate):
    id: int

    model_config = {"from_attributes": True}


class PracticeRecordIn(BaseModel):
    wrong_question_id: int
    generated_question: dict[str, Any]
    is_correct: bool
    answered_at: datetime | None = None


class PracticeRecordOut(BaseModel):
    id: int
    wrong_question_id: int
    wrong_question_stem: str
    generated_question: dict[str, Any]
    is_correct: bool
    answered_at: datetime
    created_at: datetime


class PracticeRecordListOut(BaseModel):
    total: int
    items: list[PracticeRecordOut]


class LearnerPracticeRecordOut(BaseModel):
    id: int
    assignment_id: int
    user_id: int
    username: str
    status: UserAssignmentStatus
    submitted_at: datetime | None
    score: float | None
    accuracy_rate: float | None
    answered_questions: int = 0
    correct_questions: int = 0


class LearnerPracticeRecordDetailOut(BaseModel):
    assignment_id: int
    user_id: int
    username: str
    status: UserAssignmentStatus
    started_at: datetime | None
    submitted_at: datetime | None
    score: float | None
    accuracy_rate: float | None
    answers: list["UserAnswerOut"]


class LearnerPracticeRecordListOut(BaseModel):
    total: int
    items: list[LearnerPracticeRecordOut]


class WrongQuestionAccuracyOut(BaseModel):
    wrong_question_id: int
    stem: str
    total_attempts: int
    correct_attempts: int
    accuracy_rate: float


class LearningWeakAreaOut(BaseModel):
    name: str
    severity: str
    evidence: str = ""
    related_question_ids: list[int] = Field(default_factory=list)


class LearningWeaknessAnalysisOut(BaseModel):
    id: int | None = None
    overall_summary: str
    weak_areas: list[LearningWeakAreaOut] = Field(default_factory=list)
    gap_fill_suggestions: list[str] = Field(default_factory=list)
    study_methods: list[str] = Field(default_factory=list)
    weekly_plan: list[str] = Field(default_factory=list)
    analyzed_count: int = 0
    username: str | None = None
    wrong_question_id: int | None = None
    scope_note: str | None = None
    source_items: list[dict[str, Any]] = Field(default_factory=list)
    analyzed_at: datetime
    model: str


class LearningWeaknessAnalysisListItemOut(BaseModel):
    id: int
    username: str | None = None
    wrong_question_id: int | None = None
    scope_note: str | None = None
    analyzed_count: int
    overall_summary: str
    model: str | None = None
    analyzed_at: datetime


class LearningWeaknessAnalysisListOut(BaseModel):
    total: int
    items: list[LearningWeaknessAnalysisListItemOut]


class KnowledgeLessonIn(BaseModel):
    knowledge_point: str = Field(min_length=1, max_length=128)
    evidence: str | None = None
    overall_summary: str | None = None
    weakness_analysis_id: int | None = None
    force: bool = False


class KnowledgeExampleOut(BaseModel):
    sentence: str = ""
    translation: str = ""
    analysis: str = ""


class KnowledgeQuizOut(BaseModel):
    stem: str
    options: list[str] = Field(default_factory=list)
    correct_answer: str
    hint: str = ""


class KnowledgeLessonOut(BaseModel):
    id: int | None = None
    knowledge_point: str
    explanation: str
    key_points: list[str] = Field(default_factory=list)
    examples: list[KnowledgeExampleOut] = Field(default_factory=list)
    quiz: KnowledgeQuizOut
    model: str = ""
    weakness_analysis_id: int | None = None
    updated_at: datetime | None = None


class KnowledgeQuizRegenIn(BaseModel):
    knowledge_point: str = Field(min_length=1, max_length=128)
    evidence: str | None = None
    avoid_stems: list[str] = Field(default_factory=list)
    lesson_id: int | None = None
    weakness_analysis_id: int | None = None


class KnowledgeGradeIn(BaseModel):
    knowledge_point: str = Field(min_length=1, max_length=128)
    quiz_stem: str = Field(min_length=1)
    options: list[str] = Field(default_factory=list)
    correct_answer: str = Field(min_length=1)
    user_answer: str = Field(min_length=1)


class KnowledgeGradeOut(BaseModel):
    is_correct: bool
    correct_answer: str
    brief_explanation: str = ""
    encouragement: str
    model: str = ""


class LoginIn(BaseModel):
    username: str
    password: str


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    username: str
    role: UserRole
    is_active: bool
    avatar_url: str | None = None
    permissions: list[str] = []
    can_view_question_bank: bool = False
    bank_request_status: ClaimRequestStatus | None = None


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


class AdminCreateUserIn(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    role: UserRole = UserRole.student
    is_active: bool = True


class AdminResetPasswordIn(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)


class AdminUserOut(BaseModel):
    id: int
    username: str
    role: UserRole
    is_active: bool
    created_by: int | None
    created_at: datetime


class AssignmentCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    question_type_id: int
    question_count: int = Field(ge=1, le=200)


class AssignmentOut(BaseModel):
    id: int
    title: str
    description: str | None
    status: AssignmentStatus
    publish_at: datetime | None
    due_at: datetime | None
    created_by: int
    created_at: datetime
    updated_at: datetime
    question_count: int = 0
    assigned_user_count: int = 0
    assigned_users: list[str] = Field(default_factory=list)


class AssignmentQuestionOut(BaseModel):
    wrong_question_id: int
    question_order: int
    stem: str
    options: list[OptionItem]
    correct_answer: list[AnswerItem]
    question_type_id: int
    knowledge_tag_ids: list[int]


class AssignmentDetailOut(AssignmentOut):
    questions: list[AssignmentQuestionOut]


class AssignUsersIn(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=500)


class AssignmentSubmissionItemOut(BaseModel):
    user_id: int
    username: str
    status: UserAssignmentStatus
    started_at: datetime | None
    submitted_at: datetime | None
    score: float | None
    accuracy_rate: float | None
    answered_questions: int = 0
    correct_questions: int = 0


class AssignmentSubmissionDetailOut(BaseModel):
    assignment_id: int
    user_id: int
    username: str
    status: UserAssignmentStatus
    started_at: datetime | None
    submitted_at: datetime | None
    score: float | None
    accuracy_rate: float | None
    answers: list["UserAnswerOut"]


class LearnerAssignmentListItemOut(BaseModel):
    assignment_id: int
    title: str
    status: UserAssignmentStatus
    due_at: datetime | None
    submitted_at: datetime | None
    score: float | None
    accuracy_rate: float | None
    question_count: int


class LearnerAssignmentDetailOut(BaseModel):
    assignment_id: int
    title: str
    description: str | None
    status: UserAssignmentStatus
    due_at: datetime | None
    submitted_at: datetime | None
    score: float | None
    accuracy_rate: float | None
    questions: list[AssignmentQuestionOut]


class SaveAnswerIn(BaseModel):
    wrong_question_id: int
    user_answer: list[AnswerItem] = Field(min_length=1, max_length=100)


class UserAnswerOut(BaseModel):
    id: int
    assignment_id: int
    user_id: int
    wrong_question_id: int
    wrong_question_stem: str | None = None
    user_answer: list[AnswerItem]
    standard_answer: list[AnswerItem] | None
    is_correct: bool
    answered_at: datetime

    model_config = {"from_attributes": True}


class SubmitAssignmentOut(BaseModel):
    assignment_id: int
    user_id: int
    total_questions: int
    answered_questions: int
    correct_questions: int
    score: float
    accuracy_rate: float
    answers: list[UserAnswerOut]


AssignmentSubmissionDetailOut.model_rebuild()
LearnerPracticeRecordDetailOut.model_rebuild()
