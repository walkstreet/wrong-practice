"""add user avatar_url

Revision ID: b7e2c91a4d08
Revises: 7934a61cf82d
Create Date: 2026-08-24 23:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7e2c91a4d08"
down_revision: Union[str, Sequence[str], None] = "7934a61cf82d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_url", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_url")
