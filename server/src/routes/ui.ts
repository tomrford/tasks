import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { isSameOrigin, requireCfAccess } from "../auth";
import type { AppVariables, AttachmentRecord, Env, Machine, RoomSnapshot } from "../types";
import {
  escapeHtml,
  formatBytes,
  formatRelativeTime,
  renderPage,
  statusBadge,
} from "../ui/layout";
import { generateRoomUid, isValidRoomUid } from "../uid";

interface RoomIndexRow {
  uid: string;
  title: string;
  status: string;
  created_by: string;
  message_count: number;
  last_seq: number;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

export const uiRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

uiRoutes.use("*", requireCfAccess);
uiRoutes.use("*", csrf());

function getRoomStub(env: Env, uid: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(uid));
}

function uiSenderName(uiUser: string): string {
  const local = uiUser.split("@")[0]?.trim() || "human";
  return local.replace(/[^a-zA-Z0-9._-]/g, "") || "human";
}

function isDevMode(env: Env): boolean {
  return env.ALLOW_UNAUTHENTICATED_UI === "true" && !env.CF_ACCESS_AUD;
}

uiRoutes.get("/", async (c) => {
  const user = c.get("uiUser");
  const now = Date.now();

  const res = await c.env.DB.prepare(
    `SELECT uid, title, status, created_by, message_count, last_seq, created_at, updated_at, expires_at
     FROM rooms_index
     WHERE expires_at > ?
     ORDER BY updated_at DESC
     LIMIT 100`,
  )
    .bind(now)
    .all<RoomIndexRow>();

  const rooms = res.results ?? [];

  const tableHtml =
    rooms.length === 0
      ? `<p class="muted">No active rooms yet. Create one below or run <code>tasks new</code> from any machine.</p>`
      : `<table>
          <thead>
            <tr>
              <th>Room UID</th>
              <th>Title</th>
              <th>Status</th>
              <th>Msgs</th>
              <th>Updated</th>
              <th>Expires</th>
            </tr>
          </thead>
          <tbody>
            ${rooms
              .map(
                (r) => `<tr>
                  <td><a href="/ui/rooms/${encodeURIComponent(r.uid)}" class="mono">${escapeHtml(r.uid)}</a></td>
                  <td>${r.title ? escapeHtml(r.title) : `<span class="muted">untitled</span>`}</td>
                  <td>${statusBadge(r.status)}</td>
                  <td class="muted">${r.message_count}</td>
                  <td class="muted">${formatRelativeTime(r.updated_at)}</td>
                  <td class="muted">${formatRelativeTime(r.expires_at)}</td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>`;

  return c.html(
    renderPage({
      title: "Rooms",
      activeNav: "rooms",
      user,
      devMode: isDevMode(c.env),
      body: `
        <div class="row" style="margin-bottom:16px;">
          <h1 style="margin:0;">Active Rooms</h1>
          <form method="post" action="/ui/rooms/new" class="row" style="gap:8px;">
            <input type="text" name="title" placeholder="New room title (optional)" style="width:240px;" />
            <button type="submit" class="btn-primary">New Room</button>
          </form>
        </div>
        <div class="card">${tableHtml}</div>
      `,
    }),
  );
});

uiRoutes.post("/rooms/new", async (c) => {
  const user = c.get("uiUser");
  const form = await c.req.parseBody();
  const title = String(form.title ?? "").trim();
  const uid = generateRoomUid();
  const sender = uiSenderName(user);
  const stub = getRoomStub(c.env, uid);

  const res = await stub.fetch("https://room.internal/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, title, created_by: sender }),
  });

  if (res.ok) {
    const snapshot = (await res.json()) as RoomSnapshot;
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
      .run();
  }

  return c.redirect(`/ui/rooms/${encodeURIComponent(uid)}`);
});

uiRoutes.get("/rooms/:uid", async (c) => {
  const user = c.get("uiUser");
  const uid = c.req.param("uid");
  if (!isValidRoomUid(uid)) {
    return c.text("Invalid room UID", 400);
  }

  const stub = getRoomStub(c.env, uid);
  const res = await stub.fetch("https://room.internal/snapshot?since=0");
  if (!res.ok) {
    return c.html(
      renderPage({
        title: "Not Found",
        activeNav: "rooms",
        user,
        devMode: isDevMode(c.env),
        body: `<div class="card"><h1>Room not found</h1><p class="muted"><code>${escapeHtml(uid)}</code> does not exist or has expired.</p><p><a href="/ui">Back to rooms</a></p></div>`,
      }),
      404,
    );
  }

  const room = (await res.json()) as RoomSnapshot;

  const messagesHtml =
    room.messages.length === 0
      ? `<p class="muted" id="empty-state">No messages yet.</p>`
      : room.messages
          .map((m) => {
            const atts =
              m.attachments.length === 0
                ? ""
                : `<div class="att-list">${m.attachments
                    .map(
                      (a) =>
                        `<a class="att-chip" href="/ui/rooms/${encodeURIComponent(uid)}/attachments/${encodeURIComponent(a.id)}">${escapeHtml(a.filename)} <span class="muted">(${formatBytes(a.size_bytes)})</span></a>`,
                    )
                    .join("")}</div>`;
            return `<div class="msg">
              <div class="msg-head">
                <div><strong>${escapeHtml(m.sender)}</strong> <span class="muted">#${m.seq}</span> ${m.status ? statusBadge(m.status) : ""}</div>
                <div class="muted">${formatRelativeTime(m.created_at)}</div>
              </div>
              ${m.body ? `<p class="msg-body">${escapeHtml(m.body)}</p>` : ""}
              ${atts}
            </div>`;
          })
          .join("");

  const html = renderPage({
    title: room.title || room.uid,
    activeNav: "rooms",
    user,
    devMode: isDevMode(c.env),
    body: `
      <div class="row" style="margin-bottom:14px;">
        <div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <h1 style="margin:0;">${room.title ? escapeHtml(room.title) : `<span class="mono">${escapeHtml(room.uid)}</span>`}</h1>
            ${statusBadge(room.status)}
          </div>
          <div class="muted" style="margin-top:4px;">
            UID: <code>${escapeHtml(room.uid)}</code> · created by <strong>${escapeHtml(room.created_by)}</strong> ${formatRelativeTime(room.created_at)} · expires ${formatRelativeTime(room.expires_at)}
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          ${
            room.status !== "done"
              ? `<form method="post" action="/ui/rooms/${encodeURIComponent(uid)}/close" class="inline-form">
                  <button type="submit">Mark Done</button>
                </form>`
              : ""
          }
          <form method="post" action="/ui/rooms/${encodeURIComponent(uid)}/close" class="inline-form" data-confirm="Purge this room and all attachments immediately?">
            <input type="hidden" name="purge" value="true" />
            <button type="submit" class="btn-danger">Purge</button>
          </form>
        </div>
      </div>

      <div class="card" style="background:var(--code-bg);padding:10px 14px;font-size:0.84rem;">
        CLI: <code>tasks show ${escapeHtml(room.uid)}</code> &nbsp;·&nbsp; <code>tasks wait ${escapeHtml(room.uid)} --since ${room.last_seq}</code>
      </div>

      <div id="messages" class="stack" style="margin-bottom:20px;">
        ${messagesHtml}
      </div>

      <div class="card">
        <h2>Post as ${escapeHtml(uiSenderName(user))}</h2>
        <form id="post-form" method="post" action="/ui/rooms/${encodeURIComponent(uid)}/messages" class="stack">
          <textarea id="draft-body" name="body" placeholder="Write a message or @mention an agent..."></textarea>
          <div class="row">
            <select id="draft-status" name="status" style="max-width:180px;">
              <option value="">Keep status (${escapeHtml(room.status)})</option>
              <option value="open">Set status: open</option>
              <option value="waiting">Set status: waiting</option>
              <option value="blocked">Set status: blocked</option>
              <option value="done">Set status: done</option>
            </select>
            <button type="submit" class="btn-primary">Post Message</button>
          </div>
        </form>
      </div>

      <script>
        (() => {
          document.querySelectorAll("form[data-confirm]").forEach((f) => {
            f.addEventListener("submit", (e) => {
              if (!confirm(f.getAttribute("data-confirm") || "Confirm?")) e.preventDefault();
            });
          });

          const draftKey = "tasks-draft:" + ${JSON.stringify(uid)};
          const bodyEl = document.getElementById("draft-body");
          const statusEl = document.getElementById("draft-status");
          const formEl = document.getElementById("post-form");
          try {
            const saved = JSON.parse(sessionStorage.getItem(draftKey) || "null");
            if (saved) {
              if (bodyEl && typeof saved.body === "string") bodyEl.value = saved.body;
              if (statusEl && typeof saved.status === "string") statusEl.value = saved.status;
            }
          } catch {}
          const saveDraft = () => {
            try {
              sessionStorage.setItem(draftKey, JSON.stringify({
                body: bodyEl ? bodyEl.value : "",
                status: statusEl ? statusEl.value : "",
              }));
            } catch {}
          };
          if (bodyEl) bodyEl.addEventListener("input", saveDraft);
          if (statusEl) statusEl.addEventListener("change", saveDraft);
          if (formEl) formEl.addEventListener("submit", () => {
            try { sessionStorage.removeItem(draftKey); } catch {}
          });

          const proto = location.protocol === "https:" ? "wss:" : "ws:";
          const wsUrl = proto + "//" + location.host + "/ui/rooms/" + encodeURIComponent(${JSON.stringify(uid)}) + "/ws";
          let ws;
          function connect() {
            try {
              ws = new WebSocket(wsUrl);
              ws.onmessage = (ev) => {
                if (ev.data === "pong") return;
                saveDraft();
                location.reload();
              };
              ws.onclose = () => setTimeout(connect, 5000);
            } catch {}
          }
          connect();
          setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) ws.send("ping");
          }, 25000);
        })();
      </script>
    `,
  });

  return c.html(html);
});

uiRoutes.post("/rooms/:uid/messages", async (c) => {
  const user = c.get("uiUser");
  const uid = c.req.param("uid");
  if (!isValidRoomUid(uid)) return c.text("Invalid room UID", 400);

  const form = await c.req.parseBody();
  const body = String(form.body ?? "").trim();
  const status = String(form.status ?? "").trim();
  if (!body && !status) {
    return c.redirect(`/ui/rooms/${encodeURIComponent(uid)}`);
  }

  const stub = getRoomStub(c.env, uid);
  const res = await stub.fetch("https://room.internal/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: uiSenderName(user),
      body,
      status: status || undefined,
    }),
  });

  if (res.ok) {
    const data = (await res.json()) as {
      status: string;
      last_seq: number;
      expires_at: number;
      rev: number;
      message_count: number;
    };
    await c.env.DB.prepare(
      `UPDATE rooms_index
       SET status = ?, message_count = ?, last_seq = ?, rev = ?, updated_at = ?, expires_at = ?
       WHERE uid = ? AND rev < ?`,
    )
      .bind(data.status, data.message_count, data.last_seq, data.rev, Date.now(), data.expires_at, uid, data.rev)
      .run();
  }

  return c.redirect(`/ui/rooms/${encodeURIComponent(uid)}`);
});

uiRoutes.post("/rooms/:uid/close", async (c) => {
  const user = c.get("uiUser");
  const uid = c.req.param("uid");
  if (!isValidRoomUid(uid)) return c.text("Invalid room UID", 400);

  const form = await c.req.parseBody();
  const purge = String(form.purge ?? "") === "true";
  const stub = getRoomStub(c.env, uid);

  const res = await stub.fetch("https://room.internal/close", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: uiSenderName(user), purge }),
  });

  if (purge) {
    return c.redirect("/ui");
  }

  if (res.ok) {
    const data = (await res.json()) as {
      last_seq?: number;
      expires_at?: number;
      rev?: number;
      message_count?: number;
    };
    if (typeof data.rev === "number") {
      await c.env.DB.prepare(
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
        .run();
    }
  }

  return c.redirect(`/ui/rooms/${encodeURIComponent(uid)}`);
});

uiRoutes.get("/rooms/:uid/attachments/:id", async (c) => {
  const uid = c.req.param("uid");
  const id = c.req.param("id");
  if (!isValidRoomUid(uid)) return c.text("Invalid room UID", 400);

  const stub = getRoomStub(c.env, uid);
  const metaRes = await stub.fetch(`https://room.internal/attachments/${encodeURIComponent(id)}`);
  if (!metaRes.ok) return c.text("Attachment not found", 404);
  const att = (await metaRes.json()) as AttachmentRecord;

  const obj = await c.env.ATTACHMENTS.get(`rooms/${uid}/${id}`);
  if (!obj) return c.text("Attachment payload missing", 404);

  const headers = new Headers();
  headers.set("Content-Type", att.content_type || "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename="${att.filename.replace(/["\\\r\n]/g, "")}"`);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(obj.body, { status: 200, headers });
});

uiRoutes.get("/rooms/:uid/ws", async (c) => {
  if (!isSameOrigin(c.req.raw)) {
    return c.text("Forbidden: cross-origin WebSocket rejected", 403);
  }
  const uid = c.req.param("uid");
  if (!isValidRoomUid(uid)) return c.text("Invalid room UID", 400);
  const stub = getRoomStub(c.env, uid);
  // Signal-only mode: ignores client-supplied `since` and never streams room history over WS
  return stub.fetch("https://room.internal/wait?signal_only=1", {
    headers: c.req.raw.headers,
  });
});

uiRoutes.get("/machines", async (c) => {
  const user = c.get("uiUser");
  const res = await c.env.DB.prepare(
    `SELECT id, name, approved_by, created_at, last_seen_at, revoked_at
     FROM machines
     ORDER BY revoked_at IS NOT NULL, created_at DESC
     LIMIT 100`,
  ).all<Machine>();

  const machines = res.results ?? [];
  const tableHtml =
    machines.length === 0
      ? `<p class="muted">No authorized machines yet. Run <code>tasks login</code> on a machine to register it.</p>`
      : `<table>
          <thead>
            <tr>
              <th>Machine</th>
              <th>Status</th>
              <th>Last Seen</th>
              <th>Approved</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${machines
              .map(
                (m) => `<tr>
                  <td><strong>${escapeHtml(m.name)}</strong><div class="muted mono" style="font-size:0.75rem;">${escapeHtml(m.id)}</div></td>
                  <td>${m.revoked_at ? statusBadge("done") : statusBadge("open")}</td>
                  <td class="muted">${formatRelativeTime(m.last_seen_at)}</td>
                  <td class="muted">${formatRelativeTime(m.created_at)}${m.approved_by ? ` by ${escapeHtml(m.approved_by)}` : ""}</td>
                  <td style="text-align:right;">
                    ${
                      m.revoked_at
                        ? `<span class="muted">revoked ${formatRelativeTime(m.revoked_at)}</span>`
                        : `<form method="post" action="/ui/machines/${encodeURIComponent(m.id)}/revoke" class="inline-form" data-confirm="${escapeHtml(`Revoke token for ${m.name}?`)}">
                            <button type="submit" class="btn-danger">Revoke</button>
                          </form>`
                    }
                  </td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>`;

  return c.html(
    renderPage({
      title: "Machines",
      activeNav: "machines",
      user,
      devMode: isDevMode(c.env),
      body: `
        <h1>Authorized Machines</h1>
        <div class="card">${tableHtml}</div>
        <script>
          document.querySelectorAll("form[data-confirm]").forEach((f) => {
            f.addEventListener("submit", (e) => {
              if (!confirm(f.getAttribute("data-confirm") || "Confirm?")) e.preventDefault();
            });
          });
        </script>
      `,
    }),
  );
});

uiRoutes.post("/machines/:id/revoke", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE machines SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(Date.now(), id)
    .run();
  return c.redirect("/ui/machines");
});
