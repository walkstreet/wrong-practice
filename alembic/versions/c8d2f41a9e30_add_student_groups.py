"""add student groups and members

Revision ID: c8d2f41a9e30
Revises: b2d7f30a8c41
Create Date: 2026-09-01 13:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c8d2f41a9e30"
down_revision: Union[str, Sequence[str], None] = "b2d7f30a8c41"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "student_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=32), nullable=False),
        sa.Column("teacher_id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["teacher_id"], ["users.id"], name="fk_student_groups_teacher_id"),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], name="fk_student_groups_organization_id"
        ),
        sa.UniqueConstraint("teacher_id", "name", name="uq_student_groups_teacher_name"),
    )
    op.create_index(op.f("ix_student_groups_teacher_id"), "student_groups", ["teacher_id"], unique=False)
    op.create_index(
        op.f("ix_student_groups_organization_id"), "student_groups", ["organization_id"], unique=False
    )
    op.create_table(
        "student_group_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["student_groups.id"],
            name="fk_student_group_members_group_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_student_group_members_user_id"),
        sa.UniqueConstraint("group_id", "user_id", name="uq_student_group_members_group_user"),
    )
    op.create_index(
        op.f("ix_student_group_members_group_id"), "student_group_members", ["group_id"], unique=False
    )
    op.create_index(
        op.f("ix_student_group_members_user_id"), "student_group_members", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_student_group_members_user_id"), table_name="student_group_members")
    op.drop_index(op.f("ix_student_group_members_group_id"), table_name="student_group_members")
    op.drop_table("student_group_members")
    op.drop_index(op.f("ix_student_groups_organization_id"), table_name="student_groups")
    op.drop_index(op.f("ix_student_groups_teacher_id"), table_name="student_groups")
    op.drop_table("student_groups")
