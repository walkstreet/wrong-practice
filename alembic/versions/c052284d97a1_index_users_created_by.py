"""index users.created_by

Revision ID: c052284d97a1
Revises: c3f8a12e9b70
Create Date: 2026-08-29 00:59:38.598232

"""
from typing import Sequence, Union

from alembic import op


revision: str = "c052284d97a1"
down_revision: Union[str, Sequence[str], None] = "c3f8a12e9b70"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(op.f("ix_users_created_by"), "users", ["created_by"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_users_created_by"), table_name="users")
