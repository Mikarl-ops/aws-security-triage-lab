"""add provider change history

Revision ID: e915cb74f602
Revises: d24e71c8a903
Create Date: 2026-11-16 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e915cb74f602"
down_revision = "d24e71c8a903"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "provider_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("finding_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("finding_version", sa.Integer(), nullable=False),
        sa.Column(
            "occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "changes", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False
        ),
        sa.CheckConstraint(
            "event_type IN ('provider.imported', 'provider.updated')",
            name=op.f("ck_provider_events_valid_event_type"),
        ),
        sa.CheckConstraint(
            "finding_version > 0", name=op.f("ck_provider_events_positive_finding_version")
        ),
        sa.ForeignKeyConstraint(
            ["finding_id"],
            ["findings.id"],
            name=op.f("fk_provider_events_finding_id_findings"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_provider_events")),
        sa.UniqueConstraint(
            "finding_id", "finding_version", name="uq_provider_events_finding_version"
        ),
    )


def downgrade():
    op.drop_table("provider_events")
