"""add provider-owned finding fields

Revision ID: d24e71c8a903
Revises: 7f3a9b2c1d64
Create Date: 2026-11-10 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d24e71c8a903"
down_revision = "7f3a9b2c1d64"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("findings", schema=None) as batch_op:
        batch_op.add_column(sa.Column("provider_status", sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column("provider_is_public", sa.Boolean(), nullable=True))
        batch_op.add_column(
            sa.Column("provider_created_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column("provider_updated_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column("provider_analyzed_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.create_check_constraint(
            "valid_provider_status",
            "provider_status IS NULL OR provider_status IN ('ACTIVE', 'ARCHIVED', 'RESOLVED')",
        )
        batch_op.create_check_constraint(
            "consistent_provider_fields",
            "(provider_status IS NULL AND provider_is_public IS NULL AND "
            "provider_created_at IS NULL AND provider_updated_at IS NULL AND "
            "provider_analyzed_at IS NULL) OR "
            "(provider_status IS NOT NULL AND provider_is_public IS NOT NULL AND "
            "provider_created_at IS NOT NULL AND provider_updated_at IS NOT NULL AND "
            "provider_analyzed_at IS NOT NULL)",
        )


def downgrade():
    with op.batch_alter_table("findings", schema=None) as batch_op:
        batch_op.drop_constraint("consistent_provider_fields", type_="check")
        batch_op.drop_constraint("valid_provider_status", type_="check")
        batch_op.drop_column("provider_analyzed_at")
        batch_op.drop_column("provider_updated_at")
        batch_op.drop_column("provider_created_at")
        batch_op.drop_column("provider_is_public")
        batch_op.drop_column("provider_status")
