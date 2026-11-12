import { formatDate } from "../presentation";
import type { FindingProvider, ProviderFindingStatus } from "../types";

const providerStatusLabels: Record<ProviderFindingStatus, string> = {
  ACTIVE: "Active",
  ARCHIVED: "Archived",
  RESOLVED: "Resolved",
};

export function ProviderContext({ provider }: { provider: FindingProvider }) {
  return (
    <section aria-labelledby="provider-context-title" className="detail-section">
      <h3 id="provider-context-title">Provider context</h3>
      <p>Provider updates are tracked separately from analyst decisions.</p>
      <dl className="detail-grid">
        <div>
          <dt>Provider status</dt>
          <dd>{providerStatusLabels[provider.status]}</dd>
        </div>
        <div>
          <dt>Public access reported</dt>
          <dd>{provider.is_public ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt>Provider created</dt>
          <dd><time dateTime={provider.created_at}>{formatDate(provider.created_at)}</time></dd>
        </div>
        <div>
          <dt>Provider updated</dt>
          <dd><time dateTime={provider.updated_at}>{formatDate(provider.updated_at)}</time></dd>
        </div>
        <div>
          <dt>Last analyzed</dt>
          <dd><time dateTime={provider.analyzed_at}>{formatDate(provider.analyzed_at)}</time></dd>
        </div>
      </dl>
    </section>
  );
}
