import type { FindingSeverity, FindingStatus } from "./types";

export const statusLabels: Record<FindingStatus, string> = {
  new: "New",
  investigating: "Investigating",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export const severityLabels: Record<FindingSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  informational: "Info",
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

export function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

export const allowedTransitions: Record<FindingStatus, FindingStatus[]> = {
  new: ["investigating", "dismissed"],
  investigating: ["resolved", "dismissed"],
  resolved: ["investigating"],
  dismissed: ["investigating"],
};
