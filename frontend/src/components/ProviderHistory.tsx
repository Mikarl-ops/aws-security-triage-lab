import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { formatDate } from "../presentation";
import type { PageResponse, ProviderChangeField, ProviderEvent } from "../types";

const fieldLabels: Record<ProviderChangeField, string> = {
  provider_status: "Provider status",
  is_public: "Public access reported",
  priority: "Triage priority",
  resource_type: "Resource type",
  resource_location_scope: "Location scope",
  resource_region: "Resource Region",
  provider_created_at: "Provider created",
  provider_updated_at: "Provider updated",
  provider_analyzed_at: "Last analyzed",
};

function displayValue(field: ProviderChangeField, value: string | boolean | null) {
  if (value === null) return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field.endsWith("_at") && !Number.isNaN(Date.parse(value))) return formatDate(value);
  if (field === "provider_status" || field === "priority" || field === "resource_location_scope") {
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }
  return value;
}

export function ProviderHistory({ findingId, onReloadFinding }: {
  findingId: string;
  onReloadFinding: () => void;
}) {
  const [data, setData] = useState<PageResponse<ProviderEvent> | null>(null);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"expired" | "unavailable" | null>(null);

  useEffect(() => {
    let active = true;
    api.listProviderHistory(findingId, page)
      .then((result) => { if (active) setData(result); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof ApiError && reason.status === 401 ? "expired" : "unavailable");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [findingId, page, retry]);

  function changePage(next: number) {
    setLoading(true);
    setError(null);
    setPage(next);
  }

  return (
    <section aria-busy={loading} aria-labelledby="provider-history-title" className="detail-section">
      <div className="section-heading-row">
        <h3 id="provider-history-title">Provider history</h3>
        {data && <span aria-label={`${data.total} provider events`} className="section-count">{data.total}</span>}
      </div>
      <p>Provider changes recorded during synthetic imports, newest first.</p>
      {loading && <p role="status">Loading provider history…</p>}
      {error && (
        <div className="provider-history-error" role="status">
          <p>{error === "expired"
            ? "Your session has expired. Reload finding details to sign in again."
            : "Provider history could not be loaded."}</p>
          <button className="text-button" type="button" onClick={error === "expired" ? onReloadFinding : () => {
            setLoading(true);
            setError(null);
            setRetry((value) => value + 1);
          }}>{error === "expired" ? "Reload finding details" : "Retry provider history"}</button>
        </div>
      )}
      {!loading && !error && data?.items.length === 0 && (
        <p className="empty-copy">No provider changes have been recorded for this finding.</p>
      )}
      {!loading && !error && data && data.items.length > 0 && (
        <ol className="timeline">
          {data.items.map((event) => (
            <li key={event.id}>
              <span className="timeline-marker" />
              <div>
                <strong>{event.event_type === "provider.imported" ? "Finding imported" : "Provider fields refreshed"}</strong>
                <p>Finding version {event.finding_version}</p>
                <time dateTime={event.occurred_at}>{formatDate(event.occurred_at)}</time>
                <dl className="provider-change-list">
                  {Object.entries(event.changes).map(([name, change]) => {
                    const field = name as ProviderChangeField;
                    if (!change || !fieldLabels[field]) return null;
                    return <div key={field}>
                      <dt>{fieldLabels[field]}</dt>
                      <dd>{displayValue(field, change.before)} <span aria-label="changed to">→</span> {displayValue(field, change.after)}</dd>
                    </div>;
                  })}
                </dl>
              </div>
            </li>
          ))}
        </ol>
      )}
      {data && data.pages > 1 && (
        <nav aria-label="Provider history pages" className="provider-history-pages">
          <button className="text-button" type="button" disabled={loading || error !== null || data.page <= 1}
            onClick={() => changePage(data.page - 1)}>Newer provider events</button>
          <span aria-live="polite">Page {data.page} of {data.pages}</span>
          <button className="text-button" type="button" disabled={loading || error !== null || data.page >= data.pages}
            onClick={() => changePage(data.page + 1)}>Older provider events</button>
        </nav>
      )}
    </section>
  );
}
