"""add users.teacher_id for student affiliation

Revision ID: a9c4e18f6b20
Revises: f7b2e91c4a10
Create Date: 2026-08-31 18:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = "a9c4e18f6b20"
down_revision: Union[str, Sequence[str], None] = "f7b2e91c4a10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("teacher_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_users_teacher_id"), "users", ["teacher_id"], unique=False)
    op.create_foreign_key("fk_users_teacher_id", "users", "users", ["teacher_id"], ["id"])

    conn = op.get_bind()
    conn.execute(
        text(
            """
            UPDATE users AS student
            SET teacher_id = student.created_by
            FROM users AS staff
            WHERE student.role = 'student'
              AND student.created_by = staff.id
              AND staff.role IN ('teacher', 'org_admin')
              AND (
                student.organization_id IS NULL
                OR staff.organization_id IS NULL
                OR student.organization_id = staff.organization_id
              )
            """
        )
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_teacher_id", "users", type_="foreignkey")
    op.drop_index(op.f("ix_users_teacher_id"), table_name="users")
    op.drop_column("users", "teacher_id")
