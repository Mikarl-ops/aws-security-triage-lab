"""Shared local syntax for stored resource Region codes; this is not an AWS lookup."""

import re

REGION_CODE_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)+-[0-9]+$")


def is_region_code(value: object) -> bool:
    return (
        isinstance(value, str)
        and 0 < len(value) <= 32
        and bool(REGION_CODE_PATTERN.fullmatch(value))
    )
