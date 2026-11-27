import { useEffect, useId, useState } from "react";
import { api, ApiError } from "../api";

interface SourceFilterProps {
  value: string;
  revision: number;
  onChange: (source: string) => void;
  onSessionExpired: () => void;
}

interface SourceResult {
  requestKey: string;
  sources: string[];
  error: string | null;
}

export function SourceFilter({ value, revision, onChange, onSessionExpired }: SourceFilterProps) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<SourceResult | null>(null);
  const helpId = useId();
  const requestKey = `${revision}:${attempt}`;
  const loading = result?.requestKey !== requestKey;
  const error = loading ? null : result?.error;
  const sources = Array.from(new Set([...(result?.sources ?? []), ...(value ? [value] : [])])).sort();

  useEffect(() => {
    let active = true;
    api.getSources()
      .then((items) => {
        if (active) setResult({ requestKey, sources: items, error: null });
      })
      .catch((failure: unknown) => {
        if (!active) return;
        if (failure instanceof ApiError && failure.status === 401) {
          onSessionExpired();
        } else {
          setResult((previous) => ({ requestKey, sources: previous?.sources ?? [],
            error: failure instanceof ApiError ? failure.message : "The source list could not be loaded. Try again." }));
        }
      });
    return () => { active = false; };
  }, [requestKey, onSessionExpired]);

  const message = loading ? "Loading sources…" : error ? `Source list unavailable: ${error}`
    : result?.sources.length === 0 ? "No sources are available yet." : null;

  return <div aria-busy={loading} className="source-filter">
    <label className="filter-select">
      <span className="sr-only">Source</span>
      <select aria-label="Source" aria-describedby={message ? helpId : undefined}
        onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">All sources</option>
        {sources.map((source) => <option key={source} value={source}>{source}</option>)}
      </select>
    </label>
    <button className="text-button" disabled={loading} onClick={() => setAttempt((current) => current + 1)} type="button">
      {error ? "Retry sources" : "Refresh sources"}
    </button>
    {message && <span className={`source-filter-help${error ? " error-text" : ""}`} id={helpId} role="status">{message}</span>}
  </div>;
}
