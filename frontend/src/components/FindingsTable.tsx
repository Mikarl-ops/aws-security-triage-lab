import type { FindingListItem, FindingSeverity, FindingStatus } from "../types";
import { formatDate, severityLabels, statusLabels } from "../presentation";

export interface FindingFiltersView {
  status: FindingStatus | "all";
  severity: FindingSeverity | "all";
  source: string;
}

interface FindingsTableProps {
  findings: FindingListItem[];
  filters: FindingFiltersView;
  sources: string[];
  page: number;
  pageSize: number;
  pages: number;
  total: number;
  loading: boolean;
  error: string | null;
  onFiltersChange: (filters: FindingFiltersView) => void;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onOpen: (findingId: string) => void;
}

export function FindingsTable({
  findings,
  filters,
  sources,
  page,
  pageSize,
  pages,
  total,
  loading,
  error,
  onFiltersChange,
  onPageChange,
  onRetry,
  onOpen,
}: FindingsTableProps) {
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  function updateFilter<T extends keyof FindingFiltersView>(key: T, value: FindingFiltersView[T]) {
    onFiltersChange({ ...filters, [key]: value });
  }

  return (
    <section aria-labelledby="findings-title" className="findings-panel">
      <div className="panel-heading">
        <div>
          <div className="panel-title-row">
            <h2 id="findings-title">Recent findings</h2>
            <span aria-label={`${total} matching findings`} className="result-count">{total}</span>
          </div>
          <p>Review the queue and open a finding to see its evidence and history.</p>
        </div>
        <span className="table-context"><span className="context-dot" /> Current result set</span>
      </div>

      <div className="filter-bar">
        <div className="filter-caption">
          <span aria-hidden="true" className="filter-symbol">≡</span>
          <span>Filter by</span>
        </div>
        <label className="filter-select">
          <span className="sr-only">Analyst status</span>
          <select
            aria-label="Analyst status"
            onChange={(event) => updateFilter("status", event.target.value as FindingFiltersView["status"])}
            value={filters.status}
          >
            <option value="all">All analyst statuses</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="filter-select">
          <span className="sr-only">Triage priority</span>
          <select
            aria-label="Triage priority"
            onChange={(event) => updateFilter("severity", event.target.value as FindingFiltersView["severity"])}
            value={filters.severity}
          >
            <option value="all">All priorities</option>
            {Object.entries(severityLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="filter-select">
          <span className="sr-only">Source</span>
          <select aria-label="Source" onChange={(event) => updateFilter("source", event.target.value)} value={filters.source}>
            <option value="all">All sources</option>
            {sources.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
        </label>
        <button
          className="clear-filters"
          onClick={() => onFiltersChange({ status: "all", severity: "all", source: "all" })}
          type="button"
        >
          Clear filters
        </button>
      </div>

      {error && (
        <div className="dashboard-error" role="alert">
          <p>{error}</p>
          <button className="text-button" onClick={onRetry} type="button">Try again</button>
        </div>
      )}

      <div aria-busy={loading} aria-label="Findings table" className="table-scroll" role="region" tabIndex={0}>
        <table>
          <caption className="sr-only">Cloud security findings and their current investigation status</caption>
          <thead>
            <tr>
              <th scope="col">Finding</th>
              <th scope="col">Triage priority</th>
              <th scope="col">Analyst status</th>
              <th scope="col">Source</th>
              <th scope="col">Last updated</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {findings.map((finding) => (
              <tr key={finding.id}>
                <td className="finding-cell">
                  <button
                    aria-label={`View ${finding.title}`}
                    className="finding-link"
                    onClick={() => onOpen(finding.id)}
                    type="button"
                  >
                    {finding.title}
                  </button>
                  <span className="finding-meta">Observed {formatDate(finding.observed_at)}</span>
                </td>
                <td>
                  <span className={`severity severity-${finding.severity}`}>
                    <span className="severity-dot" />
                    {severityLabels[finding.severity]}
                  </span>
                </td>
                <td>
                  <span className={`status status-${finding.status}`}>{statusLabels[finding.status]}</span>
                </td>
                <td className="source-cell">{finding.source}</td>
                <td className="date-cell">{formatDate(finding.updated_at)}</td>
                <td className="action-cell">
                  <button
                    aria-label={`Open details for ${finding.title}`}
                    className="icon-button row-action"
                    onClick={() => onOpen(finding.id)}
                    type="button"
                  >
                    <svg aria-hidden="true" className="icon" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && findings.length === 0 && !error && (
          <div className="empty-table">
            <span aria-hidden="true" className="empty-table-icon">⌕</span>
            <strong>No findings match these filters</strong>
            <p>Try broadening your search criteria.</p>
            <button
              className="text-button"
              onClick={() => onFiltersChange({ status: "all", severity: "all", source: "all" })}
              type="button"
            >
              Clear filters
            </button>
          </div>
        )}

        {loading && <div aria-live="polite" className="loading-table">Loading findings…</div>}
      </div>

      <div className="table-footer">
        <span>
          Showing <strong>{rangeStart}–{rangeEnd}</strong> of <strong>{total}</strong> findings
        </span>
        <div className="pagination-controls">
          <span>Page {page} of {Math.max(pages, 1)}</span>
          <button
            aria-label="Previous page"
            className="page-button"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
            type="button"
          >
            ‹
          </button>
          <button
            aria-label="Next page"
            className="page-button"
            disabled={page >= pages || loading}
            onClick={() => onPageChange(page + 1)}
            type="button"
          >
            ›
          </button>
        </div>
      </div>
    </section>
  );
}
