"""add knowledge lesson teacher edit and send fields

Revision ID: e8c3f1a62b90
Revises: d4a91c2e7b18
Create Date: 2026-08-29 11:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e8c3f1a62b90"
down_revision: Union[str, Sequence[str], None] = "d4a91c2e7b18"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("knowledge_lesson_analyses", sa.Column("student_message", sa.Text(), nullable=True))
    op.add_column(
        "knowledge_lesson_analyses",
        sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
    )
    op.add_column("knowledge_lesson_analyses", sa.Column("sent_at", sa.DateTime(), nullable=True))
    op.add_column("knowledge_lesson_analyses", sa.Column("sent_by", sa.Integer(), nullable=True))
    op.add_column("knowledge_lesson_analyses", sa.Column("published_result", sa.JSON(), nullable=True))
    op.create_foreign_key(
        "fk_knowledge_lesson_sent_by",
        "knowledge_lesson_analyses",
        "users",
        ["sent_by"],
        ["id"],
    )
    op.create_index("ix_knowledge_lesson_status", "knowledge_lesson_analyses", ["status"])


def downgrade() -> None:
    op.drop_index("ix_knowledge_lesson_status", table_name="knowledge_lesson_analyses")
    op.drop_constraint("fk_knowledge_lesson_sent_by", "knowledge_lesson_analyses", type_="foreignkey")
    op.drop_column("knowledge_lesson_analyses", "published_result")
    op.drop_column("knowledge_lesson_analyses", "sent_by")
    op.drop_column("knowledge_lesson_analyses", "sent_at")
    op.drop_column("knowledge_lesson_analyses", "status")
    op.drop_column("knowledge_lesson_analyses", "student_message")
