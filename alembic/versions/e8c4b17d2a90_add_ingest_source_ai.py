"""add ingest_source ai

Revision ID: e8c4b17d2a90
Revises: e8c3f1a62b90
Create Date: 2026-08-29 11:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e8c4b17d2a90"
down_revision: Union[str, Sequence[str], None] = "e8c3f1a62b90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TYPE ingestsource ADD VALUE IF NOT EXISTS 'ai'"))


def downgrade() -> None:
    # PostgreSQL 无法安全删除 enum 值，保留 ai。
    pass
