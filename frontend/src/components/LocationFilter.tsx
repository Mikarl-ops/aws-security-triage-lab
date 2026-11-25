import { useState, type FormEvent } from "react";
import type { ResourceLocationScope } from "../types";

function RegionCodeForm({ region, onApply }: { region: string; onApply: (region: string) => void }) {
  const [draft, setDraft] = useState(region);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = draft.trim().toLowerCase();
    if (normalized && (normalized.length > 32 || !/^[a-z0-9]+(?:-[a-z0-9]+)+-[0-9]+$/.test(normalized))) {
      setError("Use a Region code such as ap-southeast-1, or leave it blank for all Regions.");
      return;
    }
    setError(null);
    setDraft(normalized);
    onApply(normalized);
  }

  return <form aria-label="Filter by AWS Region" className="region-code-form" onSubmit={submit}>
    <label className="filter-select">
      <span className="sr-only">AWS Region code</span>
      <input aria-label="AWS Region code" aria-describedby={error ? "region-code-help region-code-error" : "region-code-help"}
        aria-invalid={error !== null} autoComplete="off" maxLength={32} placeholder="All Regions" spellCheck={false}
        value={draft} onChange={(event) => { setDraft(event.target.value); setError(null); }} />
    </label>
    <button className="secondary-button" type="submit">Apply Region</button>
    <span className="region-filter-help" id="region-code-help">Applied Region: {region || "All Regions"}. Choose Apply Region to update.</span>
    {error && <span className="region-filter-help error-text" id="region-code-error" role="alert">{error}</span>}
  </form>;
}

export function LocationFilter({ scope, region, onChange }: {
  scope: ResourceLocationScope | "all";
  region: string;
  onChange: (scope: ResourceLocationScope | "all", region: string) => void;
}) {
  return <div className="location-filter">
    <label className="filter-select">
      <span className="sr-only">Resource location</span>
      <select aria-label="Resource location" value={scope}
        onChange={(event) => onChange(event.target.value as ResourceLocationScope | "all", "")}>
        <option value="all">All locations</option>
        <option value="region">Regional resources</option>
        <option value="global">Global resources</option>
        <option value="unknown">Unknown location</option>
      </select>
    </label>
    {scope === "region" && <RegionCodeForm key={region} region={region} onApply={(value) => onChange("region", value)} />}
  </div>;
}
