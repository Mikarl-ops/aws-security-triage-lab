import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API client", () => {
  it.each(["ARCHIVED", "none"] as const)("sends provider_status=%s to the queue and both analytics endpoints", async (providerStatus) => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(jsonResponse({}));
    await api.listFindings({ page: 2, page_size: 25, status: "new", provider_status: providerStatus });
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/v1/findings?page=2&page_size=25&status=new&provider_status=${providerStatus}`,
      expect.objectContaining({ credentials: "same-origin" }),
    );
    await api.getAnalytics({ status: "new", provider_status: providerStatus });
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/v1/findings/analytics?status=new&provider_status=${providerStatus}`,
      expect.objectContaining({ credentials: "same-origin" }),
    );
    await api.getRegionAnalytics({ status: "new", provider_status: providerStatus });
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/v1/findings/region-analytics?status=new&provider_status=${providerStatus}`,
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it.each([undefined, "e2772124-423e-4416-aa08-aa063f710001"])("sends a note with optional retry key %s and a fresh CSRF token", async (clientRequestId) => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ csrf_token: "synthetic-note-token" }))
      .mockResolvedValueOnce(jsonResponse({ id: "synthetic-note", body: "Synthetic note." }, 201));
    await api.addNote("synthetic/finding", "Synthetic note.", clientRequestId);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/auth/csrf");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/v1/findings/synthetic%2Ffinding/notes");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("same-origin");
    expect(new Headers(init?.headers).get("X-CSRFToken")).toBe("synthetic-note-token");
    expect(JSON.parse(String(init?.body))).toEqual(clientRequestId === undefined
      ? { body: "Synthetic note." }
      : { body: "Synthetic note.", client_request_id: clientRequestId });
  });

  it.each(["listNotes", "listHistory"] as const)("reads bounded %s pages with same-origin credentials", async (method) => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(jsonResponse({ items: [], page: 2, page_size: 25, total: 0, pages: 1 }));
    await api[method]("synthetic/finding", 2);
    const endpoint = method === "listNotes" ? "notes" : "history";
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/v1/findings/synthetic%2Ffinding/${endpoint}?page=2&page_size=25`,
      expect.objectContaining({ credentials: "same-origin" }),
    );
    await api[method]("synthetic/finding");
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/v1/findings/synthetic%2Ffinding/${endpoint}?page=1&page_size=25`,
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("reads provider-history pages with same-origin credentials", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [], page: 2, page_size: 25, total: 0, pages: 1 }));
    await api.listProviderHistory("synthetic/finding", 2);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/findings/synthetic%2Ffinding/provider-history?page=2&page_size=25",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("uses same-origin cookies and server-side filters for findings", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [], page: 2, page_size: 25, total: 0, pages: 0 }),
    );

    await api.listFindings({ page: 2, page_size: 25, status: "new", severity: "high", source: "config" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/findings?page=2&page_size=25&status=new&severity=high&source=config",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("bootstraps a CSRF token before login and sends credentials only in JSON", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrf_token: "csrf-sample-token" }))
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "user-demo", username: "analyst.demo", role: "analyst" },
        }),
      );

    await api.login("analyst.demo", "synthetic-password");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/auth/csrf");
    const [loginUrl, loginInit] = fetchMock.mock.calls[1];
    expect(loginUrl).toBe("/api/v1/auth/login");
    expect(loginInit?.credentials).toBe("same-origin");
    expect(loginInit?.method).toBe("POST");
    expect(new Headers(loginInit?.headers).get("X-CSRFToken")).toBe("csrf-sample-token");
    expect(loginInit?.body).toBe(JSON.stringify({ username: "analyst.demo", password: "synthetic-password" }));
  });

  it("fetches a fresh CSRF token for analyst status changes", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrf_token: "csrf-write-token" }))
      .mockResolvedValueOnce(jsonResponse({ id: "finding-demo", status: "resolved" }));

    await api.changeStatus("finding-demo", "resolved", 3, "Synthetic investigation complete.");

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/v1/findings/finding-demo");
    expect(init?.method).toBe("PATCH");
    expect(new Headers(init?.headers).get("X-CSRFToken")).toBe("csrf-write-token");
    expect(JSON.parse(String(init?.body))).toEqual({
      status: "resolved",
      expected_version: 3,
      resolution_reason: "Synthetic investigation complete.",
    });
  });
});
