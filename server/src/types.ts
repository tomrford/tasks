export type TaskStatus = "open" | "waiting" | "blocked" | "done";

export const VALID_STATUSES: readonly TaskStatus[] = ["open", "waiting", "blocked", "done"];

export const DEFAULT_TTL_DAYS = 7;
export const MAX_TTL_DAYS = 30;
export const MAX_MESSAGE_BYTES = 64 * 1024; // 64 KiB
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MiB
export const DEVICE_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const LONG_POLL_MAX_SECONDS = 25;
export const MAX_WS_LIFETIME_MS = 75 * 60 * 1000; // 75 minutes

export interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  ROOMS: DurableObjectNamespace;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ALLOW_UNAUTHENTICATED_UI?: string;
}

export interface Machine {
  id: string;
  name: string;
  approved_by: string | null;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

export interface AttachmentRecord {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  sender: string;
  created_at: number;
}

export interface MessageRecord {
  seq: number;
  sender: string;
  body: string;
  status?: TaskStatus | null;
  attachments: AttachmentRecord[];
  created_at: number;
}

export interface RoomSnapshot {
  uid: string;
  title: string;
  status: TaskStatus;
  created_by: string;
  created_at: number;
  updated_at: number;
  expires_at: number;
  ttl_ms: number;
  rev: number;
  last_seq: number;
  messages: MessageRecord[];
  attachments: AttachmentRecord[];
}

export interface WaitEventPayload {
  type: "events" | "closed";
  changed: boolean;
  purged?: boolean;
  status: TaskStatus;
  last_seq: number;
  messages: MessageRecord[];
}

export interface AppVariables {
  machine: Machine;
  uiUser: string;
}

export function isValidStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (VALID_STATUSES as readonly string[]).includes(value);
}

export function formatSender(machineName: string, asLabel?: string | null): string {
  const clean = asLabel?.trim().replace(/[^a-zA-Z0-9._-]/g, "");
  if (!clean) return machineName;
  return `${machineName}/${clean}`;
}

export function matchesMention(msg: Pick<MessageRecord, "body" | "status">, mention: string): boolean {
  const target = mention.trim().replace(/^@/, "");
  if (!target) return true;
  if (msg.status === "done") return true;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Matches `@target` or `@machine/target` at word boundaries
  const re = new RegExp(
    `(?:^|[^a-zA-Z0-9_.-])@(?:[a-zA-Z0-9._-]+/)?${escaped}(?:$|[^a-zA-Z0-9_.-])`,
    "i",
  );
  return re.test(msg.body);
}
