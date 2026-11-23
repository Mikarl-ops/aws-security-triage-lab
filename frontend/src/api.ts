import type {
  AuditEvent,
  Finding,
  FindingAnalytics,
  FindingListItem,
  FindingNote,
  FindingRegionAnalytics,
  FindingSeverity,
  FindingStatus,
  FindingSummary,
  PageResponse,
  ProviderEvent,
  ProviderStatusFilter,
  SessionUser,
} from "./types";

export interface FindingFilters {
  page: number;
  page_size: number;
  status?: FindingStatus;
  severity?: FindingSeverity;
  source?: string;
  provider_status?: ProviderStatusFilter;
}

export type AnalyticsFilters = Pick<FindingFilters, "status" | "severity" | "source" | "provider_status">;

interface ApiProblem {
  title?: string;
  detail?: string;
  request_id?: string;
  errors?: Array<{ field?: string; code?: string }>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly requestId: string | null;
  readonly fields: ApiProblem["errors"];

  constructor(status: number, problem: ApiProblem) {
    super(problem.detail || problem.title || "The request could not be completed.");
    this.name = "ApiError";
    this.status = status;
    this.requestId = problem.request_id ?? null;
    this.fields = problem.errors;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json, application/problem+json");

  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: "same-origin",
    headers,
  });

  if (response.status === 204) return undefined as T;

  const responseText = await response.text();
  let body: unknown;
  if (responseText) {
    try {
      body = JSON.parse(responseText);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const problem = body && typeof body === "object" ? (body as ApiProblem) : {};
    throw new ApiError(response.status, problem);
  }

  return body as T;
}

async function csrfRequest<T>(path: string, method: "POST" | "PATCH", body?: unknown) {
  const { csrf_token } = await request<{ csrf_token: string }>("/auth/csrf");
  const headers = new Headers({ "X-CSRFToken": csrf_token });
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);
  if (serializedBody !== undefined) headers.set("Content-Type", "application/json");
  return request<T>(path, { method, headers, body: serializedBody });
}

export const api = {
  async getSession() {
    const response = await request<{ user: SessionUser }>("/auth/session");
    return response.user;
  },

  async login(username: string, password: string) {
    const response = await csrfRequest<{ user: SessionUser }>("/auth/login", "POST", {
      username,
      password,
    });
    return response.user;
  },

  logout() {
    return csrfRequest<void>("/auth/logout", "POST");
  },

  getSummary() {
    return request<FindingSummary>("/findings/summary");
  },

  getAnalytics(filters: AnalyticsFilters) {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.severity) params.set("severity", filters.severity);
    if (filters.source) params.set("source", filters.source);
    if (filters.provider_status) params.set("provider_status", filters.provider_status);
    const queryString = params.toString();
    const query = queryString ? `?${queryString}` : "";
    return request<FindingAnalytics>(`/findings/analytics${query}`);
  },

  getRegionAnalytics(filters: AnalyticsFilters) {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.severity) params.set("severity", filters.severity);
    if (filters.source) params.set("source", filters.source);
    if (filters.provider_status) params.set("provider_status", filters.provider_status);
    const queryString = params.toString();
    const query = queryString ? `?${queryString}` : "";
    return request<FindingRegionAnalytics>(`/findings/region-analytics${query}`);
  },

  listFindings(filters: FindingFilters) {
    const params = new URLSearchParams({
      page: String(filters.page),
      page_size: String(filters.page_size),
    });
    if (filters.status) params.set("status", filters.status);
    if (filters.severity) params.set("severity", filters.severity);
    if (filters.source) params.set("source", filters.source);
    if (filters.provider_status) params.set("provider_status", filters.provider_status);
    return request<PageResponse<FindingListItem>>(`/findings?${params.toString()}`);
  },

  getFinding(findingId: string) {
    return request<Finding>(`/findings/${encodeURIComponent(findingId)}`);
  },

  listNotes(findingId: string, page = 1) {
    const params = new URLSearchParams({ page: String(page), page_size: "25" });
    return request<PageResponse<FindingNote>>(`/findings/${encodeURIComponent(findingId)}/notes?${params.toString()}`);
  },

  listHistory(findingId: string, page = 1) {
    const params = new URLSearchParams({ page: String(page), page_size: "25" });
    return request<PageResponse<AuditEvent>>(`/findings/${encodeURIComponent(findingId)}/history?${params.toString()}`);
  },

  listProviderHistory(findingId: string, page = 1) {
    const params = new URLSearchParams({ page: String(page), page_size: "25" });
    return request<PageResponse<ProviderEvent>>(
      `/findings/${encodeURIComponent(findingId)}/provider-history?${params.toString()}`,
    );
  },

  changeStatus(
    findingId: string,
    status: FindingStatus,
    expectedVersion: number,
    resolutionReason: string | null,
  ) {
    return csrfRequest<Finding>(`/findings/${encodeURIComponent(findingId)}`, "PATCH", {
      status,
      expected_version: expectedVersion,
      resolution_reason: resolutionReason,
    });
  },

  addNote(findingId: string, body: string, clientRequestId?: string) {
    return csrfRequest<FindingNote>(`/findings/${encodeURIComponent(findingId)}/notes`, "POST", {
      body,
      ...(clientRequestId === undefined ? {} : { client_request_id: clientRequestId }),
    });
  },
};
