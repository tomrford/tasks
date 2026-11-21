import { DurableObject } from "cloudflare:workers";
import {
  DEFAULT_TTL_DAYS,
  LONG_POLL_MAX_SECONDS,
  MAX_MESSAGE_BYTES,
  MAX_TTL_DAYS,
  MAX_WS_LIFETIME_MS,
  isValidStatus,
  matchesMention,
  type AttachmentRecord,
  type Env,
  type MessageRecord,
  type RoomSnapshot,
  type TaskStatus,
  type WaitEventPayload,
} from "./types";

interface RoomMetaRow {
  uid: string;
  title: string;
  status: TaskStatus;
  created_by: string;
  created_at: number;
  updated_at: number;
  ttl_ms: number;
  expires_at: number;
  rev: number;
  deleting: number;
}

interface RawMessageRow {
  seq: number;
  sender: string;
  body: string;
  status: string | null;
  attachment_ids: string;
  created_at: number;
}

interface WsAttachment {
  since: number;
  mention: string;
  machineId: string | null;
  connectedAt: number;
  signalOnly: boolean;
}

interface PollWaiter {
  since: number;
  mention: string;
  machineId: string | null;
  resolve: (result: { status: number; payload: WaitEventPayload | { error: string } }) => void;
  timer: ReturnType<typeof setTimeout>;
}

const WS_CLOSE_REVOKED = 4001;
const WS_CLOSE_EXPIRED = 4002;

export class TaskRoom extends DurableObject<Env> {
  private pollWaiters = new Set<PollWaiter>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private hasMetaTable(): boolean {
    const rows = this.ctx.storage.sql
      .exec("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'meta' LIMIT 1")
      .toArray();
    return rows.length > 0;
  }

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        uid TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        ttl_ms INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        rev INTEGER NOT NULL DEFAULT 1,
        deleting INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT,
        attachment_ids TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        sender TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  private getMeta(): RoomMetaRow | null {
    if (!this.hasMetaTable()) return null;
    const rows = this.ctx.storage.sql
      .exec(
        "SELECT uid, title, status, created_by, created_at, updated_at, ttl_ms, expires_at, rev, deleting FROM meta WHERE id = 1",
      )
      .toArray();
    if (rows.length === 0) return null;
    const r = rows[0] as Record<string, unknown>;
    return {
      uid: String(r.uid),
      title: String(r.title),
      status: String(r.status) as TaskStatus,
      created_by: String(r.created_by),
      created_at: Number(r.created_at),
      updated_at: Number(r.updated_at),
      ttl_ms: Number(r.ttl_ms),
      expires_at: Number(r.expires_at),
      rev: Number(r.rev ?? 1),
      deleting: Number(r.deleting ?? 0),
    };
  }

  private getLastSeq(): number {
    const rows = this.ctx.storage.sql
      .exec("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM messages")
      .toArray();
    return Number((rows[0] as Record<string, unknown> | undefined)?.max_seq ?? 0);
  }

  private getMessageCount(): number {
    const rows = this.ctx.storage.sql
      .exec("SELECT COUNT(*) AS cnt FROM messages")
      .toArray();
    return Number((rows[0] as Record<string, unknown> | undefined)?.cnt ?? 0);
  }

  private listAttachments(): AttachmentRecord[] {
    const rows = this.ctx.storage.sql
      .exec(
        "SELECT id, filename, content_type, size_bytes, sha256, sender, created_at FROM attachments ORDER BY created_at ASC",
      )
      .toArray();
    return rows.map((r) => this.mapAttachment(r as Record<string, unknown>));
  }

  private getAttachment(id: string): AttachmentRecord | null {
    const rows = this.ctx.storage.sql
      .exec(
        "SELECT id, filename, content_type, size_bytes, sha256, sender, created_at FROM attachments WHERE id = ?",
        id,
      )
      .toArray();
    if (rows.length === 0) return null;
    return this.mapAttachment(rows[0] as Record<string, unknown>);
  }

  private mapAttachment(r: Record<string, unknown>): AttachmentRecord {
    return {
      id: String(r.id),
      filename: String(r.filename),
      content_type: String(r.content_type),
      size_bytes: Number(r.size_bytes),
      sha256: String(r.sha256),
      sender: String(r.sender),
      created_at: Number(r.created_at),
    };
  }

  private listMessagesSince(since: number, mention = ""): MessageRecord[] {
    const attachmentMap = new Map<string, AttachmentRecord>();
    for (const att of this.listAttachments()) {
      attachmentMap.set(att.id, att);
    }

    const rows = this.ctx.storage.sql
      .exec(
        "SELECT seq, sender, body, status, attachment_ids, created_at FROM messages WHERE seq > ? ORDER BY seq ASC",
        since,
      )
      .toArray();

    const result: MessageRecord[] = [];
    for (const raw of rows) {
      const row = raw as unknown as RawMessageRow;
      let ids: string[] = [];
      try {
        const parsed = JSON.parse(String(row.attachment_ids));
        if (Array.isArray(parsed)) {
          ids = parsed.map(String);
        }
      } catch {
        ids = [];
      }
      const attachments = ids
        .map((id) => attachmentMap.get(id))
        .filter((a): a is AttachmentRecord => a !== undefined);

      const msg: MessageRecord = {
        seq: Number(row.seq),
        sender: String(row.sender),
        body: String(row.body),
        status: row.status ? (String(row.status) as TaskStatus) : null,
        attachments,
        created_at: Number(row.created_at),
      };
      if (!mention || matchesMention(msg, mention)) {
        result.push(msg);
      }
    }
    return result;
  }

  private async touchAndBumpRev(meta: RoomMetaRow, now: number): Promise<{ expiresAt: number; rev: number }> {
    const expiresAt = now + meta.ttl_ms;
    const nextRev = meta.rev + 1;
    this.ctx.storage.sql.exec(
      "UPDATE meta SET updated_at = ?, expires_at = ?, rev = ? WHERE id = 1",
      now,
      expiresAt,
      nextRev,
    );
    await this.ctx.storage.setAlarm(expiresAt);
    return { expiresAt, rev: nextRev };
  }

  /**
   * Returns the subset of machine IDs that are still active (not revoked) in D1.
   */
  private async getActiveMachineIds(machineIds: string[]): Promise<Set<string> | null> {
    const unique = Array.from(new Set(machineIds.filter(Boolean)));
    const active = new Set<string>();
    if (unique.length === 0) return active;

    try {
      const placeholders = unique.map(() => "?").join(", ");
      const res = await this.env.DB.prepare(
        `SELECT id FROM machines WHERE id IN (${placeholders}) AND revoked_at IS NULL`,
      )
        .bind(...unique)
        .all<{ id: string }>();

      for (const row of res.results ?? []) {
        active.add(row.id);
      }
      return active;
    } catch (err) {
      console.error("D1 revocation lookup failed:", err);
      return null;
    }
  }

  private closeRevokedWebSocket(ws: WebSocket): void {
    try {
      ws.send(JSON.stringify({ type: "revoked", changed: false, status: "done", last_seq: 0, messages: [] }));
    } catch {
      // ignore
    }
    try {
      ws.close(WS_CLOSE_REVOKED, "machine revoked");
    } catch {
      // ignore
    }
  }

  private async notifyWaiters(status: TaskStatus, lastSeq: number): Promise<void> {
    // Snapshot current waiters BEFORE awaiting D1 so newly joined waiters aren't misclassified
    const sockets = this.ctx.getWebSockets();
    const pollers = Array.from(this.pollWaiters);
    if (sockets.length === 0 && pollers.length === 0) return;

    const now = Date.now();
    const machineIdsToCheck: string[] = [];

    for (const ws of sockets) {
      const att = ws.deserializeAttachment() as WsAttachment | null;
      if (att?.machineId) machineIdsToCheck.push(att.machineId);
    }
    for (const w of pollers) {
      if (w.machineId) machineIdsToCheck.push(w.machineId);
    }

    const activeMachines = await this.getActiveMachineIds(machineIdsToCheck);

    // Re-check room still exists after D1 await
    const meta = this.getMeta();
    if (!meta || meta.deleting) return;

    // 1. Notify snapshotted WebSockets only
    for (const ws of sockets) {
      const att = (ws.deserializeAttachment() as WsAttachment | null) ?? {
        since: 0,
        mention: "",
        machineId: null,
        connectedAt: 0,
        signalOnly: false,
      };

      if (att.machineId) {
        if (activeMachines === null) {
          // D1 transiently unavailable: fail closed by skipping delivery to machine sockets
          continue;
        }
        if (!activeMachines.has(att.machineId)) {
          this.closeRevokedWebSocket(ws);
          continue;
        }
      }

      if (att.connectedAt > 0 && now - att.connectedAt > MAX_WS_LIFETIME_MS) {
        try {
          ws.close(WS_CLOSE_EXPIRED, "session expired, reconnect");
        } catch {
          // ignore
        }
        continue;
      }

      if (att.signalOnly) {
        try {
          ws.send(JSON.stringify({ type: "changed", last_seq: lastSeq }));
          ws.serializeAttachment({ ...att, since: lastSeq } satisfies WsAttachment);
        } catch {
          try {
            ws.close(1011, "send failed");
          } catch {
            // ignore
          }
        }
        continue;
      }

      const msgs = this.listMessagesSince(att.since, att.mention);
      if (msgs.length > 0) {
        const payload: WaitEventPayload = {
          type: "events",
          changed: true,
          status,
          last_seq: lastSeq,
          messages: msgs,
        };
        try {
          ws.send(JSON.stringify(payload));
          ws.serializeAttachment({ ...att, since: lastSeq } satisfies WsAttachment);
        } catch {
          try {
            ws.close(1011, "send failed");
          } catch {
            // ignore
          }
        }
      }
    }

    // 2. Notify snapshotted HTTP long-poll waiters only
    for (const waiter of pollers) {
      if (!this.pollWaiters.has(waiter)) continue;
      if (waiter.machineId) {
        if (activeMachines === null) {
          continue;
        }
        if (!activeMachines.has(waiter.machineId)) {
          clearTimeout(waiter.timer);
          this.pollWaiters.delete(waiter);
          waiter.resolve({ status: 401, payload: { error: "invalid or revoked token" } });
          continue;
        }
      }
      const msgs = this.listMessagesSince(waiter.since, waiter.mention);
      if (msgs.length > 0) {
        clearTimeout(waiter.timer);
        this.pollWaiters.delete(waiter);
        waiter.resolve({
          status: 200,
          payload: {
            type: "events",
            changed: true,
            status,
            last_seq: lastSeq,
            messages: msgs,
          },
        });
      }
    }
  }

  private async notifyClosedPurged(lastSeq: number): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    const pollers = Array.from(this.pollWaiters);
    const machineIdsToCheck: string[] = [];
    for (const ws of sockets) {
      const att = ws.deserializeAttachment() as WsAttachment | null;
      if (att?.machineId) machineIdsToCheck.push(att.machineId);
    }
    for (const w of pollers) {
      if (w.machineId) machineIdsToCheck.push(w.machineId);
    }
    const activeMachines = await this.getActiveMachineIds(machineIdsToCheck);

    const payload: WaitEventPayload = {
      type: "closed",
      changed: true,
      purged: true,
      status: "done",
      last_seq: lastSeq,
      messages: [],
    };
    const serialized = JSON.stringify(payload);
    const signalSerialized = JSON.stringify({ type: "changed", purged: true });

    for (const ws of sockets) {
      const att = ws.deserializeAttachment() as WsAttachment | null;
      if (att?.machineId && (activeMachines === null || !activeMachines.has(att.machineId))) {
        this.closeRevokedWebSocket(ws);
        continue;
      }
      try {
        ws.send(att?.signalOnly ? signalSerialized : serialized);
        ws.close(1000, "room purged");
      } catch {
        // ignore
      }
    }

    for (const waiter of pollers) {
      if (!this.pollWaiters.has(waiter)) continue;
      clearTimeout(waiter.timer);
      this.pollWaiters.delete(waiter);
      if (waiter.machineId && (activeMachines === null || !activeMachines.has(waiter.machineId))) {
        waiter.resolve({ status: 401, payload: { error: "invalid or revoked token" } });
        continue;
      }
      waiter.resolve({ status: 200, payload });
    }
  }

  private async purgeRoomStorage(uid: string): Promise<void> {
    const lastSeq = this.hasMetaTable() ? this.getLastSeq() : 0;

    // 1. Delete all R2 objects under rooms/<uid>/
    const prefix = `rooms/${uid}/`;
    let cursor: string | undefined;
    do {
      const listed = await this.env.ATTACHMENTS.list({ prefix, cursor });
      if (listed.objects.length > 0) {
        await this.env.ATTACHMENTS.delete(listed.objects.map((o) => o.key));
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    // 2. Remove from D1 index
    await this.env.DB.prepare("DELETE FROM rooms_index WHERE uid = ?").bind(uid).run();

    // 3. Notify active waiters only once cleanup succeeded
    await this.notifyClosedPurged(lastSeq);

    // 4. Wipe DO storage and cancel alarms
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm(): Promise<void> {
    const meta = this.getMeta();
    if (!meta) {
      await this.ctx.storage.deleteAll();
      return;
    }
    const now = Date.now();
    if (!meta.deleting && now < meta.expires_at - 1000) {
      await this.ctx.storage.setAlarm(meta.expires_at);
      return;
    }
    if (!meta.deleting) {
      this.ctx.storage.sql.exec("UPDATE meta SET deleting = 1 WHERE id = 1");
    }
    try {
      await this.purgeRoomStorage(meta.uid);
    } catch (err) {
      // Retry cleanup in 60s if R2/D1 had a transient failure
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
      throw err;
    }
  }

  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {
    // "ping" -> "pong" is handled without waking the DO via setWebSocketAutoResponse.
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // ignore
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "POST" && path === "/init") {
      return this.handleInit(request);
    }

    // Do NOT create SQLite tables for unknown/non-existent UIDs
    const meta = this.getMeta();
    if (!meta || meta.deleting) {
      return Response.json({ error: "task room not found" }, { status: 404 });
    }

    if (request.method === "GET" && path === "/snapshot") {
      const since = Math.max(0, Number.parseInt(url.searchParams.get("since") ?? "0", 10) || 0);
      const snapshot: RoomSnapshot = {
        uid: meta.uid,
        title: meta.title,
        status: meta.status,
        created_by: meta.created_by,
        created_at: meta.created_at,
        updated_at: meta.updated_at,
        expires_at: meta.expires_at,
        ttl_ms: meta.ttl_ms,
        rev: meta.rev,
        last_seq: this.getLastSeq(),
        messages: this.listMessagesSince(since),
        attachments: this.listAttachments(),
      };
      return Response.json(snapshot);
    }

    if (request.method === "POST" && path === "/messages") {
      return this.handlePostMessage(request);
    }

    if (request.method === "POST" && path === "/attachments") {
      return this.handleRegisterAttachment(request);
    }

    if (request.method === "GET" && path.startsWith("/attachments/")) {
      const id = decodeURIComponent(path.slice("/attachments/".length));
      const att = this.getAttachment(id);
      if (!att) {
        return Response.json({ error: "attachment not found" }, { status: 404 });
      }
      return Response.json(att);
    }

    if (request.method === "GET" && path === "/wait") {
      return this.handleWait(request, url, meta);
    }

    if (request.method === "POST" && path === "/close") {
      return this.handleClose(request);
    }

    return Response.json({ error: "not found" }, { status: 404 });
  }

  private async handleInit(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      uid: string;
      title?: string;
      note?: string;
      created_by: string;
      ttl_days?: number;
    };

    if (this.getMeta()) {
      return Response.json({ error: "room already exists" }, { status: 409 });
    }

    const note = (body.note ?? "").trim();
    if (new TextEncoder().encode(note).byteLength > MAX_MESSAGE_BYTES) {
      return Response.json(
        { error: `note exceeds max size of ${MAX_MESSAGE_BYTES} bytes (use --file for larger payloads)` },
        { status: 413 },
      );
    }

    this.ensureSchema();

    const now = Date.now();
    const ttlDays = Math.min(
      MAX_TTL_DAYS,
      Math.max(1, Number(body.ttl_days) || DEFAULT_TTL_DAYS),
    );
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
    const expiresAt = now + ttlMs;
    const title = (body.title ?? "").trim().slice(0, 200);

    this.ctx.storage.sql.exec(
      `INSERT INTO meta (id, uid, title, status, created_by, created_at, updated_at, ttl_ms, expires_at, rev, deleting)
       VALUES (1, ?, ?, 'open', ?, ?, ?, ?, ?, 1, 0)`,
      body.uid,
      title,
      body.created_by,
      now,
      now,
      ttlMs,
      expiresAt,
    );

    if (note) {
      this.ctx.storage.sql.exec(
        `INSERT INTO messages (sender, body, status, attachment_ids, created_at)
         VALUES (?, ?, NULL, '[]', ?)`,
        body.created_by,
        note,
        now,
      );
    }

    await this.ctx.storage.setAlarm(expiresAt);

    const snapshot: RoomSnapshot = {
      uid: body.uid,
      title,
      status: "open",
      created_by: body.created_by,
      created_at: now,
      updated_at: now,
      expires_at: expiresAt,
      ttl_ms: ttlMs,
      rev: 1,
      last_seq: this.getLastSeq(),
      messages: this.listMessagesSince(0),
      attachments: [],
    };
    return Response.json(snapshot, { status: 201 });
  }

  private async handlePostMessage(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      sender: string;
      body?: string;
      status?: string;
      attachment_ids?: string[];
    };

    // Re-check meta after awaiting request.json() in case a purge raced with this call
    const meta = this.getMeta();
    if (!meta || meta.deleting) {
      return Response.json({ error: "task room not found" }, { status: 404 });
    }

    const text = (body.body ?? "").trim();
    if (new TextEncoder().encode(text).byteLength > MAX_MESSAGE_BYTES) {
      return Response.json(
        { error: `message exceeds max size of ${MAX_MESSAGE_BYTES} bytes (use --file for larger payloads)` },
        { status: 413 },
      );
    }

    const attachmentIds = Array.isArray(body.attachment_ids)
      ? body.attachment_ids.map(String).filter((id) => this.getAttachment(id) !== null)
      : [];

    let nextStatus: TaskStatus | null = null;
    if (body.status !== undefined && body.status !== "") {
      if (!isValidStatus(body.status)) {
        return Response.json({ error: `invalid status: ${body.status}` }, { status: 400 });
      }
      nextStatus = body.status;
    }

    if (!text && attachmentIds.length === 0 && !nextStatus) {
      return Response.json(
        { error: "message must include body, attachment_ids, or status" },
        { status: 400 },
      );
    }

    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (sender, body, status, attachment_ids, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      body.sender,
      text,
      nextStatus,
      JSON.stringify(attachmentIds),
      now,
    );

    const effectiveStatus = nextStatus ?? meta.status;
    if (nextStatus) {
      this.ctx.storage.sql.exec("UPDATE meta SET status = ? WHERE id = 1", nextStatus);
    }
    const { expiresAt, rev } = await this.touchAndBumpRev(meta, now);

    const lastSeq = this.getLastSeq();
    const message = this.listMessagesSince(lastSeq - 1)[0]!;
    const messageCount = this.getMessageCount();

    await this.notifyWaiters(effectiveStatus, lastSeq);

    return Response.json(
      {
        seq: message.seq,
        message,
        status: effectiveStatus,
        last_seq: lastSeq,
        expires_at: expiresAt,
        rev,
        message_count: messageCount,
      },
      { status: 201 },
    );
  }

  private async handleRegisterAttachment(request: Request): Promise<Response> {
    const att = (await request.json()) as AttachmentRecord;

    const meta = this.getMeta();
    if (!meta || meta.deleting) {
      return Response.json({ error: "task room not found" }, { status: 404 });
    }

    const now = att.created_at || Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO attachments (id, filename, content_type, size_bytes, sha256, sender, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      att.id,
      att.filename,
      att.content_type,
      att.size_bytes,
      att.sha256,
      att.sender,
      now,
    );
    const { expiresAt, rev } = await this.touchAndBumpRev(meta, now);
    return Response.json(
      {
        attachment: { ...att, created_at: now },
        status: meta.status,
        last_seq: this.getLastSeq(),
        message_count: this.getMessageCount(),
        expires_at: expiresAt,
        rev,
      },
      { status: 201 },
    );
  }

  private async handleWait(request: Request, url: URL, meta: RoomMetaRow): Promise<Response> {
    const signalOnly = url.searchParams.get("signal_only") === "1";
    const machineId = request.headers.get("X-Machine-Id") || null;
    const since = signalOnly
      ? this.getLastSeq()
      : Math.max(0, Number.parseInt(url.searchParams.get("since") ?? "0", 10) || 0);
    const mention = signalOnly ? "" : (url.searchParams.get("mention") ?? "").trim();

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.ctx.acceptWebSocket(server);

      const now = Date.now();
      if (signalOnly) {
        server.serializeAttachment({
          since,
          mention: "",
          machineId: null,
          connectedAt: now,
          signalOnly: true,
        } satisfies WsAttachment);
        return new Response(null, { status: 101, webSocket: client });
      }

      const existing = this.listMessagesSince(since, mention);
      const lastSeq = this.getLastSeq();
      if (existing.length > 0) {
        const payload: WaitEventPayload = {
          type: "events",
          changed: true,
          status: meta.status,
          last_seq: lastSeq,
          messages: existing,
        };
        server.send(JSON.stringify(payload));
        server.serializeAttachment({
          since: lastSeq,
          mention,
          machineId,
          connectedAt: now,
          signalOnly: false,
        } satisfies WsAttachment);
      } else {
        server.serializeAttachment({
          since,
          mention,
          machineId,
          connectedAt: now,
          signalOnly: false,
        } satisfies WsAttachment);
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    // HTTP long-poll fallback
    const existing = this.listMessagesSince(since, mention);
    const lastSeq = this.getLastSeq();
    if (existing.length > 0) {
      const payload: WaitEventPayload = {
        type: "events",
        changed: true,
        status: meta.status,
        last_seq: lastSeq,
        messages: existing,
      };
      return Response.json(payload);
    }

    const timeoutSec = Math.min(
      LONG_POLL_MAX_SECONDS,
      Math.max(1, Number.parseInt(url.searchParams.get("timeout") ?? "25", 10) || 25),
    );

    const result = await new Promise<{ status: number; payload: WaitEventPayload | { error: string } }>((resolve) => {
      const waiter: PollWaiter = {
        since,
        mention,
        machineId,
        resolve,
        timer: setTimeout(async () => {
          this.pollWaiters.delete(waiter);
          if (machineId) {
            const active = await this.getActiveMachineIds([machineId]);
            if (active !== null && !active.has(machineId)) {
              resolve({ status: 401, payload: { error: "invalid or revoked token" } });
              return;
            }
          }
          const current = this.getMeta();
          if (!current || current.deleting) {
            resolve({
              status: 200,
              payload: {
                type: "closed",
                changed: true,
                purged: true,
                status: "done",
                last_seq: lastSeq,
                messages: [],
              },
            });
            return;
          }
          resolve({
            status: 200,
            payload: {
              type: "events",
              changed: false,
              status: current.status,
              last_seq: this.getLastSeq(),
              messages: [],
            },
          });
        }, timeoutSec * 1000),
      };
      this.pollWaiters.add(waiter);
    });

    return Response.json(result.payload, { status: result.status });
  }

  private async handleClose(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => ({}))) as {
      sender?: string;
      note?: string;
      purge?: unknown;
    };

    const meta = this.getMeta();
    if (!meta || meta.deleting) {
      return Response.json({ error: "task room not found" }, { status: 404 });
    }

    if (body.purge !== undefined && typeof body.purge !== "boolean") {
      return Response.json({ error: "purge must be a boolean" }, { status: 400 });
    }

    if (body.purge === true) {
      // Mark deleting synchronously before external R2/D1 I/O so concurrent requests fail cleanly
      this.ctx.storage.sql.exec("UPDATE meta SET deleting = 1 WHERE id = 1");
      try {
        await this.purgeRoomStorage(meta.uid);
      } catch (err) {
        // Retry via alarm in 60s if R2/D1 had a transient failure
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
        return Response.json(
          { error: err instanceof Error ? err.message : "purge failed, retry scheduled" },
          { status: 500 },
        );
      }
      return Response.json({ uid: meta.uid, status: "done", purged: true });
    }

    const now = Date.now();
    const note = (body.note ?? "").trim();
    if (new TextEncoder().encode(note).byteLength > MAX_MESSAGE_BYTES) {
      return Response.json(
        { error: `note exceeds max size of ${MAX_MESSAGE_BYTES} bytes` },
        { status: 413 },
      );
    }

    this.ctx.storage.sql.exec("UPDATE meta SET status = 'done' WHERE id = 1");
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (sender, body, status, attachment_ids, created_at)
       VALUES (?, ?, 'done', '[]', ?)`,
      body.sender ?? meta.created_by,
      note || "Closed room.",
      now,
    );
    const { expiresAt, rev } = await this.touchAndBumpRev(meta, now);
    const lastSeq = this.getLastSeq();
    const messageCount = this.getMessageCount();

    await this.notifyWaiters("done", lastSeq);

    return Response.json({
      uid: meta.uid,
      status: "done",
      purged: false,
      last_seq: lastSeq,
      expires_at: expiresAt,
      rev,
      message_count: messageCount,
    });
  }
}
