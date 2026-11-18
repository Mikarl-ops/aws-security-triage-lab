import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../api";
import { formatDate } from "../presentation";
import type { AuditEvent, FindingNote, PageResponse } from "../types";

interface RecordsProps {
  findingId: string;
  revision?: number;
  onReloadFinding: () => void;
}

function RecordPages<T>({ findingId, title, noun, headingId, emptyMessage, loadPage, renderItems, onReloadFinding }: {
  findingId: string;
  title: string;
  noun: string;
  headingId: string;
  emptyMessage: string;
  loadPage: (id: string, page: number) => Promise<PageResponse<T>>;
  renderItems: (items: T[]) => ReactNode;
  onReloadFinding: () => void;
}) {
  const [data, setData] = useState<PageResponse<T> | null>(null);
  const [page, setPage] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"expired" | "unavailable" | null>(null);

  useEffect(() => {
    let active = true;
    async function readPage() {
      let result = await loadPage(findingId, page ?? 1);
      // The API orders oldest first. Discover the last page with at most two bounded reads.
      if (active && page === null && result.pages > 1) result = await loadPage(findingId, result.pages);
      if (active) setData(result);
    }
    readPage()
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof ApiError && reason.status === 401 ? "expired" : "unavailable");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [findingId, loadPage, page, retry]);

  function changePage(next: number) {
    setLoading(true);
    setError(null);
    setPage(next);
  }

  return <div aria-busy={loading}>
    <div className="section-heading-row">
      <h3 id={headingId}>{title}</h3>
      {data && <span aria-label={`${data.total} ${noun}`} className="section-count">{data.total}</span>}
    </div>
    {loading && <p role="status">Loading {title.toLowerCase()}…</p>}
    {error && <div role="status">
      <p>{error === "expired"
        ? "Your session has expired. Reload finding details to sign in again."
        : `${title} could not be loaded.`}</p>
      <button className="text-button" type="button" onClick={error === "expired" ? onReloadFinding : () => {
        setLoading(true);
        setError(null);
        setRetry((value) => value + 1);
      }}>{error === "expired" ? "Reload finding details" : `Retry ${title.toLowerCase()}`}</button>
    </div>}
    {!loading && !error && data && (data.items.length === 0
      ? <p className="empty-copy">{emptyMessage}</p>
      : <>
        <p className="record-range">Showing {(data.page - 1) * data.page_size + 1}–{(data.page - 1) * data.page_size + data.items.length} of {data.total} {noun}, oldest first within this page.</p>
        {renderItems(data.items)}
      </>)}
    {data && data.pages > 1 && <nav aria-label={`${title} pages`} className="record-pages">
      <button className="text-button" type="button" disabled={loading || error !== null || data.page <= 1}
        onClick={() => changePage(data.page - 1)}>Older {noun}</button>
      <span aria-live="polite">Page {data.page} of {data.pages}</span>
      <button className="text-button" type="button" disabled={loading || error !== null || data.page >= data.pages}
        onClick={() => changePage(data.page + 1)}>Newer {noun}</button>
    </nav>}
  </div>;
}

export function FindingNotes({ findingId, revision = 0, onReloadFinding }: RecordsProps) {
  return <RecordPages<FindingNote>
    key={`${findingId}-${revision}`} findingId={findingId} title="Investigation notes" noun="notes"
    headingId="finding-notes-title" emptyMessage="No notes have been added to this finding."
    loadPage={api.listNotes} onReloadFinding={onReloadFinding}
    renderItems={(notes) => <div className="note-list">
      {notes.map((note) => <article className="note-card" key={note.id}>
        <div className="note-meta">
          <strong>{note.author}</strong>
          <time dateTime={note.created_at}>{formatDate(note.created_at)}</time>
        </div>
        <p>{note.body}</p>
      </article>)}
    </div>}
  />;
}

export function AnalystHistory({ findingId, revision = 0, onReloadFinding }: RecordsProps) {
  return <section aria-labelledby="analyst-history-title" className="detail-section">
    <RecordPages<AuditEvent>
      key={`${findingId}-${revision}`} findingId={findingId} title="Analyst activity" noun="activity events"
      headingId="analyst-history-title" emptyMessage="No activity has been recorded yet."
      loadPage={api.listHistory} onReloadFinding={onReloadFinding}
      renderItems={(events) => <ol className="timeline">
        {events.map((event) => <li key={event.id}>
          <span className="timeline-marker" />
          <div>
            <strong>{event.actor}</strong>
            <p>{event.event_type === "finding.status_changed"
              ? `Changed status to ${String(event.details.to_status ?? "updated")}`
              : "Added an investigation note"}</p>
            <time dateTime={event.occurred_at}>{formatDate(event.occurred_at)}</time>
          </div>
        </li>)}
      </ol>}
    />
  </section>;
}
