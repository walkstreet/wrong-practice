"""question org scope and platform public bank

Revision ID: b2d7f30a8c41
Revises: a9c4e18f6b20
Create Date: 2026-08-31 18:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = "b2d7f30a8c41"
down_revision: Union[str, Sequence[str], None] = "a9c4e18f6b20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("wrong_questions", sa.Column("organization_id", sa.Integer(), nullable=True))
    op.add_column(
        "wrong_questions",
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index(op.f("ix_wrong_questions_organization_id"), "wrong_questions", ["organization_id"], unique=False)
    op.create_foreign_key(
        "fk_wrong_questions_organization_id",
        "wrong_questions",
        "organizations",
        ["organization_id"],
        ["id"],
    )
    op.add_column("organizations", sa.Column("public_bank_status", sa.String(length=32), nullable=True))
    op.add_column("organizations", sa.Column("public_bank_reason", sa.Text(), nullable=True))
    op.add_column("organizations", sa.Column("public_bank_review_note", sa.Text(), nullable=True))
    op.add_column("organizations", sa.Column("public_bank_requested_at", sa.DateTime(), nullable=True))
    op.add_column("organizations", sa.Column("public_bank_reviewed_at", sa.DateTime(), nullable=True))
    op.add_column("organizations", sa.Column("public_bank_reviewer_id", sa.Integer(), nullable=True))
    op.create_index("ix_organizations_public_bank_status", "organizations", ["public_bank_status"])
    op.create_foreign_key(
        "fk_organizations_public_bank_reviewer_id",
        "organizations",
        "users",
        ["public_bank_reviewer_id"],
        ["id"],
    )

    conn = op.get_bind()
    conn.execute(
        text(
            """
            UPDATE wrong_questions AS q
            SET organization_id = u.organization_id
            FROM users AS u
            WHERE q.created_by = u.id
            """
        )
    )


def downgrade() -> None:
    op.drop_constraint("fk_organizations_public_bank_reviewer_id", "organizations", type_="foreignkey")
    op.drop_index("ix_organizations_public_bank_status", table_name="organizations")
    op.drop_column("organizations", "public_bank_reviewer_id")
    op.drop_column("organizations", "public_bank_reviewed_at")
    op.drop_column("organizations", "public_bank_requested_at")
    op.drop_column("organizations", "public_bank_review_note")
    op.drop_column("organizations", "public_bank_reason")
    op.drop_column("organizations", "public_bank_status")
    op.drop_constraint("fk_wrong_questions_organization_id", "wrong_questions", type_="foreignkey")
    op.drop_index(op.f("ix_wrong_questions_organization_id"), table_name="wrong_questions")
    op.drop_column("wrong_questions", "is_public")
    op.drop_column("wrong_questions", "organization_id")
