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
