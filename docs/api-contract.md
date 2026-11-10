# API contract

The local API is served under `/api/v1`. Finding and analytics endpoints require an authenticated session. State-changing requests also require the CSRF token returned by `/auth/csrf`; analyst-only changes are enforced by the server.

## Findings

### `GET /findings`

Returns a page of findings. Supported query parameters are:

| Parameter | Values |
|---|---|
| `status` | `new`, `investigating`, `resolved`, `dismissed` |
| `severity` | `critical`, `high`, `medium`, `low`, `informational` |
| `source` | Lowercase identifier containing letters, numbers, `_`, or `-` |
| `observed_from`, `observed_to` | RFC 3339 timestamps with a timezone |
| `page`, `page_size` | Positive page number; page size from 1 to 100 |

Unsupported or invalid query parameters return a client error. Results are ordered by observation time, newest first.

### `GET /findings/summary`

Returns total findings and counts by triage status and severity. It does not accept query parameters.

### `GET /findings/analytics`

Returns analytics for findings observed in the last 30 UTC calendar days, including today. It accepts the `status`, `severity`, and `source` filters described above. The response's `total`, resource-type counts, and daily counts use the same filtered cohort. Aggregates are computed server-side across every matching finding and are independent of the findings table's pagination.

Abbreviated example response shape (the returned daily bucket list contains 30 entries):

```json
{
  "window": {
    "days": 30,
    "start": "2026-10-11",
    "end": "2026-11-09",
    "timezone": "UTC"
  },
  "total": 2,
  "by_resource_type": [
    { "resource_type": "iam-role", "count": 1 },
    { "resource_type": "Unknown", "count": 1 }
  ],
  "by_observed_day": [
    { "day": "2026-10-11", "count": 0 },
    { "day": "2026-10-12", "count": 1 }
  ]
}
```

The example is illustrative. `by_observed_day` always contains one entry for each date in the returned window, with zeroes for dates that have no matching findings. Resource types that are missing, blank, or longer than 128 characters are grouped as `Unknown`. The dashboard shows the six most frequent resource types and combines any remainder under “Other resource types.”

Finding detail responses include `resource_location` as a separate value with `scope` set to `region`, `global`, or `unknown`. `region` is populated only for the `region` scope. For example, `{"resource_location":{"scope":"region","region":"ap-southeast-2"}}` describes a regional resource, while global or unknown locations return a null region. Legacy `metadata.region` values are not used to infer resource location because they may describe an event or source context.

## Analyst actions

Status changes require the analyst role and an `expected_version`, and are written with an audit event. Notes also require the analyst role and create an audit event. Viewers can read findings but cannot change them. API error responses use a consistent problem shape and avoid returning internal exception details.

## Synthetic-data boundary

The Compose setup loads fabricated data only. No endpoint currently reads from AWS or writes to an AWS account.
