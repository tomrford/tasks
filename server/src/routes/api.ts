import { Hono } from "hono";
import { requireMachineAuth } from "../auth";
import {
  MAX_ATTACHMENT_BYTES,
  formatSender,
  type AppVariables,
  type AttachmentRecord,
  type Env,
  type RoomSnapshot,
} from "../types";
import { generateId, generateRoomUid, isValidRoomUid, sha256Hex } from "../uid";

export const apiRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

apiRoutes.use("*", requireMachineAuth);

// Per-isolate sliding-window rate limit for failed (404) room lookups per machine
const missTracker = new Map<string, number[]>();
const MISS_WINDOW_MS = 60_000;
const MAX_MISSES_PER_WINDOW = 25;

function isMissRateLimited(machineId: string): boolean {
  const now = Date.now();
  const recent = (missTracker.get(machineId) ?? []).filter((t) => now - t < MISS_WINDOW_MS);
  if (recent.length === 0) {
    missTracker.delete(machineId);
    return false;
  }
  missTracker.set(machineId, recent);
  return recent.length >= MAX_MISSES_PER_WINDOW;
}

function recordMiss(machineId: string): void {
  const now = Date.now();
  const recent = (missTracker.get(machineId) ?? []).filter((t) => now - t < MISS_WINDOW_MS);
  recent.push(now);
  missTracker.set(machineId, recent);
}

function getRoomStub(env: Env, uid: string): DurableObjectStub {
  const id = env.ROOMS.idFromName(uid);
  return env.ROOMS.get(id);
}

function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return "file";
  }
  return cleaned;
}

apiRoutes.get("/whoami", (c) => {
  const machine = c.get("machine");
  return c.json({
    machine: {
      id: machine.id,
      name: machine.name,
      created_at: machine.created_at,
      last_seen_at: machine.last_seen_at,
    },
  });
});

apiRoutes.post("/tasks", async (c) => {
  const machine = c.get("machine");
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    note?: string;
    as?: string;
    ttl_days?: number;
  };

  const uid = generateRoomUid();
  const sender = formatSender(machine.name, body.as);
  const stub = getRoomStub(c.env, uid);

  const res = await stub.fetch("https://room.internal/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uid,
      title: body.title ?? "",
      note: body.note ?? "",
      created_by: sender,
      ttl_days: body.ttl_days,
    }),
  });

  if (!res.ok) {
    return new Response(res.body, { status: res.status, headers: res.headers });
  }

  const snapshot = (await res.json()) as RoomSnapshot;

  // Await initial index insert so a delayed create can never resurrect a subsequently purged room
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO rooms_index
     (uid, title, status, created_by, message_count, last_seq, rev, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      snapshot.uid,
      snapshot.title,
      snapshot.status,
      snapshot.created_by,
      snapshot.messages.length,
      snapshot.last_seq,
      snapshot.rev,
      snapshot.created_at,
      snapshot.updated_at,
      snapshot.expires_at,
    )
    .run()
    .catch(() => {});

  return c.json(snapshot, 201);
});

apiRoutes.get("/tasks/:uid", async (c) => {
  const machine = c.get("machine");
  if (isMissRateLimited(machine.id)) {
    return c.json({ error: "too many failed room lookups; slow down" }, 429);
  }
  const uid = c.req.param("uid");
  if (!isValidRoomUid(uid)) {
    recordMiss(machine.id);
    return c.json({ error: "invalid room uid" }, 400);
  }
  const since = c.req.query("since") ?? "0";
  const stub = getRoomStub(c.env, uid);
  const res = await stub.fetch(`https://room.internal/snapshot?since=${encodeURIComponent(since)}`);
  if (res.status === 404) {
    recordMiss(machine.id);
  }
  return new Response(res.body, { status: res.status, headers: res.headers });
});

apiRoutes.post("/tasks/:uid/messages", async (c) => {
  const machine = c.get("machine");
  if (isMissRateLimited(machine.id)) {
    return c.json({ error: "too many failed room lookups; slow down" }, 429);
  }
  const uid = c.req.param("uid");
  if (!isValidRoomUid(uid)) {
    recordMiss(machine.id);
    return c.json({ error: "invalid room uid" }, 400);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    body?: string;
    as?: string;
    status?: string;
    attachment_ids?: string[];
  };

  const sender = formatSender(machine.name, body.as);
  const stub = getRoomStub(c.env, uid);

  const res = await stub.fetch("https://room.internal/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sender,
      body: body.body ?? "",
      status: body.status,
      attachment_ids: body.attachment_ids ?? [],
    }),
  });

  if (!res.ok) {
    if (res.status === 404) recordMiss(machine.id);
    return new Response(res.body, { status: res.status, headers: res.headers });
  }

  const data = (await res.json()) as {
    seq: number;
    message: unknown;
    status: string;
    last_seq: number;
    expires_at: number;
    rev: number;
    message_count: number;
  };

  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `UPDATE rooms_index
       SET status = ?, message_count = ?, last_seq = ?, rev = ?, updated_at = ?, expires_at = ?
       WHERE uid = ? AND rev < ?`,
    )
      .bind(data.status, data.message_count, data.last_seq, data.rev, Date.now(), data.expires_at, uid, data.rev)
      .run()
      .catch(() => {}),
  );

  return c.json(data, 201);
});

apiRoutes.get("/tasks/:uid/wait", async (c) => {
  const machine = c.get("machine");
  if (isMissRateLimited(machine.id)) {
    return c.json({ error: "too many failed room lookups; slow down" }, 429);
  }
  const uid = c.req.param("uid");
  if (!isValidRoomUid(uid)) {
    recordMiss(machine.id);
    return c.json({ error: "invalid room uid" }, 400);
  }
  const stub = getRoomStub(c.env, uid);
  const incomingUrl = new URL(c.req.url);
  const targetUrl = new URL("https://room.internal/wait");
  targetUrl.search = incomingUrl.search;
  targetUrl.searchParams.delete("signal_only");

  const headers = new Headers();
  headers.set("X-Machine-Id", machine.id);
  const upgrade = c.req.header("Upgrade");
  if (upgrade) {
    headers.set("Upgrade", upgrade);
    const conn = c.req.header("Connection");
    if (conn) headers.set("Connection", conn);
    const wsKey = c.req.header("Sec-WebSocket-Key");
    if (wsKey) headers.set("Sec-WebSocket-Key", wsKey);
    const wsVer = c.req.header("Sec-WebSocket-Version");
    if (wsVer) headers.set("Sec-WebSocket-Version", wsVer);
  }

  const res = await stub.fetch(targetUrl.toString(), { method: "GET", headers });
  if (res.status === 404) {
    recordMiss(machine.id);
  }
  return res;
});

apiRoutes.post("/tasks/:uid/attachments", async (c) => {
  const machine = c.get("machine");
  if (isMissRateLimited(machine.id)) {
    return c.json({ error: "too many failed room lookups; slow down" }, 429);
  }
  const uid = c.req.param("uid");
  if (!isValidRoomUid(uid)) {
    recordMiss(machine.id);
    return c.json({ error: "invalid room uid" }, 400);
  }

  const stub = getRoomStub(c.env, uid);

  // Confirm room exists and is not deleting before writing to R2
  const check = await stub.fetch("https://room.internal/snapshot?since=999999999");
  if (!check.ok) {
    if (check.status === 404) recordMiss(machine.id);
    return new Response(check.body, { status: check.status, headers: check.headers });
  }

  const contentLengthHeader = c.req.header("Content-Length");
  if (contentLengthHeader) {
    const len = Number.parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(len) && len > MAX_ATTACHMENT_BYTES) {
      return c.json(
        { error: `attachment exceeds max size of ${MAX_ATTACHMENT_BYTES} bytes` },
        413,
      );
    }
  }

  const rawBytes = await c.req.arrayBuffer();
  if (rawBytes.byteLength === 0) {
    return c.json({ error: "empty attachment body" }, 400);
  }
  if (rawBytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return c.json(
      { error: `attachment exceeds max size of ${MAX_ATTACHMENT_BYTES} bytes` },
      413,
    );
  }

  const filename = sanitizeFilename(c.req.header("X-Filename") ?? "attachment.bin");
  const contentType = c.req.header("Content-Type") || "application/octet-stream";
  const sender = formatSender(machine.name, c.req.header("X-As"));
  const id = generateId("att");
  const sha256 = await sha256Hex(rawBytes);
  const now = Date.now();
  const r2Key = `rooms/${uid}/${id}`;

  await c.env.ATTACHMENTS.put(r2Key, rawBytes, {
    httpMetadata: {
      contentType,
      contentDisposition: `attachment; filename="${filename}"`,
    },
    customMetadata: {
      uid,
      id,
      filename,
      sender,
      sha256,
    },
  });

  const record: AttachmentRecord = {
    id,
    filename,
    content_type: contentType,
    size_bytes: rawBytes.byteLength,
    sha256,
    sender,
    created_at: now,
  };

  let regRes: Response;
  try {
    regRes = await stub.fetch("https://room.internal/attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
  } catch (err) {
    await c.env.ATTACHMENTS.delete(r2Key).catch(() => {});
    throw err;
  }

  if (!regRes.ok) {
    await c.env.ATTACHMENTS.delete(r2Key).catch(() => {});
    return new Response(regRes.body, { status: regRes.status, headers: regRes.headers });
  }

  const regData = (await regRes.json()) as {
    attachment: AttachmentRecord;
    status: string;
    last_seq: number;
    message_count: number;
    expires_at: number;
    rev: number;
  };
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `UPDATE rooms_index
       SET status = ?, message_count = ?, last_seq = ?, rev = ?, updated_at = ?, expires_at = ?
       WHERE uid = ? AND rev < ?`,
    )
      .bind(
        regData.status,
        regData.message_count,
        regData.last_seq,
        regData.rev,
        now,
        regData.expires_at,
        uid,
        regData.rev,
      )
      .run()
      .catch(() => {}),
  );

  return c.json(regData.attachment, 201);
});

apiRoutes.get("/tasks/:uid/attachments/:id", async (c) => {
  const machine = c.get("machine");
  if (isMissRateLimited(machine.id)) {
    return c.json({ error: "too many failed room lookups; slow down" }, 429);
  }
  const uid = c.req.param("uid");
  const id = c.req.param("id");
  if (!isValidRoomUid(uid)) {
    recordMiss(machine.id);
    return c.json({ error: "invalid room uid" }, 400);
  }

  const stub = getRoomStub(c.env, uid);
  const metaRes = await stub.fetch(`https://room.internal/attachments/${encodeURIComponent(id)}`);
  if (!metaRes.ok) {
    if (metaRes.status === 404) recordMiss(machine.id);
    return new Response(metaRes.body, { status: metaRes.status, headers: metaRes.headers });
  }
  const att = (await metaRes.json()) as AttachmentRecord;

  const obj = await c.env.ATTACHMENTS.get(`rooms/${uid}/${id}`);
  if (!obj) {
    return c.json({ error: "attachment payload missing" }, 404);
  }

  const headers = new Headers();
  headers.set("Content-Type", att.content_type || "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename="${sanitizeFilename(att.filename)}"`);
  headers.set("Content-Length", String(att.size_bytes));
  headers.set("X-Attachment-Sha256", att.sha256);
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(obj.body, { status: 200, headers });
});

apiRoutes.post("/tasks/:uid/close", async (c) => {
  const machine = c.get("machine");
  if (isMissRateLimited(machine.id)) {
    return c.json({ error: "too many failed room lookups; slow down" }, 429);
  }
  const uid = c.req.param("uid");
  if (!isValidRoomUid(uid)) {
    recordMiss(machine.id);
    return c.json({ error: "invalid room uid" }, 400);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    purge?: unknown;
    as?: string;
    note?: string;
  };

  if (body.purge !== undefined && typeof body.purge !== "boolean") {
    return c.json({ error: "purge must be a boolean" }, 400);
  }

  const stub = getRoomStub(c.env, uid);
  const res = await stub.fetch("https://room.internal/close", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: formatSender(machine.name, body.as),
      note: body.note ?? "",
      purge: body.purge === true,
    }),
  });

  if (!res.ok) {
    if (res.status === 404) recordMiss(machine.id);
    return new Response(res.body, { status: res.status, headers: res.headers });
  }

  const data = (await res.json()) as {
    uid: string;
    status: string;
    purged: boolean;
    last_seq?: number;
    expires_at?: number;
    rev?: number;
    message_count?: number;
  };

  if (!data.purged && typeof data.rev === "number") {
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        `UPDATE rooms_index
         SET status = 'done', message_count = ?, last_seq = ?, rev = ?, updated_at = ?, expires_at = ?
         WHERE uid = ? AND rev < ?`,
      )
        .bind(
          data.message_count ?? 0,
          data.last_seq ?? 0,
          data.rev,
          Date.now(),
          data.expires_at ?? Date.now(),
          uid,
          data.rev,
        )
        .run()
        .catch(() => {}),
    );
  }

  return c.json(data);
});
