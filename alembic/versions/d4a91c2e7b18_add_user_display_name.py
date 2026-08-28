"""add user display_name

Revision ID: d4a91c2e7b18
Revises: c052284d97a1
Create Date: 2026-08-29 02:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4a91c2e7b18"
down_revision: Union[str, Sequence[str], None] = "c052284d97a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("display_name", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "display_name")
