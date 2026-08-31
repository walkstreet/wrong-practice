"""add organizations and org_admin role

Revision ID: f7b2e91c4a10
Revises: e8c3f1a62b90
Create Date: 2026-08-31 18:00:00.000000

"""
from datetime import datetime
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = "f7b2e91c4a10"
down_revision: Union[str, Sequence[str], None] = "e8c4b17d2a90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
    )
    op.add_column("users", sa.Column("organization_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_users_organization_id"), "users", ["organization_id"], unique=False)
    op.create_foreign_key(
        "fk_users_organization_id",
        "users",
        "organizations",
        ["organization_id"],
        ["id"],
    )

    conn = op.get_bind()
    now = datetime.utcnow()
    admin_id = conn.execute(text("SELECT id FROM users WHERE role = 'superadmin' ORDER BY id LIMIT 1")).scalar()

    teachers = conn.execute(text("SELECT id, username, display_name FROM users WHERE role = 'teacher'")).fetchall()
    for row in teachers:
        label = (row.display_name or row.username or "").strip() or f"用户{row.id}"
        name = f"{label}的机构"[:64]
        org_id = conn.execute(
            text(
                "INSERT INTO organizations (name, created_by, created_at) "
                "VALUES (:name, :created_by, :created_at) RETURNING id"
            ),
            {"name": name, "created_by": admin_id, "created_at": now},
        ).scalar()
        conn.execute(
            text("UPDATE users SET organization_id = :oid, role = 'org_admin' WHERE id = :id"),
            {"oid": org_id, "id": row.id},
        )
        conn.execute(
            text(
                "UPDATE users SET organization_id = :oid "
                "WHERE role = 'student' AND created_by = :tid AND organization_id IS NULL"
            ),
            {"oid": org_id, "tid": row.id},
        )

    leftover = conn.execute(
        text("SELECT id FROM users WHERE role = 'student' AND organization_id IS NULL")
    ).fetchall()
    if leftover:
        org_id = conn.execute(
            text(
                "INSERT INTO organizations (name, created_by, created_at) "
                "VALUES (:name, :created_by, :created_at) RETURNING id"
            ),
            {"name": "历史未归属", "created_by": admin_id, "created_at": now},
        ).scalar()
        conn.execute(
            text("UPDATE users SET organization_id = :oid WHERE role = 'student' AND organization_id IS NULL"),
            {"oid": org_id},
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("UPDATE users SET role = 'teacher' WHERE role = 'org_admin'"))
    op.drop_constraint("fk_users_organization_id", "users", type_="foreignkey")
    op.drop_index(op.f("ix_users_organization_id"), table_name="users")
    op.drop_column("users", "organization_id")
    op.drop_table("organizations")
