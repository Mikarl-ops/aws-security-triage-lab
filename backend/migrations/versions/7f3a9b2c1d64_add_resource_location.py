"""add explicit resource location fields

Revision ID: 7f3a9b2c1d64
Revises: 21e02898f447
Create Date: 2026-11-10 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "7f3a9b2c1d64"
down_revision = "21e02898f447"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("findings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "resource_location_scope",
                sa.String(length=16),
                server_default="unknown",
                nullable=False,
            )
        )
        batch_op.add_column(sa.Column("resource_region", sa.String(length=32), nullable=True))
        batch_op.create_check_constraint(
            "valid_resource_location_scope",
            "resource_location_scope IN ('region', 'global', 'unknown')",
        )
        batch_op.create_check_constraint(
            "consistent_resource_location",
            "(resource_location_scope = 'region' AND resource_region IS NOT NULL) OR "
            "(resource_location_scope IN ('global', 'unknown') AND resource_region IS NULL)",
        )

    # Legacy metadata.region is intentionally not copied: its meaning may be
    # an event or source Region rather than the location of the affected resource.


def downgrade():
    with op.batch_alter_table("findings", schema=None) as batch_op:
        batch_op.drop_constraint("consistent_resource_location", type_="check")
        batch_op.drop_constraint("valid_resource_location_scope", type_="check")
        batch_op.drop_column("resource_region")
        batch_op.drop_column("resource_location_scope")
