export type FindingStatus = "new" | "investigating" | "resolved" | "dismissed";

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "informational";

export interface Finding {
  id: string;
  title: string;
  source: string;
  severity: FindingSeverity;
  status: FindingStatus;
  observed_at: string;
  updated_at: string;
  version: number;
  description: string;
  source_event_id: string | null;
  evidence_summary: string;
  metadata: Record<string, string | number | boolean>;
  resolution_reason: string | null;
  created_at: string;
}

export type FindingListItem = Pick<
  Finding,
  "id" | "title" | "source" | "severity" | "status" | "observed_at" | "updated_at" | "version"
>;

export interface PageResponse<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  pages: number;
}

export interface FindingSummary {
  total: number;
  by_status: Record<FindingStatus, number>;
  by_severity: Record<FindingSeverity, number>;
}

export interface FindingNote {
  id: string;
  author: string;
  body: string;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  actor: string;
  event_type: "finding.status_changed" | "finding.note_added";
  occurred_at: string;
  details: Record<string, string | number | boolean | null>;
  request_id: string | null;
}

export interface SessionUser {
  id: string;
  username: string;
  role: "analyst" | "viewer";
}
