from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, Float, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ReviewStatus(str, Enum):
    not_reviewed = "not_reviewed"
    reviewed = "reviewed"
    mastered = "mastered"


class IngestSource(str, Enum):
    ocr = "ocr"
    manual = "manual"
    dify = "dify"


class UserRole(str, Enum):
    superadmin = "superadmin"
    teacher = "teacher"
    student = "student"


class ClaimRequestStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class AssignmentStatus(str, Enum):
    draft = "draft"
    published = "published"
    closed = "closed"


class UserAssignmentStatus(str, Enum):
    assigned = "assigned"
    in_progress = "in_progress"
    submitted = "submitted"
    graded = "graded"


class WrongQuestion(Base):
    __tablename__ = "wrong_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    stem: Mapped[str] = mapped_column(Text, nullable=False)
    options: Mapped[list[Any]] = mapped_column(JSON, nullable=False)
    correct_answer: Mapped[list[Any]] = mapped_column(JSON, nullable=False)
    wrong_answer: Mapped[list[Any]] = mapped_column(JSON, nullable=False)
    question_type_id: Mapped[int] = mapped_column(ForeignKey("question_types.id"), nullable=False)
    difficulty: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str | None] = mapped_column(String(255))
    ingest_source: Mapped[IngestSource] = mapped_column(SAEnum(IngestSource), default=IngestSource.manual)
    external_trace_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    ocr_raw_text: Mapped[str | None] = mapped_column(Text)
    ocr_payload: Mapped[dict | None] = mapped_column(JSON)
    note: Mapped[str | None] = mapped_column(Text)
    wrong_at: Mapped[datetime | None] = mapped_column(DateTime)
    review_status: Mapped[ReviewStatus] = mapped_column(
        SAEnum(ReviewStatus), default=ReviewStatus.not_reviewed, nullable=False
    )
    deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    ai_analysis: Mapped[dict | None] = mapped_column(JSON)
    ai_analyzed_at: Mapped[datetime | None] = mapped_column(DateTime)
    ai_model: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    question_type: Mapped["QuestionType"] = relationship(back_populates="wrong_questions")
    tags: Mapped[list["WrongQuestionKnowledgeTag"]] = relationship(back_populates="wrong_question")
    practice_records: Mapped[list["PracticeRecord"]] = relationship(back_populates="wrong_question")


class KnowledgeTag(Base):
    __tablename__ = "knowledge_tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("knowledge_tags.id"))
    status: Mapped[str] = mapped_column(String(16), default="active")


class QuestionType(Base):
    __tablename__ = "question_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    # 题型大类，用于录入下拉分组，如：选择类 / 语篇阅读 / 语言运用
    category: Mapped[str] = mapped_column(String(64), default="其他", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active")

    wrong_questions: Mapped[list[WrongQuestion]] = relationship(back_populates="question_type")


class WrongQuestionKnowledgeTag(Base):
    __tablename__ = "wrong_question_knowledge_tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    wrong_question_id: Mapped[int] = mapped_column(ForeignKey("wrong_questions.id"), nullable=False)
    knowledge_tag_id: Mapped[int] = mapped_column(ForeignKey("knowledge_tags.id"), nullable=False)

    wrong_question: Mapped[WrongQuestion] = relationship(back_populates="tags")


class PracticeRecord(Base):
    __tablename__ = "practice_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    wrong_question_id: Mapped[int] = mapped_column(ForeignKey("wrong_questions.id"), nullable=False)
    generated_question: Mapped[dict] = mapped_column(JSON, nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    answered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    wrong_question: Mapped[WrongQuestion] = relationship(back_populates="practice_records")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(String(32), default=UserRole.student, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class Assignment(Base):
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[AssignmentStatus] = mapped_column(
        SAEnum(AssignmentStatus), default=AssignmentStatus.draft, nullable=False
    )
    publish_at: Mapped[datetime | None] = mapped_column(DateTime)
    due_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    questions: Mapped[list["AssignmentQuestion"]] = relationship(back_populates="assignment")
    user_assignments: Mapped[list["UserAssignment"]] = relationship(back_populates="assignment")


class AssignmentQuestion(Base):
    __tablename__ = "assignment_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id"), nullable=False, index=True)
    wrong_question_id: Mapped[int] = mapped_column(ForeignKey("wrong_questions.id"), nullable=False)
    question_order: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    assignment: Mapped["Assignment"] = relationship(back_populates="questions")
    wrong_question: Mapped["WrongQuestion"] = relationship()


class UserAssignment(Base):
    __tablename__ = "user_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    status: Mapped[UserAssignmentStatus] = mapped_column(
        SAEnum(UserAssignmentStatus), default=UserAssignmentStatus.assigned, nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime)
    score: Mapped[float | None] = mapped_column(Float)
    accuracy_rate: Mapped[float | None] = mapped_column(Float)

    assignment: Mapped["Assignment"] = relationship(back_populates="user_assignments")
    user: Mapped["User"] = relationship()


class UserAnswer(Base):
    __tablename__ = "user_answers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    wrong_question_id: Mapped[int] = mapped_column(ForeignKey("wrong_questions.id"), nullable=False)
    user_answer: Mapped[list[Any]] = mapped_column(JSON, nullable=False)
    standard_answer: Mapped[list[Any] | None] = mapped_column(JSON)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    answered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped["User"] = relationship()
    wrong_question: Mapped["WrongQuestion"] = relationship()


class LearningWeaknessAnalysis(Base):
    """高错误率 TopN 短板分析的全量落库记录。"""

    __tablename__ = "learning_weakness_analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str | None] = mapped_column(String(128), index=True)
    wrong_question_id: Mapped[int | None] = mapped_column(Integer, index=True)
    limit_n: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    scope_note: Mapped[str | None] = mapped_column(String(255))
    analyzed_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    model: Mapped[str | None] = mapped_column(String(64))
    # 分析时使用的题目快照（含错误率、题型、知识点等）
    source_items: Mapped[list[Any]] = mapped_column(JSON, nullable=False)
    # AI 完整结果：overall_summary / weak_areas / suggestions / methods / weekly_plan
    result: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    analyzed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class KnowledgeLessonAnalysis(Base):
    """知识点讲解 + 小测的落库记录（按知识点 + 短板分析关联回显）。"""

    __tablename__ = "knowledge_lesson_analyses"
    __table_args__ = (
        Index(
            "ix_knowledge_lesson_point_weakness",
            "knowledge_point",
            "weakness_analysis_id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    knowledge_point: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    weakness_analysis_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("learning_weakness_analyses.id"), index=True, nullable=True
    )
    evidence: Mapped[str | None] = mapped_column(Text)
    overall_summary: Mapped[str | None] = mapped_column(Text)
    # explanation / key_points / examples / quiz
    result: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    model: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class QuestionClaimRequest(Base):
    """教师向超管申请查看全量题库。"""

    __tablename__ = "bank_access_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    requester_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    status: Mapped[ClaimRequestStatus] = mapped_column(
        String(32), default=ClaimRequestStatus.pending, nullable=False, index=True
    )
    reason: Mapped[str | None] = mapped_column(Text)
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    review_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)


class ActivityLog(Base):
    """超管可见的关键行为记录。"""

    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    actor_username: Mapped[str | None] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(32), nullable=False)
    resource_id: Mapped[int | None] = mapped_column(Integer, index=True)
    summary: Mapped[str] = mapped_column(String(500), nullable=False)
    extra: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
