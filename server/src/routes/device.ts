import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { requireCfAccess } from "../auth";
import { DEVICE_CODE_TTL_MS, type AppVariables, type Env } from "../types";
import { escapeHtml, formatRelativeTime, renderPage } from "../ui/layout";
import {
  generateApiToken,
  generateId,
  generateUserCode,
  normalizeUserCode,
  randomHex,
  sha256Hex,
} from "../uid";

interface DeviceCodeRow {
  device_code_hash: string;
  user_code: string;
  machine_name: string;
  status: string;
  approved_by: string | null;
  requester_ip: string | null;
  requester_country: string | null;
  created_at: number;
  expires_at: number;
  decided_at: number | null;
}

const MAX_PENDING_PER_IP = 10;
const MAX_PENDING_GLOBAL = 50;

const FLASH_MESSAGES: Record<string, string> = {
  approved: "Machine approved. You can return to your terminal.",
  denied: "Device login request denied.",
  not_found: "Code not found, already handled, or expired.",
};

export const deviceApiRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
export const deviceUiRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/**
 * Starts a device authorization flow for the CLI.
 * Public endpoint (no bearer token yet); authorization happens behind CF Access on /device.
 */
deviceApiRoutes.post("/start", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { machine_name?: string };
  const machineName = (body.machine_name ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 64);
  if (!machineName) {
    return c.json({ error: "machine_name is required (alphanumeric, ., _, -)" }, 400);
  }

  const now = Date.now();
  const requesterIp =
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown";
  const cfInfo = (c.req.raw as Request & { cf?: { country?: string } }).cf;
  const requesterCountry = cfInfo?.country ?? "";

  // Prune expired codes first, then enforce pending rate limits atomically in a single INSERT
  await c.env.DB.prepare("DELETE FROM device_codes WHERE expires_at < ?").bind(now).run();

  const expiresAt = now + DEVICE_CODE_TTL_MS;
  const deviceCode = randomHex(32);
  const deviceCodeHash = await sha256Hex(deviceCode);
  const userCode = generateUserCode();

  const inserted = await c.env.DB.prepare(
    `INSERT INTO device_codes
     (device_code_hash, user_code, machine_name, status, requester_ip, requester_country, created_at, expires_at)
     SELECT ?, ?, ?, 'pending', ?, ?, ?, ?
     WHERE (SELECT COUNT(*) FROM device_codes WHERE status = 'pending' AND expires_at > ?) < ?
       AND (SELECT COUNT(*) FROM device_codes WHERE status = 'pending' AND expires_at > ? AND requester_ip = ?) < ?`,
  )
    .bind(
      deviceCodeHash,
      userCode,
      machineName,
      requesterIp,
      requesterCountry,
      now,
      expiresAt,
      now,
      MAX_PENDING_GLOBAL,
      now,
      requesterIp,
      MAX_PENDING_PER_IP,
    )
    .run();

  if ((inserted.meta?.changes ?? 0) !== 1) {
    return c.json({ error: "too many pending device login requests; try again later" }, 429);
  }

  const origin = new URL(c.req.url).origin;
  return c.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_url: `${origin}/device?code=${encodeURIComponent(userCode)}`,
    expires_in: Math.floor(DEVICE_CODE_TTL_MS / 1000),
    interval: 2,
  });
});

/**
 * Polled by the CLI until the user approves or denies the device code in /device.
 * Token minting and machine creation happen atomically on claim, so plaintext tokens
 * are NEVER stored in D1 and concurrent approves/polls cannot create orphan machines.
 */
deviceApiRoutes.post("/poll", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { device_code?: string };
  const deviceCode = (body.device_code ?? "").trim();
  if (!deviceCode) {
    return c.json({ error: "device_code is required" }, 400);
  }

  const hash = await sha256Hex(deviceCode);
  const row = await c.env.DB.prepare(
    `SELECT device_code_hash, user_code, machine_name, status, approved_by, created_at, expires_at
     FROM device_codes
     WHERE device_code_hash = ?
     LIMIT 1`,
  )
    .bind(hash)
    .first<DeviceCodeRow>();

  if (!row) {
    return c.json({ status: "expired", error: "unknown or expired device code" }, 410);
  }

  const now = Date.now();
  if (now > row.expires_at) {
    await c.env.DB.prepare("DELETE FROM device_codes WHERE device_code_hash = ?").bind(hash).run();
    return c.json({ status: "expired" }, 410);
  }

  if (row.status === "pending") {
    return c.json({ status: "pending" });
  }

  if (row.status === "denied") {
    return c.json({ status: "denied" }, 403);
  }

  if (row.status === "claimed") {
    return c.json({ status: "expired", error: "device code already claimed" }, 410);
  }

  if (row.status === "approved") {
    const machineId = generateId("mch");
    const token = generateApiToken();
    const tokenHash = await sha256Hex(token);

    // Single SQLite transaction: only inserts machine and marks claimed if still approved & unexpired
    const [insertRes, claimRes] = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO machines (id, name, token_hash, approved_by, created_at)
         SELECT ?, machine_name, ?, approved_by, ?
         FROM device_codes
         WHERE device_code_hash = ? AND status = 'approved' AND expires_at > ?`,
      ).bind(machineId, tokenHash, now, hash, now),
      c.env.DB.prepare(
        `UPDATE device_codes
         SET status = 'claimed'
         WHERE device_code_hash = ? AND status = 'approved' AND expires_at > ?`,
      ).bind(hash, now),
    ]);

    if ((insertRes?.meta?.changes ?? 0) !== 1 || (claimRes?.meta?.changes ?? 0) !== 1) {
      return c.json({ status: "expired", error: "device code already claimed" }, 410);
    }

    return c.json({
      status: "approved",
      token,
      machine: {
        id: machineId,
        name: row.machine_name,
      },
    });
  }

  return c.json({ status: "expired" }, 410);
});

// --- Browser Device Approval UI (protected by CF Access + CSRF) ---

deviceUiRoutes.use("*", requireCfAccess);
deviceUiRoutes.use("*", csrf());

deviceUiRoutes.get("/", async (c) => {
  const user = c.get("uiUser");
  const rawCode = c.req.query("code") ?? "";
  const lookupCode = rawCode.trim() ? normalizeUserCode(rawCode) : "";
  const flashKey = c.req.query("flash") ?? "";
  const flash = FLASH_MESSAGES[flashKey] ?? "";
  const now = Date.now();

  let matched: DeviceCodeRow | null = null;
  if (lookupCode) {
    matched = await c.env.DB.prepare(
      `SELECT user_code, machine_name, requester_ip, requester_country, created_at, expires_at
       FROM device_codes
       WHERE user_code = ? AND status = 'pending' AND expires_at > ?
       LIMIT 1`,
    )
      .bind(lookupCode, now)
      .first<DeviceCodeRow>();
  }

  let confirmCard = "";
  if (lookupCode && matched) {
    const originInfo = [matched.requester_ip, matched.requester_country]
      .filter(Boolean)
      .join(" · ");
    confirmCard = `
      <div class="card" style="border-color:var(--accent);">
        <h2>Confirm Machine Approval</h2>
        <p>Verify that this code matches the terminal running <code>tasks login</code>:</p>
        <table>
          <tbody>
            <tr><th>Code</th><td><code style="font-size:1.1rem;font-weight:700;">${escapeHtml(matched.user_code)}</code></td></tr>
            <tr><th>Machine name</th><td><strong>${escapeHtml(matched.machine_name)}</strong></td></tr>
            <tr><th>Requested</th><td>${formatRelativeTime(matched.created_at)} (expires ${formatRelativeTime(matched.expires_at)})</td></tr>
            ${originInfo ? `<tr><th>Source</th><td class="mono">${escapeHtml(originInfo)}</td></tr>` : ""}
          </tbody>
        </table>
        <div style="margin-top:16px;display:flex;gap:10px;">
          <form method="post" action="/device/approve" class="inline-form">
            <input type="hidden" name="code" value="${escapeHtml(matched.user_code)}" />
            <button type="submit" class="btn-primary">Approve ${escapeHtml(matched.machine_name)}</button>
          </form>
          <form method="post" action="/device/deny" class="inline-form">
            <input type="hidden" name="code" value="${escapeHtml(matched.user_code)}" />
            <button type="submit" class="btn-danger">Deny</button>
          </form>
        </div>
      </div>`;
  } else if (lookupCode) {
    confirmCard = `<div class="card"><p class="muted">No pending login request matches code <code>${escapeHtml(lookupCode)}</code>.</p></div>`;
  }

  const html = renderPage({
    title: "Device Login",
    activeNav: "device",
    user,
    devMode: c.env.ALLOW_UNAUTHENTICATED_UI === "true" && !c.env.CF_ACCESS_AUD,
    body: `
      <h1>Approve CLI Device</h1>
      ${flash ? `<div class="card" style="border-color:var(--accent);">${escapeHtml(flash)}</div>` : ""}
      ${confirmCard}
      ${!lookupCode && !flash ? `<div class="card"><p class="muted">Run <code>tasks login</code> and open the URL it prints to approve a machine.</p></div>` : ""}
    `,
  });

  return c.html(html);
});

deviceUiRoutes.post("/approve", async (c) => {
  const user = c.get("uiUser");
  const form = await c.req.parseBody();
  const code = normalizeUserCode(String(form.code ?? ""));
  const now = Date.now();

  const updated = await c.env.DB.prepare(
    `UPDATE device_codes
     SET status = 'approved', approved_by = ?, decided_at = ?
     WHERE user_code = ? AND status = 'pending' AND expires_at > ?`,
  )
    .bind(user, now, code, now)
    .run();

  if ((updated.meta?.changes ?? 0) !== 1) {
    return c.redirect("/device?flash=not_found");
  }

  return c.redirect("/device?flash=approved");
});

deviceUiRoutes.post("/deny", async (c) => {
  const form = await c.req.parseBody();
  const code = normalizeUserCode(String(form.code ?? ""));
  const now = Date.now();

  const updated = await c.env.DB.prepare(
    `UPDATE device_codes
     SET status = 'denied', decided_at = ?
     WHERE user_code = ? AND status = 'pending' AND expires_at > ?`,
  )
    .bind(now, code, now)
    .run();

  if ((updated.meta?.changes ?? 0) !== 1) {
    return c.redirect("/device?flash=not_found");
  }

  return c.redirect("/device?flash=denied");
});
