import { useState, type FormEvent } from "react";
import type { AuditEvent, Finding, FindingNote, FindingStatus } from "../types";
import { allowedTransitions, formatDate, severityLabels, statusLabels } from "../presentation";

interface FindingDetailsProps {
  finding: Finding | null;
  notes: FindingNote[];
  history: AuditEvent[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  canUpdate: boolean;
  onClose: () => void;
  onRetry: () => void;
  onChangeStatus: (status: FindingStatus, reason: string | null) => Promise<boolean>;
  onAddNote: (body: string) => Promise<boolean>;
}

export function FindingDetails({
  finding,
  notes,
  history,
  loading,
  busy,
  error,
  canUpdate,
  onClose,
  onRetry,
  onChangeStatus,
  onAddNote,
}: FindingDetailsProps) {
  const [nextStatus, setNextStatus] = useState<FindingStatus | "">(() =>
    finding ? allowedTransitions[finding.status][0] ?? "" : "",
  );
  const [resolutionReason, setResolutionReason] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const choices = finding ? allowedTransitions[finding.status] : [];
  const needsResolutionReason = nextStatus === "resolved" || nextStatus === "dismissed";

  async function submitStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nextStatus) return;
    const success = await onChangeStatus(
      nextStatus,
      needsResolutionReason ? resolutionReason.trim() : null,
    );
    if (success) setResolutionReason("");
  }

  async function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const success = await onAddNote(noteBody.trim());
    if (success) setNoteBody("");
  }

  return (
    <div className="drawer-layer">
      <button aria-label="Close finding details" className="drawer-backdrop" onClick={onClose} type="button" />
      <aside aria-labelledby="detail-title" aria-modal="true" className="detail-drawer" role="dialog">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Finding details</p>
            <h2 id="detail-title">Investigation</h2>
          </div>
          <button aria-label="Close finding details" className="icon-button" onClick={onClose} type="button">
            <svg aria-hidden="true" className="icon" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div aria-busy={loading} className="drawer-content">
          {error && (
            <div className="dashboard-error" role="alert">
              <p>{error}</p>
              <button className="text-button" onClick={onRetry} type="button">Reload details</button>
            </div>
          )}
          {!finding && loading && <p aria-live="polite" className="loading-details">Loading finding…</p>}
          {finding && (
            <>
              <div className="detail-title-row">
                <span className={`severity severity-${finding.severity}`}>
                  <span className="severity-dot" />
                  {severityLabels[finding.severity]} severity
                </span>
                <span className={`status status-${finding.status}`}>{statusLabels[finding.status]}</span>
              </div>
              <h3 className="detail-finding-title">{finding.title}</h3>
              <p className="detail-description">{finding.description}</p>

              <section className="detail-section">
                <h3>Evidence summary</h3>
                <p>{finding.evidence_summary}</p>
              </section>

              <section className="detail-section">
                <h3>Source information</h3>
                <dl className="detail-grid">
                  <div>
                    <dt>Source</dt>
                    <dd>{finding.source}</dd>
                  </div>
                  <div>
                    <dt>Observed</dt>
                    <dd>{formatDate(finding.observed_at)}</dd>
                  </div>
                  {finding.source_event_id && (
                    <div>
                      <dt>Source event</dt>
                      <dd>{finding.source_event_id}</dd>
                    </div>
                  )}
                  {Object.entries(finding.metadata).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key.replaceAll("_", " ")}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
                {finding.resolution_reason && (
                  <div className="resolution-callout">
                    <strong>Resolution reason</strong>
                    <p>{finding.resolution_reason}</p>
                  </div>
                )}
              </section>

              {canUpdate && choices.length > 0 && (
                <section className="detail-section action-section">
                  <h3>Update status</h3>
                  <form className="status-form" onSubmit={submitStatus}>
                    <label className="detail-field">
                      <span>Move to</span>
                      <select
                        aria-label="Move finding to status"
                        onChange={(event) => setNextStatus(event.target.value as FindingStatus)}
                        value={nextStatus}
                      >
                        {choices.map((status) => (
                          <option key={status} value={status}>{statusLabels[status]}</option>
                        ))}
                      </select>
                    </label>
                    {needsResolutionReason && (
                      <label className="detail-field">
                        <span>Resolution reason</span>
                        <textarea
                          aria-label="Resolution reason"
                          maxLength={1000}
                          onChange={(event) => setResolutionReason(event.target.value)}
                          required
                          rows={3}
                          value={resolutionReason}
                        />
                      </label>
                    )}
                    <button className="secondary-button" disabled={busy || !nextStatus} type="submit">
                      {busy ? "Saving…" : "Save status"}
                    </button>
                  </form>
                </section>
              )}

              <section className="detail-section">
                <div className="section-heading-row">
                  <h3>Investigation notes</h3>
                  <span className="section-count">{notes.length}</span>
                </div>
                {notes.length ? (
                  <div className="note-list">
                    {notes.map((note) => (
                      <article className="note-card" key={note.id}>
                        <div className="note-meta">
                          <strong>{note.author}</strong>
                          <time dateTime={note.created_at}>{formatDate(note.created_at)}</time>
                        </div>
                        <p>{note.body}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="empty-copy">No notes have been added to this finding.</p>
                )}
                {canUpdate ? (
                  <form className="note-form" onSubmit={submitNote}>
                    <label className="detail-field">
                      <span>Add an investigation note</span>
                      <textarea
                        aria-label="Add an investigation note"
                        maxLength={4000}
                        minLength={1}
                        onChange={(event) => setNoteBody(event.target.value)}
                        placeholder="Record a concise, evidence-based update…"
                        required
                        rows={3}
                        value={noteBody}
                      />
                    </label>
                    <div className="note-form-footer">
                      <span>{noteBody.length}/4,000</span>
                      <button className="secondary-button" disabled={busy || !noteBody.trim()} type="submit">
                        {busy ? "Saving…" : "Add note"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="readonly-copy">Viewer access is read-only.</p>
                )}
              </section>

              <section className="detail-section">
                <div className="section-heading-row">
                  <h3>Activity history</h3>
                  <span className="section-count">{history.length}</span>
                </div>
                {history.length ? (
                  <ol className="timeline">
                    {history.map((event) => (
                      <li key={event.id}>
                        <span className="timeline-marker" />
                        <div>
                          <strong>{event.actor}</strong>
                          <p>
                            {event.event_type === "finding.status_changed"
                              ? `Changed status to ${String(event.details.to_status ?? "updated")}`
                              : "Added an investigation note"}
                          </p>
                          <time dateTime={event.occurred_at}>{formatDate(event.occurred_at)}</time>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="empty-copy">No activity has been recorded yet.</p>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
