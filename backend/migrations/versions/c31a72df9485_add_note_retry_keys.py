"""add note retry keys

Revision ID: c31a72df9485
Revises: e915cb74f602
Create Date: 2026-11-20 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "c31a72df9485"
down_revision = "e915cb74f602"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("finding_notes") as batch:
        batch.add_column(sa.Column("client_request_id", sa.Uuid(), nullable=True))
        batch.create_unique_constraint(
            "uq_finding_notes_client_request", ["finding_id", "author_id", "client_request_id"]
        )


def downgrade():
    with op.batch_alter_table("finding_notes") as batch:
        batch.drop_constraint("uq_finding_notes_client_request", type_="unique")
        batch.drop_column("client_request_id")
