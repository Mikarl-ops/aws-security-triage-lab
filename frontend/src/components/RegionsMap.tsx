import type { FindingRegionAnalytics } from "../types";

interface RegionsMapProps {
  analytics: FindingRegionAnalytics | null;
  error: string | null;
  loading: boolean;
}

const MAP_WIDTH = 960;
const MAP_HEIGHT = 420;

// Approximate city positions for common AWS Region codes; the Region code remains authoritative.
const REGION_POSITIONS: Record<string, { latitude: number; longitude: number }> = {
  "af-south-1": { latitude: -33.9, longitude: 18.4 },
  "ap-east-1": { latitude: 22.3, longitude: 114.2 },
  "ap-northeast-1": { latitude: 35.7, longitude: 139.7 },
  "ap-northeast-2": { latitude: 37.5, longitude: 127.0 },
  "ap-northeast-3": { latitude: 34.7, longitude: 135.5 },
  "ap-south-1": { latitude: 19.1, longitude: 72.9 },
  "ap-southeast-1": { latitude: 1.3, longitude: 103.8 },
  "ap-southeast-2": { latitude: -33.9, longitude: 151.2 },
  "ap-southeast-3": { latitude: -6.2, longitude: 106.8 },
  "ca-central-1": { latitude: 45.5, longitude: -73.6 },
  "eu-central-1": { latitude: 50.1, longitude: 8.7 },
  "eu-north-1": { latitude: 59.3, longitude: 18.1 },
  "eu-west-1": { latitude: 53.3, longitude: -6.3 },
  "eu-west-2": { latitude: 51.5, longitude: -0.1 },
  "eu-west-3": { latitude: 48.9, longitude: 2.4 },
  "me-central-1": { latitude: 24.5, longitude: 54.4 },
  "me-south-1": { latitude: 26.2, longitude: 50.6 },
  "sa-east-1": { latitude: -23.5, longitude: -46.6 },
  "us-east-1": { latitude: 38.1, longitude: -77.5 },
  "us-east-2": { latitude: 40.4, longitude: -82.9 },
  "us-west-1": { latitude: 37.4, longitude: -121.9 },
  "us-west-2": { latitude: 45.8, longitude: -119.7 },
};

const LANDMASSES: Array<Array<[number, number]>> = [
  [
    [-168, 70], [-150, 72], [-137, 61], [-127, 55], [-124, 47], [-117, 32], [-107, 23],
    [-97, 17], [-87, 15], [-81, 25], [-80, 34], [-70, 42], [-61, 50], [-68, 58],
    [-82, 61], [-91, 70], [-111, 74], [-131, 70], [-150, 74],
  ],
  [[-52, 82], [-39, 78], [-25, 72], [-34, 61], [-47, 59], [-57, 68]],
  [
    [-81, 12], [-71, 10], [-60, 6], [-49, 0], [-36, -8], [-40, -22], [-50, -30],
    [-54, -40], [-68, -55], [-74, -39], [-78, -15],
  ],
  [
    [-10, 36], [-8, 45], [-12, 51], [2, 56], [15, 61], [31, 68], [49, 72], [72, 70],
    [96, 72], [119, 65], [145, 60], [163, 54], [156, 47], [140, 43], [126, 36],
    [130, 28], [119, 20], [108, 19], [103, 9], [96, 5], [82, 8], [76, 22], [61, 25],
    [50, 30], [39, 35], [29, 41], [20, 39], [14, 35], [5, 36],
  ],
  [
    [-17, 36], [1, 37], [19, 33], [31, 29], [35, 16], [40, 6], [32, -6], [28, -17],
    [20, -35], [10, -35], [1, -22], [-5, -5], [-15, 5], [-17, 20], [-10, 29],
  ],
  [[113, -11], [130, -10], [145, -18], [153, -28], [145, -39], [130, -43], [116, -33]],
];

function project(longitude: number, latitude: number) {
  return {
    x: ((longitude + 180) / 360) * MAP_WIDTH,
    y: ((90 - latitude) / 180) * MAP_HEIGHT,
  };
}

function pathFromCoordinates(coordinates: Array<[number, number]>) {
  return coordinates
    .map(([longitude, latitude], index) => {
      const point = project(longitude, latitude);
      return `${index === 0 ? "M" : "L"}${point.x},${point.y}`;
    })
    .join(" ") + " Z";
}

function displayDate(day: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${day}T00:00:00Z`));
}

export function RegionsMap({ analytics, error, loading }: RegionsMapProps) {
  const periodLabel = analytics
    ? `${displayDate(analytics.window.start)} – ${displayDate(analytics.window.end)} · UTC`
    : "Last 30 days · UTC";
  const plottedRegions = analytics?.by_region.filter((item) => REGION_POSITIONS[item.region]) ?? [];
  const unplottedRegions = analytics?.by_region.filter((item) => !REGION_POSITIONS[item.region]) ?? [];

  return (
    <section aria-labelledby="regions-title" className="region-panel">
      <header className="region-panel-heading">
        <div>
          <p className="eyebrow">RESOURCE PLACEMENT</p>
          <h2 id="regions-title">Findings by AWS Region</h2>
          <p>Full filtered set · {periodLabel}</p>
        </div>
        {analytics ? (
          <div className="region-total">
            <strong>{analytics.total}</strong>
            <span>matching findings</span>
          </div>
        ) : null}
      </header>

      {error ? <p className="region-message error-text" role="status">Region analytics unavailable: {error}</p> : null}
      {!error && loading ? <p className="region-message" role="status">Loading Region analytics…</p> : null}
      {!error && !loading && analytics?.total === 0 ? (
        <p className="region-message">No findings match these filters in this period.</p>
      ) : null}

      {!error && !loading && analytics && analytics.total > 0 ? (
        <div className="region-map-layout">
          <div className="world-map-wrap">
            <svg
              aria-label={`Approximate map of ${analytics.by_scope.region} regional findings. Global: ${analytics.by_scope.global}. Unknown location: ${analytics.by_scope.unknown}.`}
              className="world-map"
              role="img"
              viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
            >
              <title>Approximate AWS resource Region locations</title>
              {[ -120, -60, 0, 60, 120 ].map((longitude) => {
                const point = project(longitude, 0);
                return <line className="map-graticule" key={`lon-${longitude}`} x1={point.x} x2={point.x} y1="0" y2={MAP_HEIGHT} />;
              })}
              {[ -60, -30, 0, 30, 60 ].map((latitude) => {
                const point = project(0, latitude);
                return <line className="map-graticule" key={`lat-${latitude}`} x1="0" x2={MAP_WIDTH} y1={point.y} y2={point.y} />;
              })}
              {LANDMASSES.map((coordinates, index) => (
                <path className="map-landmass" d={pathFromCoordinates(coordinates)} key={`land-${index}`} />
              ))}
              {plottedRegions.map((item) => {
                const position = REGION_POSITIONS[item.region];
                if (!position) return null;
                const point = project(position.longitude, position.latitude);
                const radius = Math.min(13, 6 + Math.log2(item.count + 1) * 1.7);
                const labelX = point.x > MAP_WIDTH - 100 ? point.x - 9 : point.x + 9;
                const anchor = point.x > MAP_WIDTH - 100 ? "end" : "start";
                return (
                  <g className="region-map-marker" key={item.region}>
                    <circle cx={point.x} cy={point.y} r={radius}>
                      <title>{`${item.region}: ${item.count} findings`}</title>
                    </circle>
                    <text textAnchor={anchor} x={labelX} y={point.y - 8}>{item.region}</text>
                  </g>
                );
              })}
            </svg>
            <p className="map-note">Marker positions are approximate and refer to resource Regions, not source-IP geography.</p>
          </div>

          <aside aria-label="Region counts" className="region-summary">
            <div className="region-scope-grid">
              <div><span>Regional</span><strong>{analytics.by_scope.region}</strong></div>
              <div><span>Global</span><strong>{analytics.by_scope.global}</strong></div>
              <div><span>Unknown</span><strong>{analytics.by_scope.unknown}</strong></div>
            </div>
            <h3>Regional findings</h3>
            {analytics.by_region.length ? (
              <ul className="region-count-list">
                {analytics.by_region.map((item) => (
                  <li key={item.region}>
                    <span>{item.region}</span>
                    <strong>{item.count}</strong>
                    {!REGION_POSITIONS[item.region] ? <small>List only</small> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="region-list-empty">No regional resources in this filtered set.</p>
            )}
          </aside>
        </div>
      ) : null}
    </section>
  );
}
