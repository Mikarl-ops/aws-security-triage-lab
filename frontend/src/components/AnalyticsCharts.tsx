import type { FindingAnalytics } from "../types";

interface AnalyticsChartsProps {
  analytics: FindingAnalytics | null;
  error: string | null;
  loading: boolean;
}

function displayDate(day: string, options: Intl.DateTimeFormatOptions) {
  const date = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(date);
}

function ResourceTypeChart({ analytics }: { analytics: FindingAnalytics }) {
  const ordered = [...analytics.by_resource_type].sort(
    (left, right) => right.count - left.count || left.resource_type.localeCompare(right.resource_type),
  );
  const shown = ordered.slice(0, 6);
  const otherCount = ordered.slice(6).reduce((total, item) => total + item.count, 0);
  if (otherCount > 0) shown.push({ resource_type: "Other resource types", count: otherCount });
  const max = Math.max(1, ...shown.map((item) => item.count));

  return (
    <ol aria-label="Finding counts by resource type" className="resource-chart">
      {shown.map((item) => (
        <li className="resource-chart-row" key={item.resource_type}>
          <span className="resource-chart-label" title={item.resource_type}>{item.resource_type}</span>
          <span aria-hidden="true" className="resource-bar-track">
            <span className="resource-bar-fill" style={{ width: `${(item.count / max) * 100}%` }} />
          </span>
          <span className="resource-chart-count">{item.count}</span>
        </li>
      ))}
    </ol>
  );
}

function FindingsOverTimeChart({ analytics }: { analytics: FindingAnalytics }) {
  const width = 680;
  const height = 224;
  const left = 40;
  const right = 14;
  const top = 14;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = analytics.by_observed_day;
  const maximum = Math.max(1, ...values.map((item) => item.count));
  const points = values.map((item, index) => ({
    ...item,
    x: left + (values.length <= 1 ? plotWidth / 2 : (index / (values.length - 1)) * plotWidth),
    y: top + plotHeight - (item.count / maximum) * plotHeight,
  }));
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const areaPath = points.length
    ? `${linePath} L${points[points.length - 1].x},${top + plotHeight} L${points[0].x},${top + plotHeight} Z`
    : "";
  const midValue = Math.ceil(maximum / 2);
  const axisLabels = maximum <= 2 ? [maximum, 0] : [maximum, midValue, 0];
  const dateIndexes = [...new Set([0, Math.floor((values.length - 1) / 2), values.length - 1])];

  return (
    <>
      <svg
        aria-label={`Daily finding counts in UTC for the ${analytics.window.days}-day window, ${analytics.window.start} through ${analytics.window.end}. ${analytics.total} matching findings.`}
        className="time-chart"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <title>Findings over time</title>
        {axisLabels.map((label, index) => {
          const y = top + (index / (axisLabels.length - 1)) * plotHeight;
          return (
            <g key={`${label}-${index}`}>
              <line className="chart-grid-line" x1={left} x2={width - right} y1={y} y2={y} />
              <text className="chart-axis-label" textAnchor="end" x={left - 8} y={y + 4}>{label}</text>
            </g>
          );
        })}
        <path className="chart-area" d={areaPath} />
        <path className="chart-line" d={linePath} />
        {points.map((point) => (
          <circle className="chart-point" cx={point.x} cy={point.y} key={point.day} r="3">
            <title>{`${displayDate(point.day, { month: "long", day: "numeric", year: "numeric" })}: ${point.count} findings`}</title>
          </circle>
        ))}
        {dateIndexes.map((index) => {
          const point = points[index];
          if (!point) return null;
          return (
            <text className="chart-axis-label chart-date-label" key={point.day} textAnchor="middle" x={point.x} y={height - 9}>
              {displayDate(point.day, { month: "short", day: "numeric" })}
            </text>
          );
        })}
      </svg>
      <ol className="sr-only">
        {values.map((item) => (
          <li key={item.day}>{displayDate(item.day, { month: "long", day: "numeric", year: "numeric" })}: {item.count} findings</li>
        ))}
      </ol>
    </>
  );
}

export function AnalyticsCharts({ analytics, error, loading }: AnalyticsChartsProps) {
  const periodLabel = analytics
    ? `${displayDate(analytics.window.start, { month: "short", day: "numeric" })} – ${displayDate(analytics.window.end, { month: "short", day: "numeric" })} · UTC`
    : "Last 30 days · UTC";

  return (
    <section aria-label="Finding analytics" className="analytics-grid">
      <article className="analytics-card">
        <header className="analytics-card-heading">
          <div>
            <h2>Findings by resource type</h2>
            <p>Complete filtered set · {periodLabel}</p>
          </div>
        </header>
        {error ? <p className="analytics-message error-text" role="status">Analytics unavailable: {error}</p> : null}
        {!error && loading ? <p className="analytics-message" role="status">Loading analytics…</p> : null}
        {!error && !loading && analytics?.total === 0 ? (
          <p className="analytics-message">No findings match these filters in this period.</p>
        ) : null}
        {!error && !loading && analytics && analytics.total > 0 ? <ResourceTypeChart analytics={analytics} /> : null}
      </article>

      <article className="analytics-card">
        <header className="analytics-card-heading">
          <div>
            <h2>Findings over time</h2>
            <p>Daily observations · {periodLabel}</p>
          </div>
          {analytics ? <strong className="analytics-total">{analytics.total}</strong> : null}
        </header>
        {error ? <p className="analytics-message error-text" role="status">Analytics unavailable: {error}</p> : null}
        {!error && loading ? <p className="analytics-message" role="status">Loading analytics…</p> : null}
        {!error && !loading && analytics?.total === 0 ? (
          <p className="analytics-message">No findings match these filters in this period.</p>
        ) : null}
        {!error && !loading && analytics && analytics.total > 0 ? <FindingsOverTimeChart analytics={analytics} /> : null}
      </article>
    </section>
  );
}
