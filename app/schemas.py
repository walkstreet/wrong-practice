from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

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


def _clean_display_name(value: str | None) -> str | None:
    name = (value or "").strip()
    return name or None


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


class WrongQuestionBase(BaseModel):
    stem: str = Field(min_length=1)
    # 兼容三类输入：
    # 1) 单题单组选项: ["A.xxx", "B.xxx"]
    # 2) 多组选项: [["A1", "B1"], ["A2", "B2"]]
    # 3) 无选项题: []
    options: list[OptionItem] = Field(default_factory=list, max_length=100)
    # 兼容单题答案和多组答案（例如完形/阅读多小题、语法填空多空）
    correct_answer: list[AnswerItem] = Field(min_length=1, max_length=100)
    wrong_answer: list[AnswerItem] = Field(default_factory=list, max_length=100)
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
    organization_id: int | None = None
    is_public: bool = False
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
    sentence_analysis: dict[str, Any] | None = None
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
    display_name: str | None = None
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
    display_name: str | None = None
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


class StudentRosterItemOut(BaseModel):
    user_id: int
    username: str
    display_name: str | None = None
    is_active: bool
    total_attempts: int
    accuracy_rate: float | None = None
    error_rate: float | None = None
    last_answered_at: datetime | None = None
    status: str
    weak_tags: list[str] = Field(default_factory=list)
    group_ids: list[int] = Field(default_factory=list)
    group_names: list[str] = Field(default_factory=list)
    teacher_id: int | None = None
    teacher_name: str | None = None
    organization_id: int | None = None
    organization_name: str | None = None


class StudentRosterOut(BaseModel):
    students: list[StudentRosterItemOut]
    class_accuracy_rate: float | None = None
    class_error_rate: float | None = None
    watch_count: int = 0
    lag_count: int = 0
    insufficient_count: int = 0


class StudentGroupMemberOut(BaseModel):
    user_id: int
    username: str
    display_name: str | None = None


class StudentGroupOut(BaseModel):
    id: int
    name: str
    teacher_id: int
    teacher_name: str | None = None
    organization_id: int | None = None
    organization_name: str | None = None
    member_count: int = 0
    member_ids: list[int] = Field(default_factory=list)
    members: list[StudentGroupMemberOut] = Field(default_factory=list)
    created_at: datetime


class StudentGroupCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    teacher_id: int | None = None
    member_ids: list[int] = Field(default_factory=list, max_length=500)

    @field_validator("name")
    @classmethod
    def _trim_group_name(cls, value: str) -> str:
        name = (value or "").strip()
        if not name:
            raise ValueError("请填写编组名称")
        return name


class StudentGroupUpdateIn(BaseModel):
    name: str = Field(min_length=1, max_length=32)

    @field_validator("name")
    @classmethod
    def _trim_group_name(cls, value: str) -> str:
        name = (value or "").strip()
        if not name:
            raise ValueError("请填写编组名称")
        return name


class StudentGroupMembersIn(BaseModel):
    member_ids: list[int] = Field(max_length=500)


class PortraitAxisOut(BaseModel):
    name: str
    label: str
    attempts: int
    accuracy_rate: float | None = None
    class_accuracy_rate: float | None = None
    sufficient: bool = False


class PortraitKnowledgeOut(BaseModel):
    name: str
    attempts: int
    accuracy_rate: float
    action: str


class StudentPortraitOut(BaseModel):
    user_id: int
    username: str
    display_name: str | None = None
    is_active: bool
    total_attempts: int
    accuracy_rate: float | None = None
    last_answered_at: datetime | None = None
    status: str
    axes: list[PortraitAxisOut] = Field(default_factory=list)
    knowledge: list[PortraitKnowledgeOut] = Field(default_factory=list)
    latest_analysis: LearningWeaknessAnalysisOut | None = None
    include_class_compare: bool = False


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
    student_message: str = ""
    status: str = "draft"
    sent_at: datetime | None = None
    has_unpublished_changes: bool = False
    model: str = ""
    weakness_analysis_id: int | None = None
    updated_at: datetime | None = None


class KnowledgeLessonUpdateIn(BaseModel):
    student_message: str | None = None
    explanation: str | None = None
    key_points: list[str] | None = None
    examples: list[KnowledgeExampleOut] | None = None


class KnowledgeStudentQuizOut(BaseModel):
    stem: str
    options: list[str] = Field(default_factory=list)
    hint: str = ""


class KnowledgeLessonStudentOut(BaseModel):
    id: int
    knowledge_point: str
    student_message: str = ""
    explanation: str
    key_points: list[str] = Field(default_factory=list)
    examples: list[KnowledgeExampleOut] = Field(default_factory=list)
    quiz: KnowledgeStudentQuizOut
    sent_at: datetime | None = None


class KnowledgeStudentGradeIn(BaseModel):
    user_answer: str = Field(min_length=1)


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
    display_name: str | None = None
    role: UserRole
    is_active: bool
    avatar_url: str | None = None
    organization_id: int | None = None
    organization_name: str | None = None
    permissions: list[str] = []
    can_view_question_bank: bool = False
    bank_request_status: ClaimRequestStatus | None = None


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


class UpdateProfileIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=32)

    @field_validator("display_name")
    @classmethod
    def _normalize_display_name(cls, value: str | None) -> str | None:
        return _clean_display_name(value)


class AdminCreateUserIn(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = Field(default=None, max_length=32)
    role: UserRole = UserRole.student
    is_active: bool = True
    organization_id: int | None = None
    teacher_id: int | None = None

    @field_validator("display_name")
    @classmethod
    def _normalize_display_name(cls, value: str | None) -> str | None:
        return _clean_display_name(value)

    @model_validator(mode="after")
    def _student_needs_name(self):
        if self.role == UserRole.student and not self.display_name:
            raise ValueError("请填写学生姓名")
        return self


class AdminUpdateUserIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=32)

    @field_validator("display_name")
    @classmethod
    def _normalize_display_name(cls, value: str | None) -> str | None:
        return _clean_display_name(value)


class AdminResetPasswordIn(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)


class AdminSetActiveIn(BaseModel):
    is_active: bool


class AdminReassignTeacherIn(BaseModel):
    teacher_id: int


class AdminSetRoleIn(BaseModel):
    role: UserRole


class AdminUserOut(BaseModel):
    id: int
    username: str
    display_name: str | None = None
    role: UserRole
    is_active: bool
    organization_id: int | None = None
    organization_name: str | None = None
    teacher_id: int | None = None
    teacher_name: str | None = None
    created_by: int | None
    created_at: datetime


class OrganizationOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    public_bank_status: str | None = None
    public_bank_reason: str | None = None
    public_bank_review_note: str | None = None
    public_bank_requested_at: datetime | None = None
    public_bank_reviewed_at: datetime | None = None


class OrganizationCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    admin_username: str = Field(min_length=3, max_length=64)
    admin_password: str = Field(min_length=6, max_length=128)
    admin_display_name: str | None = Field(default=None, max_length=32)
    admin_is_active: bool = True

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("请填写机构名称")
        return text

    @field_validator("admin_display_name")
    @classmethod
    def _strip_admin_name(cls, value: str | None) -> str | None:
        return _clean_display_name(value)


class PublicBankReviewIn(BaseModel):
    review_note: str | None = Field(default=None, max_length=500)


class OrganizationUpdateIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("请填写机构名称")
        return text


class AssignmentCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    question_type_id: int
    question_count: int = Field(ge=1, le=200)
    sources: list[str] = Field(default_factory=lambda: ["mine"])
    ai_items: list[AiExtractDraftItem] = Field(default_factory=list)

    @field_validator("sources")
    @classmethod
    def _sources(cls, value: list[str]) -> list[str]:
        allowed = {"mine", "org", "public"}
        cleaned = [item for item in value if item in allowed]
        return cleaned or ["mine"]


class AssignmentQuestionPoolOut(BaseModel):
    question_type_id: int
    question_type_name: str
    available: int
    includes_shared_bank: bool = False


class AssignmentGenerateIn(BaseModel):
    question_type_id: int
    count: int = Field(ge=1, le=20)
    title: str | None = None
    sources: list[str] = Field(default_factory=lambda: ["mine"])

    @field_validator("sources")
    @classmethod
    def _generate_sources(cls, value: list[str]) -> list[str]:
        allowed = {"mine", "org", "public"}
        cleaned = [item for item in value if item in allowed]
        return cleaned or ["mine"]


class AssignmentGenerateOut(BaseModel):
    items: list[AiExtractDraftItem]
    available_in_bank: int
    requested_count: int
    generated_count: int
    model: str | None = None
    warnings: list[str] = Field(default_factory=list)


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
    user_ids: list[int] = Field(default_factory=list, max_length=500)
    group_ids: list[int] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def _need_students_or_groups(self):
        if not self.user_ids and not self.group_ids:
            raise ValueError("请选择学生或编组")
        return self


class AssignmentSubmissionItemOut(BaseModel):
    user_id: int
    username: str
    display_name: str | None = None
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
    display_name: str | None = None
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


class LearnerQuestionOut(BaseModel):
    wrong_question_id: int
    question_order: int
    stem: str
    options: list[OptionItem]
    question_type_id: int
    question_type_name: str | None = None
    knowledge_tag_ids: list[int]
    user_answer: list[AnswerItem] | None = None
    fill_slots: list[bool] | None = None
    multiple: bool = False


class LearnerAssignmentDetailOut(BaseModel):
    assignment_id: int
    title: str
    description: str | None
    status: UserAssignmentStatus
    due_at: datetime | None
    submitted_at: datetime | None
    score: float | None
    accuracy_rate: float | None
    questions: list[LearnerQuestionOut]


class LearnerReviewQuestionOut(BaseModel):
    wrong_question_id: int
    question_order: int
    stem: str
    options: list[OptionItem]
    question_type_id: int
    question_type_name: str | None = None
    knowledge_tag_ids: list[int]
    fill_slots: list[bool] | None = None
    multiple: bool = False
    user_answer: list[AnswerItem] | None = None
    standard_answer: list[AnswerItem] | None = None
    is_correct: bool | None = None
    correct_slots: int = 0
    total_slots: int = 1
    slot_correct: list[bool] = Field(default_factory=list)
    ai_analysis: dict[str, Any] | None = None


class LearnerAssignmentReviewOut(BaseModel):
    assignment_id: int
    title: str
    description: str | None
    status: UserAssignmentStatus
    due_at: datetime | None
    submitted_at: datetime | None
    score: float | None
    accuracy_rate: float | None
    total_questions: int
    answered_questions: int
    correct_questions: int
    total_slots: int = 0
    correct_slots: int = 0
    questions: list[LearnerReviewQuestionOut]


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
    correct_slots: int = 0
    total_slots: int = 1
    slot_correct: list[bool] = Field(default_factory=list)
    answered_at: datetime

    model_config = {"from_attributes": True}


class SubmitAssignmentOut(BaseModel):
    assignment_id: int
    user_id: int
    total_questions: int
    answered_questions: int
    correct_questions: int
    total_slots: int = 0
    correct_slots: int = 0
    score: float
    accuracy_rate: float
    answers: list[UserAnswerOut]


AssignmentSubmissionDetailOut.model_rebuild()
LearnerPracticeRecordDetailOut.model_rebuild()
