"""add wrong_questions.deleted_at

Revision ID: c3f8a12e9b70
Revises: b7e2c91a4d08
Create Date: 2026-08-28 11:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3f8a12e9b70"
down_revision: Union[str, Sequence[str], None] = "b7e2c91a4d08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("wrong_questions", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    op.execute(
        sa.text("UPDATE wrong_questions SET deleted_at = updated_at WHERE deleted IS TRUE AND deleted_at IS NULL")
    )


def downgrade() -> None:
    op.drop_column("wrong_questions", "deleted_at")
