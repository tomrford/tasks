import type { Context, Next } from "hono";
import type { AppVariables, Env, Machine } from "./types";
import { sha256Hex } from "./uid";

interface JwkWithKid extends JsonWebKey {
  kid?: string;
  alg?: string;
}

interface AccessCertsResponse {
  keys?: JwkWithKid[];
}

interface JwtHeader {
  kid?: string;
  alg?: string;
}

interface JwtPayload {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
  email?: string;
  sub?: string;
}

// Per-isolate JWKS cache (refreshed every 10 minutes)
const jwksCache = new Map<string, { fetchedAt: number; keys: JwkWithKid[] }>();
const JWKS_TTL_MS = 10 * 60 * 1000;

function base64UrlToUint8Array(input: string): Uint8Array {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const base64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeJwtPart<T>(part: string): T {
  const bytes = base64UrlToUint8Array(part);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function fetchAccessKeys(teamDomain: string, forceRefresh = false): Promise<JwkWithKid[]> {
  const normalized = teamDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const cached = jwksCache.get(normalized);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys;
  }

  const res = await fetch(`https://${normalized}/cdn-cgi/access/certs`, {
    cf: { cacheTtl: 300 },
  });
  if (!res.ok) {
    throw new Error(`failed to fetch Cloudflare Access JWKS (${res.status})`);
  }
  const data = (await res.json()) as AccessCertsResponse;
  const keys = data.keys ?? [];
  jwksCache.set(normalized, { fetchedAt: Date.now(), keys });
  return keys;
}

export async function verifyCfAccessJwt(
  token: string,
  teamDomain: string,
  expectedAud: string,
): Promise<string> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("malformed Cloudflare Access JWT");
  }
  const [headerPart, payloadPart, sigPart] = parts as [string, string, string];
  const header = decodeJwtPart<JwtHeader>(headerPart);
  const payload = decodeJwtPart<JwtPayload>(payloadPart);

  if (header.alg !== "RS256") {
    throw new Error(`unsupported JWT alg: ${header.alg ?? "unknown"}`);
  }
  if (typeof header.kid !== "string" || !header.kid.trim()) {
    throw new Error("Cloudflare Access JWT missing kid");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    throw new Error("Cloudflare Access JWT missing exp");
  }
  if (payload.exp <= nowSec) {
    throw new Error("Cloudflare Access JWT expired");
  }
  if (typeof payload.nbf === "number" && payload.nbf > nowSec + 60) {
    throw new Error("Cloudflare Access JWT not yet valid");
  }

  const audList = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!audList.includes(expectedAud)) {
    throw new Error("Cloudflare Access JWT audience mismatch");
  }

  const normalizedDomain = teamDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const expectedIss = `https://${normalizedDomain}`;
  if (typeof payload.iss !== "string" || payload.iss.replace(/\/+$/, "") !== expectedIss) {
    throw new Error("Cloudflare Access JWT issuer mismatch");
  }

  let keys = await fetchAccessKeys(normalizedDomain, false);
  let matching = keys.find((k) => k.kid === header.kid);
  if (!matching) {
    keys = await fetchAccessKeys(normalizedDomain, true);
    matching = keys.find((k) => k.kid === header.kid);
  }
  if (!matching) {
    throw new Error("matching Cloudflare Access signing key not found");
  }

  const key = await crypto.subtle.importKey(
    "jwk",
    matching,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const signingInput = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const signature = base64UrlToUint8Array(sigPart);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signingInput);
  if (!valid) {
    throw new Error("invalid Cloudflare Access JWT signature");
  }

  return payload.email || payload.sub || "authenticated-user";
}

/**
 * Protects /device and /ui routes behind Cloudflare Access.
 * Fails closed unless CF Access JWT verification is configured OR
 * ALLOW_UNAUTHENTICATED_UI=true is set (only permitted in development mode).
 */
export async function requireCfAccess(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next,
) {
  const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const aud = c.env.CF_ACCESS_AUD?.trim();
  const allowLocalBypass = c.env.ALLOW_UNAUTHENTICATED_UI === "true";

  if (teamDomain && aud) {
    const jwt =
      c.req.header("Cf-Access-Jwt-Assertion") ??
      parseCookie(c.req.header("Cookie"), "CF_Authorization");

    if (!jwt) {
      return c.text("Unauthorized: missing Cloudflare Access token.", 401);
    }

    try {
      const user = await verifyCfAccessJwt(jwt, teamDomain, aud);
      c.set("uiUser", user);
      return await next();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "verification failed";
      return c.text(`Forbidden: ${msg}`, 403);
    }
  }

  if (allowLocalBypass) {
    const headerEmail = c.req.header("Cf-Access-Authenticated-User-Email");
    c.set("uiUser", headerEmail || "local-dev");
    return await next();
  }

  return c.text(
    "Web UI is locked: configure CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD (or run in local dev with ALLOW_UNAUTHENTICATED_UI=true).",
    503,
  );
}

/**
 * Verifies same-origin for browser WebSocket upgrades (which csrf() does not cover).
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

/**
 * Authenticates CLI API requests using per-machine bearer tokens stored hashed in D1.
 */
export async function requireMachineAuth(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next,
) {
  const authHeader = c.req.header("Authorization");
  let token = "";
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    token = authHeader.slice(7).trim();
  }
  if (!token) {
    return c.json({ error: "missing bearer token" }, 401);
  }

  const tokenHash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT id, name, approved_by, created_at, last_seen_at, revoked_at
     FROM machines
     WHERE token_hash = ? AND revoked_at IS NULL
     LIMIT 1`,
  )
    .bind(tokenHash)
    .first<Machine>();

  if (!row) {
    return c.json({ error: "invalid or revoked token" }, 401);
  }

  c.set("machine", row);

  const now = Date.now();
  if (!row.last_seen_at || now - row.last_seen_at > 60_000) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare("UPDATE machines SET last_seen_at = ? WHERE id = ?")
        .bind(now, row.id)
        .run()
        .catch(() => {}),
    );
  }

  return await next();
}
