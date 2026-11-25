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
| `provider_status` | `ACTIVE`, `ARCHIVED`, `RESOLVED`, or `none` for findings without provider data |
| `location_scope` | `region`, `global`, or `unknown` |
| `resource_region` | Lowercase Region code of at most 32 characters, such as `ap-southeast-1` |
| `observed_from`, `observed_to` | RFC 3339 timestamps with a timezone |
| `page`, `page_size` | Positive page number; page size from 1 to 100 |

Unsupported or invalid query parameters return a client error. Results are ordered by observation time, newest first.

`provider_status` is separate from analyst `status` and combines with the other filters using AND. For example, `/findings?provider_status=ARCHIVED&status=new` finds provider-archived records still awaiting analyst review. `none` matches a null provider status, including legacy synthetic findings; omitting the parameter includes all provider states and records without provider data. An empty, unsupported, or repeated `provider_status` returns 400. Values are case-sensitive.

Location filters use only stored `resource_location_scope` and `resource_region`, never `metadata.region` or source-IP geography. `location_scope=region` includes every regional resource; `global` and `unknown` match their explicit scopes separately. An exact `resource_region` implies regional scope when scope is omitted. Combining an exact Region with `global` or `unknown` returns 400. Empty, malformed, or repeated location parameters also return 400.

Region syntax is `^[a-z0-9]+(?:-[a-z0-9]+)+-[0-9]+$` with a maximum length of 32. The API neither normalizes uppercase/whitespace nor checks an AWS Region inventory. A well-formed but unpopulated code returns empty results, including codes without map coordinates. For example, `/findings?resource_region=ap-southeast-1&provider_status=ARCHIVED&status=new` combines all three criteria using AND. Queue date filters remain available alongside location filters.

### `GET /findings/summary`

Returns total findings and counts by triage status and severity. It does not accept query parameters.

### `GET /findings/analytics`

Returns analytics for findings observed in the last 30 UTC calendar days, including today. It accepts the `status`, `severity`, `source`, `provider_status`, `location_scope`, and `resource_region` filters described above. The response's `total`, resource-type counts, and daily counts use the same filtered cohort. Aggregates are computed server-side across every matching finding and are independent of the findings table's pagination.

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

Detail responses include `provider` as null for findings without provider-owned fields. Imported findings return only the allowlisted provider status, public-access flag, and provider creation, update, and analysis timestamps. These fields remain separate from analyst status, resolution reason, notes, and application timestamps.

Example provider context for a synthetic imported finding:

```json
{
  "provider": {
    "status": "ARCHIVED",
    "is_public": false,
    "created_at": "2026-10-30T08:00:00Z",
    "updated_at": "2026-10-31T09:00:00Z",
    "analyzed_at": "2026-10-31T09:05:00Z"
  }
}
```

The dashboard shows this context in a read-only section and formats its timestamps in UTC. The Triage priority and Analyst status filters continue to send the existing `severity` and `status` API parameters. Access Analyzer priority is assigned by the documented local rule; provider status does not change analyst status.

The Provider status selector sends the same `provider_status` value to the queue, resource/time charts, and Region analytics. **No provider data** sends `none`; **All provider statuses** omits the filter. Changing any filter resets the queue to page 1, and either **Clear filters** control removes the provider filter as well. Overview cards still use the unfiltered `/findings/summary` endpoint. Queue totals may exceed chart/map totals because the analytics window covers only the last 30 UTC days.

The **Resource location** selector and map count buttons share those same requests. **All locations** omits both location parameters. **Regional resources** sends `location_scope=region`; **Apply Region** trims and lowercases a complete typed code before adding `resource_region`. Typing alone does not change requests. A blank applied code includes all regional resources. Changing scope clears the exact Region, and either clear control removes both location criteria. Applied criteria survive **Refresh finding**.

### `GET /findings/region-analytics`

Returns counts by explicit AWS resource Region plus counts by location scope for the same last-30-day UTC window. It accepts all six filters supported by `/findings/analytics`, with the same location validation; neither result depends on table pagination. The `by_region` array includes only findings whose scope is `region`. `by_scope` always includes `region`, `global`, and `unknown` counts. Global and unknown findings are not assigned map coordinates.

### `GET /findings/{finding_id}/provider-history`

Returns provider import and refresh events for one finding to authenticated viewers and analysts. Only `page` and `page_size` are accepted; pages are positive and page size is 1 to 100. Results use the standard paginated response and are ordered by finding version, newest first. Missing findings return 404; findings without recorded events return an empty page. No write route is available.

Each item contains `id`, `event_type` (`provider.imported` or `provider.updated`), `finding_version`, `occurred_at` in UTC, and `changes`. Each change has `before` and `after` values. The allowlist includes provider status, public-access flag, local priority, resource type and location, and provider timestamps. Raw provider identifiers and payloads are excluded. Unsupported fields, nested values, and oversized strings are omitted from responses.

Provider events are committed with the finding update. Repeated, stale, and failed imports create no persisted history. The history begins when the history migration is applied and a finding is imported or refreshed; earlier events are not reconstructed. The existing `/history` endpoint remains the analyst activity log.

## Analyst actions

Status changes require the analyst role and an `expected_version`, and are written with an audit event. Notes also require the analyst role and create an audit event. Viewers can read findings but cannot change them. API error responses use a consistent problem shape and avoid returning internal exception details.

### `PATCH /findings/{finding_id}`

Send the version from the last successful detail response as a positive integer:

```json
{
  "status": "dismissed",
  "expected_version": 2,
  "resolution_reason": "Synthetic finding reviewed for the local demonstration."
}
```

Valid transitions are `new` to `investigating` or `dismissed`, `investigating` to `resolved` or `dismissed`, and either `resolved` or `dismissed` back to `investigating`. Resolving or dismissing requires a nonblank reason of at most 1,000 characters. Other transitions require an omitted or null reason. Invalid input or transitions return 422.

A provider refresh or another analyst's status save can increment the finding version. If `expected_version` no longer matches, the API returns 409 and changes no finding fields or histories. Fetch the details again, review the current status and provider context, then submit an explicit retry with the new version. A successful update returns the full detail response, increments the version, and records one analyst status event in the same transaction. It does not change provider fields or provider history.

The dashboard refreshes the queue and details on 409 while keeping unsaved text in the open drawer. Saves are disabled until the details load successfully. It does not automatically resubmit the rejected action. The selected transition must remain valid for the refreshed analyst status.

### `POST /findings/{finding_id}/notes`

Send a nonblank `body` of at most 4,000 characters, optionally with a `client_request_id` UUID:

```json
{
  "body": "Synthetic investigation note for retry testing.",
  "client_request_id": "e2772124-423e-4416-aa08-aa063f710001"
}
```

The optional key must be a hyphenated UUID string; malformed or null values return 422. The first accepted request creates one note and one analyst audit event in the same transaction. Reusing that key for the same author, finding, and trimmed text returns the original note ID, text, author, and timestamp without another write. Initial and replay responses both use 201 and the existing note response shape. The key is not included in note read responses.

Reusing the scoped key with different trimmed text returns 409 without changing the original note or history. Different authors or findings have independent key scopes, and a new key can intentionally create another note with identical text. Every request, including a replay, requires a valid analyst session and CSRF token.

A database uniqueness constraint handles concurrent uses of a scoped key. A losing transaction rolls back before reading the committed note; failure before commit leaves the key available for a later retry. Keys are retained with their notes. Requests omitting the key keep the existing append behavior and receive no replay protection.

Notes do not require `expected_version`, overwrite finding fields, or increment the finding version. The dashboard generates a key for a submitted draft and retains it after a failed response and across in-place detail reloads. Retrying unchanged trimmed text in the same open review sends the same key. An acknowledged success, edited submitted text, or a new review starts a new submission. Closing, signing out, or refreshing the browser discards the in-memory retry state; it is not persisted in browser storage. The dashboard never automatically resubmits a failed write.

### Read notes and analyst activity

`GET /findings/{finding_id}/notes` and `GET /findings/{finding_id}/history` return independent paginated responses to authenticated viewers and analysts. They accept only positive `page` and `page_size` values, with page size from 1 to 100. Defaults are page 1 and 25 records. Unsupported or invalid queries return 400; missing findings return 404.

Both endpoints order records by their creation/activity timestamp ascending, then UUID ascending for equal timestamps. Responses include `items`, `page`, `page_size`, `total`, and `pages`. Empty histories have one empty page; out-of-range pages return an empty item list while retaining the full total and page count. Reads change no finding versions or records.

The dashboard requests 25 records per page. On opening or refreshing a review, each list reads page 1 to discover the page count, then reads the last page if necessary. This uses at most two bounded requests per list and places recent saves in view. Records remain chronological within that page. Notes and activity have independent older/newer controls and error recovery; loading one list does not reload the other or discard form drafts.

After a successful save or a full detail refresh, both lists restart from their newest page. A failed list read shows an unavailable state and a retry, rather than an empty-history message. An expired session offers a finding reload to recover through the existing sign-in flow. Page totals can change between requests; this is offset pagination, not a consistent snapshot across the whole history.

## Refresh an open review

The drawer's **Refresh finding** action uses the existing authenticated GET endpoints for details, notes, analyst history, provider history when present, summary, queue, and analytics. It is available to viewers and analysts. The error panel's **Reload details** uses the same refresh path. Neither action submits a note, changes analyst status, or runs an import.

Current filters remain selected and the queue returns to page 1. The drawer keeps the selected finding even if refreshed queue criteria now exclude it. Note and analyst history panels reopen on their newest page; provider history starts with its newest events. Provider history also reloads when the finding version is unchanged. The record panels follow the explicit reload revision so receiving a newer detail response does not start an extra provider-history read.

The editor retains unsaved text and a failed unchanged note's submission key during refresh. Refresh is disabled during a write or an active detail read. Saves remain disabled until the detail read succeeds; a failed detail read keeps the drafts available for another refresh. An expired session follows the existing sign-in flow and discards the open review's temporary state.

Reads are independent requests and do not form an atomic database snapshot. Each panel retains its existing bounded paging, loading, and error behavior. Queue/chart counts may differ because of the analytics time window. Refresh reads persisted local data; it performs no AWS calls or automatic write retries.

## Synthetic-data boundary

The Compose setup loads fabricated data only. No endpoint currently reads from AWS or writes to an AWS account.
