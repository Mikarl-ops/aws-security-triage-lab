import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "./api";
import { AnalyticsCharts } from "./components/AnalyticsCharts";
import { AuthScreen } from "./components/AuthScreen";
import { FindingDetails } from "./components/FindingDetails";
import { FindingsTable, type FindingFiltersView } from "./components/FindingsTable";
import { RegionsMap } from "./components/RegionsMap";
import type {
  AuditEvent,
  Finding,
  FindingAnalytics,
  FindingListItem,
  FindingNote,
  FindingRegionAnalytics,
  FindingStatus,
  FindingSummary,
  SessionUser,
} from "./types";
import "./styles.css";

type AuthState = "checking" | "anonymous" | "authenticated" | "unavailable";

const emptySummary: FindingSummary = {
  total: 0,
  by_status: { new: 0, investigating: 0, resolved: 0, dismissed: 0 },
  by_severity: { critical: 0, high: 0, medium: 0, low: 0, informational: 0 },
};

function friendlyError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "The service could not be reached. Check that the local API is running and try again.";
}

function Icon({ name }: { name: "overview" | "findings" }) {
  const paths = {
    overview: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
      </>
    ),
    findings: (
      <>
        <path d="M12 3 20 6v5.2c0 5-3.4 8.5-8 10.3-4.6-1.8-8-5.3-8-10.3V6l8-3Z" />
        <path d="m8.5 12 2.2 2.2 4.8-5" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

export function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [summary, setSummary] = useState(emptySummary);
  const [analytics, setAnalytics] = useState<FindingAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [regionAnalytics, setRegionAnalytics] = useState<FindingRegionAnalytics | null>(null);
  const [regionAnalyticsLoading, setRegionAnalyticsLoading] = useState(true);
  const [regionAnalyticsError, setRegionAnalyticsError] = useState<string | null>(null);
  const [findings, setFindings] = useState<FindingListItem[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<FindingFiltersView>({
    status: "all",
    severity: "all",
    source: "all",
  });
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [findingDetail, setFindingDetail] = useState<Finding | null>(null);
  const [notes, setNotes] = useState<FindingNote[]>([]);
  const [history, setHistory] = useState<AuditEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [detailReload, setDetailReload] = useState(0);

  const queryFilters = useMemo(
    () => ({
      page,
      page_size: 25,
      ...(filters.status === "all" ? {} : { status: filters.status }),
      ...(filters.severity === "all" ? {} : { severity: filters.severity }),
      ...(filters.source === "all" ? {} : { source: filters.source }),
    }),
    [filters, page],
  );

  const analyticsFilters = useMemo(
    () => ({
      ...(filters.status === "all" ? {} : { status: filters.status }),
      ...(filters.severity === "all" ? {} : { severity: filters.severity }),
      ...(filters.source === "all" ? {} : { source: filters.source }),
    }),
    [filters],
  );

  useEffect(() => {
    let active = true;
    api.getSession()
      .then((currentUser) => {
        if (!active) return;
        setUser(currentUser);
        setAuthState("authenticated");
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          setUser(null);
          setAuthState("anonymous");
        } else {
          setAuthError(friendlyError(error));
          setAuthState("unavailable");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (authState !== "authenticated" || !user) return;
    let active = true;
    Promise.all([api.getSummary(), api.listFindings(queryFilters)])
      .then(([newSummary, result]) => {
        if (!active) return;
        setSummary(newSummary);
        setFindings(result.items);
        setTotal(result.total);
        setPages(result.pages);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          setUser(null);
          setAuthState("anonymous");
          setAuthError("Your session has expired. Sign in again to continue.");
        } else {
          setDashboardError(friendlyError(error));
        }
      })
      .finally(() => {
        if (active) setDashboardLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authState, queryFilters, refreshToken, user]);

  useEffect(() => {
    if (authState !== "authenticated" || !user) return;
    let active = true;
    api.getAnalytics(analyticsFilters)
      .then((result) => {
        if (active) setAnalytics(result);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          setUser(null);
          setAuthState("anonymous");
          setAuthError("Your session has expired. Sign in again to continue.");
        } else {
          setAnalyticsError(friendlyError(error));
        }
      })
      .finally(() => {
        if (active) setAnalyticsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [analyticsFilters, authState, refreshToken, user]);

  useEffect(() => {
    if (authState !== "authenticated" || !user) return;
    let active = true;
    api.getRegionAnalytics(analyticsFilters)
      .then((result) => {
        if (active) setRegionAnalytics(result);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          setUser(null);
          setAuthState("anonymous");
          setAuthError("Your session has expired. Sign in again to continue.");
        } else {
          setRegionAnalyticsError(friendlyError(error));
        }
      })
      .finally(() => {
        if (active) setRegionAnalyticsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [analyticsFilters, authState, refreshToken, user]);

  useEffect(() => {
    if (!selectedId || authState !== "authenticated") return;
    let active = true;
    Promise.all([api.getFinding(selectedId), api.listNotes(selectedId), api.listHistory(selectedId)])
      .then(([finding, notePage, historyPage]) => {
        if (!active) return;
        setFindingDetail(finding);
        setNotes(notePage.items);
        setHistory(historyPage.items);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          setUser(null);
          setAuthState("anonymous");
          setSelectedId(null);
          setAuthError("Your session has expired. Sign in again to continue.");
        } else {
          setDetailError(friendlyError(error));
        }
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authState, detailReload, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedId]);

  function prepareAnalyticsRefresh() {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    setRegionAnalyticsLoading(true);
    setRegionAnalyticsError(null);
  }

  async function retrySession() {
    prepareAnalyticsRefresh();
    setAuthState("checking");
    setAuthError(null);
    try {
      const currentUser = await api.getSession();
      setUser(currentUser);
      setAuthState("authenticated");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setAuthState("anonymous");
      } else {
        setAuthError(friendlyError(error));
        setAuthState("unavailable");
      }
    }
  }

  async function handleLogin(username: string, password: string) {
    prepareAnalyticsRefresh();
    setLoginBusy(true);
    setAuthError(null);
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const authenticatedUser = await api.login(username, password);
      setUser(authenticatedUser);
      setAuthState("authenticated");
      return true;
    } catch (error) {
      setAuthError(friendlyError(error));
      return false;
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    setDashboardError(null);
    try {
      await api.logout();
      setUser(null);
      setSelectedId(null);
      setAuthError(null);
      setAuthState("anonymous");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setAuthState("anonymous");
        setAuthError("Your session has expired. Sign in again to continue.");
      } else {
        setDashboardError(friendlyError(error));
      }
    }
  }

  function handleFilterChange(nextFilters: FindingFiltersView) {
    prepareAnalyticsRefresh();
    setDashboardLoading(true);
    setDashboardError(null);
    setFilters(nextFilters);
    setPage(1);
  }

  function handlePageChange(nextPage: number) {
    setDashboardLoading(true);
    setDashboardError(null);
    setPage(nextPage);
  }

  function openFinding(findingId: string) {
    setFindingDetail(null);
    setNotes([]);
    setHistory([]);
    setDetailError(null);
    setMutationError(null);
    setDetailLoading(true);
    setSelectedId(findingId);
  }

  function closeFinding() {
    setSelectedId(null);
    setFindingDetail(null);
    setMutationError(null);
  }

  async function handleStatusChange(status: FindingStatus, reason: string | null) {
    if (!findingDetail) return false;
    setMutationBusy(true);
    setMutationError(null);
    setDashboardLoading(true);
    try {
      const updated = await api.changeStatus(findingDetail.id, status, findingDetail.version, reason);
      setFindingDetail(updated);
      setDetailLoading(true);
      setDetailError(null);
      prepareAnalyticsRefresh();
      setRefreshToken((token) => token + 1);
      setDetailReload((revision) => revision + 1);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setAuthState("anonymous");
        setSelectedId(null);
        setAuthError("Your session has expired. Sign in again to continue.");
      } else {
        setMutationError(friendlyError(error));
        if (error instanceof ApiError && error.status === 409) {
          setDetailLoading(true);
          setDetailError(null);
          setDetailReload((revision) => revision + 1);
        }
      }
      return false;
    } finally {
      setMutationBusy(false);
    }
  }

  async function handleAddNote(body: string) {
    if (!findingDetail) return false;
    setMutationBusy(true);
    setMutationError(null);
    setDashboardLoading(true);
    try {
      await api.addNote(findingDetail.id, body);
      setDetailLoading(true);
      setDetailError(null);
      setDetailReload((revision) => revision + 1);
      prepareAnalyticsRefresh();
      setRefreshToken((token) => token + 1);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setAuthState("anonymous");
        setSelectedId(null);
        setAuthError("Your session has expired. Sign in again to continue.");
      } else {
        setMutationError(friendlyError(error));
      }
      return false;
    } finally {
      setMutationBusy(false);
    }
  }

  if (authState === "checking") {
    return <main aria-live="polite" className="auth-screen"><p className="loading-details">Checking your session…</p></main>;
  }

  if (authState === "unavailable") {
    return (
      <main className="auth-screen">
        <section aria-labelledby="service-title" className="auth-card service-card">
          <span className="brand-mark">S</span>
          <h1 id="service-title">Tracker API unavailable</h1>
          <p>{authError}</p>
          <button className="primary-button login-button" onClick={() => void retrySession()} type="button">Try again</button>
        </section>
      </main>
    );
  }

  if (authState === "anonymous" || !user) {
    return <AuthScreen busy={loginBusy} error={authError} onLogin={handleLogin} />;
  }

  const sources = Array.from(
    new Set([...findings.map((finding) => finding.source), ...(filters.source === "all" ? [] : [filters.source])]),
  ).sort();
  const userInitials = user.username.slice(0, 2).toUpperCase();
  const connectionState = dashboardError ? "error" : dashboardLoading ? "loading" : "ready";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a aria-label="AWS Security Triage Lab home" className="brand" href="#overview">
          <span className="brand-mark"><Icon name="findings" /></span>
          <span className="brand-name">
            <strong>Triage Lab</strong>
            <small>AWS SECURITY</small>
          </span>
        </a>

        <div className="workspace-switcher">
          <span className="workspace-icon" aria-hidden="true">01</span>
          <span>
            <strong>Lab workspace</strong>
            <small>Local preview</small>
          </span>
        </div>

        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Primary navigation" className="primary-nav">
          <a className="nav-item" href="#overview">
            <Icon name="overview" />
            Overview
          </a>
          <a aria-current="page" className="nav-item active" href="#findings">
            <Icon name="findings" />
            Findings
            <span className="nav-count">{summary.total}</span>
          </a>
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <span className="note-shield"><Icon name="findings" /></span>
          <strong>Preview dataset</strong>
          <p>Practice the investigation workflow with synthetic findings.</p>
        </div>
        <div className="sidebar-footer">
          <span className="environment-dot" />
          Local environment
        </div>
      </aside>

      <main className="main-area" id="overview">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span className="breadcrumb-separator">/</span>
            <strong>Findings</strong>
          </div>
          <div className="topbar-right">
            <span className="sample-badge"><span /> Synthetic data</span>
            <span aria-hidden="true" className="topbar-divider" />
            <div className="user-chip">
              <span className="user-avatar">{userInitials}</span>
              <span className="user-copy">
                <strong>{user.username}</strong>
                <small>{user.role === "analyst" ? "Analyst" : "Read-only viewer"}</small>
              </span>
              <button className="logout-button" onClick={() => void handleLogout()} type="button">Sign out</button>
            </div>
          </div>
        </header>

        <div className="page-content" id="findings">
          <div className="page-heading">
            <div className="hero-copy">
              <p className="eyebrow">AWS SECURITY TRIAGE LAB</p>
              <h1>Findings overview</h1>
              <p className="page-subtitle">Prioritize cloud findings and follow each investigation from signal to decision.</p>
              <div aria-live="polite" className="updated-indicator" data-state={connectionState}>
                <span className="pulse-dot" />
                {connectionState === "error" ? "Findings unavailable" : connectionState === "loading" ? "Loading findings" : "API connected"}
              </div>
            </div>
            <svg aria-hidden="true" className="hero-graphic" viewBox="0 0 370 218" fill="none">
              <g className="orbit-lines">
                <path d="M52 109h266M185 8v202M106 30l158 158M106 188 264 30" />
                <circle cx="185" cy="109" r="42" />
                <circle cx="185" cy="109" r="66" />
                <circle cx="185" cy="109" r="91" strokeDasharray="3 5" />
                <ellipse cx="185" cy="109" rx="133" ry="36" transform="rotate(-18 185 109)" />
              </g>
              <path className="orbit-emblem" d="m185 83 21 12v24l-21 12-21-12V95l21-12Z M175 108l7 7 13-14" />
              <circle className="orbit-node" cx="249" cy="92" r="4" />
              <circle className="orbit-node violet" cx="119" cy="109" r="3" />
              <circle className="orbit-node violet" cx="185" cy="18" r="3" />
              <circle className="orbit-node" cx="157" cy="169" r="3" />
            </svg>
          </div>

          <section aria-label="Finding summary" className="summary-grid">
            <article className="summary-card total-card">
              <div className="summary-topline">
                <span className="summary-label">Total findings</span>
                <span className="summary-icon icon-violet"><Icon name="overview" /></span>
              </div>
              <strong className="summary-value">{dashboardLoading && summary.total === 0 ? "—" : summary.total}</strong>
              <span className="summary-footnote">Across synthetic sources</span>
            </article>
            <article className="summary-card critical-card">
              <div className="summary-topline">
                <span className="summary-label">Critical priority</span>
                <span className="summary-icon icon-red"><span className="summary-alert">!</span></span>
              </div>
              <strong className="summary-value">{summary.by_severity.critical}</strong>
              <span className="summary-footnote">Needs immediate review</span>
            </article>
            <article className="summary-card investigating-card">
              <div className="summary-topline">
                <span className="summary-label">Investigating</span>
                <span className="summary-icon icon-amber"><span className="summary-ring" /></span>
              </div>
              <strong className="summary-value">{summary.by_status.investigating}</strong>
              <span className="summary-footnote">Active analyst reviews</span>
            </article>
            <article className="summary-card resolved-card">
              <div className="summary-topline">
                <span className="summary-label">Resolved findings</span>
                <span className="summary-icon icon-green"><span className="summary-check">✓</span></span>
              </div>
              <strong className="summary-value">{summary.by_status.resolved}</strong>
              <span className="summary-footnote">Closed with a recorded reason</span>
            </article>
          </section>

          <AnalyticsCharts analytics={analytics} error={analyticsError} loading={analyticsLoading} />
          <RegionsMap
            analytics={regionAnalytics}
            error={regionAnalyticsError}
            loading={regionAnalyticsLoading}
          />

          <FindingsTable
            error={dashboardError}
            filters={filters}
            findings={findings}
            loading={dashboardLoading}
            onFiltersChange={handleFilterChange}
            onOpen={openFinding}
            onPageChange={handlePageChange}
            onRetry={() => {
              prepareAnalyticsRefresh();
              setDashboardLoading(true);
              setDashboardError(null);
              setRefreshToken((token) => token + 1);
            }}
            page={page}
            pageSize={queryFilters.page_size}
            pages={pages}
            sources={sources}
            total={total}
          />

          <footer className="page-footer">
            <span>AWS Security Triage Lab</span>
            <span>Local development · Synthetic events only</span>
          </footer>
        </div>
      </main>

      {selectedId && (
        <FindingDetails
          key={`${selectedId}-${findingDetail?.version ?? "loading"}`}
          busy={mutationBusy}
          canUpdate={user.role === "analyst"}
          error={mutationError ?? detailError}
          finding={findingDetail}
          history={history}
          loading={detailLoading}
          notes={notes}
          onAddNote={handleAddNote}
          onChangeStatus={handleStatusChange}
          onClose={closeFinding}
          onRetry={() => {
            setMutationError(null);
            setDetailLoading(true);
            setDetailError(null);
            setDetailReload((revision) => revision + 1);
          }}
        />
      )}
    </div>
  );
}
