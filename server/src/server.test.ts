import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSameOrigin, verifyCfAccessJwt } from "./auth";
import { apiRoutes } from "./routes/api";
import { formatSender, isValidStatus, matchesMention, type Env, type MessageRecord } from "./types";
import { generateRoomUid, generateUserCode, isValidRoomUid, normalizeUserCode } from "./uid";

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

describe("uid", () => {
  it("generateRoomUid produces valid 3-word uid", () => {
    const uid = generateRoomUid();
    expectValidUid(uid);
  });

  it("isValidRoomUid accepts both 3-word and legacy 4-segment uids", () => {
    assert.equal(isValidRoomUid("amber-falcon-drift"), true);
    assert.equal(isValidRoomUid("amber-falcon-drift-7k2m9p4x8q3n"), true);
    assert.equal(isValidRoomUid("bad"), false);
  });

  it("generateUserCode and normalizeUserCode", () => {
    const code = generateUserCode();
    assert.match(code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    assert.equal(normalizeUserCode(code.toLowerCase().replace("-", " ")), code);
  });
});

function expectValidUid(uid: string): void {
  assert.equal(isValidRoomUid(uid), true);
  const parts = uid.split("-");
  assert.equal(parts.length, 3);
  for (const part of parts) {
    assert.match(part, /^[a-z]+$/);
  }
}

describe("types and sender formatting", () => {
  it("formatSender combines machine and optional label", () => {
    assert.equal(formatSender("macbook"), "macbook");
    assert.equal(formatSender("macbook", "backend"), "macbook/backend");
    assert.equal(formatSender("macbook", "  "), "macbook");
    assert.equal(formatSender("macbook", "rev/iewer!"), "macbook/reviewer");
  });

  it("isValidStatus validates allowed room statuses", () => {
    assert.equal(isValidStatus("open"), true);
    assert.equal(isValidStatus("waiting"), true);
    assert.equal(isValidStatus("blocked"), true);
    assert.equal(isValidStatus("done"), true);
    assert.equal(isValidStatus("archived"), false);
  });
});

describe("matchesMention", () => {
  const mkMsg = (body: string, status: MessageRecord["status"] = null): MessageRecord => ({
    seq: 1,
    sender: "macmini",
    body,
    status,
    attachments: [],
    created_at: Date.now(),
  });

  it("matches @mention and @machine/mention with word boundaries case-insensitively", () => {
    assert.equal(matchesMention(mkMsg("hey @backend can you check this?"), "backend"), true);
    assert.equal(matchesMention(mkMsg("@Backend: ready"), "@backend"), true);
    assert.equal(matchesMention(mkMsg("over to @macbook/backend now"), "backend"), true);
    assert.equal(matchesMention(mkMsg("ping @backend-2"), "backend"), false);
    assert.equal(matchesMention(mkMsg("email foo@backend.com"), "backend"), false);
  });

  it("always wakes on done status", () => {
    assert.equal(matchesMention(mkMsg("all finished", "done"), "backend"), true);
  });
});

describe("auth checks", () => {
  it("isSameOrigin requires matching Origin header", () => {
    assert.equal(
      isSameOrigin(new Request("https://tasks.example.com/ui/rooms/x/ws", { headers: { Origin: "https://tasks.example.com" } })),
      true,
    );
    assert.equal(
      isSameOrigin(new Request("https://tasks.example.com/ui/rooms/x/ws", { headers: { Origin: "https://evil.example" } })),
      false,
    );
    assert.equal(isSameOrigin(new Request("https://tasks.example.com/ui/rooms/x/ws")), false);
  });

  it("verifyCfAccessJwt rejects missing kid, exp, or iss", async () => {
    const missingKid = `${b64url({ alg: "RS256" })}.${b64url({ aud: "aud1", exp: 9999999999, iss: "https://team.cloudflareaccess.com" })}.sig`;
    await assert.rejects(() => verifyCfAccessJwt(missingKid, "team.cloudflareaccess.com", "aud1"), /missing kid/);

    const missingExp = `${b64url({ alg: "RS256", kid: "k1" })}.${b64url({ aud: "aud1", iss: "https://team.cloudflareaccess.com" })}.sig`;
    await assert.rejects(() => verifyCfAccessJwt(missingExp, "team.cloudflareaccess.com", "aud1"), /missing exp/);

    const missingIss = `${b64url({ alg: "RS256", kid: "k1" })}.${b64url({ aud: "aud1", exp: 9999999999 })}.sig`;
    await assert.rejects(() => verifyCfAccessJwt(missingIss, "team.cloudflareaccess.com", "aud1"), /issuer mismatch/);
  });
});

function createMockApiEnv(collisionsBeforeSuccess: number): {
  env: Env;
  ctx: ExecutionContext;
  getInitAttempts: () => number;
  getIndexInserts: () => number;
} {
  let initAttempts = 0;
  let indexInserts = 0;
  const now = Date.now();

  const db = {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes("FROM machines")) {
                return {
                  id: "mach_1",
                  name: "macbook",
                  approved_by: "tom",
                  created_at: now,
                  last_seen_at: now,
                  revoked_at: null,
                } as T;
              }
              return null;
            },
            async run() {
              if (sql.includes("INSERT OR IGNORE INTO rooms_index")) {
                indexInserts++;
              }
              return { success: true };
            },
          };
        },
      };
    },
  };

  const rooms = {
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get(_id: DurableObjectId) {
      return {
        async fetch(_input: RequestInfo | URL, init?: RequestInit) {
          initAttempts++;
          if (initAttempts <= collisionsBeforeSuccess) {
            return Response.json({ error: "room already exists" }, { status: 409 });
          }
          const payload = JSON.parse(String(init?.body ?? "{}")) as {
            uid: string;
            title?: string;
            created_by: string;
          };
          return Response.json(
            {
              uid: payload.uid,
              title: payload.title ?? "",
              status: "open",
              created_by: payload.created_by,
              created_at: now,
              updated_at: now,
              expires_at: now + 7 * 86_400_000,
              ttl_ms: 7 * 86_400_000,
              rev: 1,
              last_seq: 0,
              messages: [],
              attachments: [],
            },
            { status: 201 },
          );
        },
      };
    },
  };

  const env = {
    DB: db as unknown as D1Database,
    ROOMS: rooms as unknown as DurableObjectNamespace,
    ATTACHMENTS: {} as R2Bucket,
    CF_ACCESS_TEAM_DOMAIN: "",
    CF_ACCESS_AUD: "",
    ALLOW_UNAUTHENTICATED_UI: "false",
  } satisfies Env;

  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext;

  return {
    env,
    ctx,
    getInitAttempts: () => initAttempts,
    getIndexInserts: () => indexInserts,
  };
}

describe("api room creation collision retry", () => {
  it("retries after a 409 collision and inserts into D1 once on success", async () => {
    const mock = createMockApiEnv(1);
    const req = new Request("https://tasks.example.com/tasks", {
      method: "POST",
      headers: {
        Authorization: "Bearer tsk_test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "retry check" }),
    });

    const res = await apiRoutes.fetch(req, mock.env, mock.ctx);
    assert.equal(res.status, 201);
    const data = (await res.json()) as { uid: string; title: string };
    expectValidUid(data.uid);
    assert.equal(data.title, "retry check");
    assert.equal(mock.getInitAttempts(), 2);
    assert.equal(mock.getIndexInserts(), 1);
  });

  it("returns 409 cleanly without D1 insert after five consecutive collisions", async () => {
    const mock = createMockApiEnv(5);
    const req = new Request("https://tasks.example.com/tasks", {
      method: "POST",
      headers: {
        Authorization: "Bearer tsk_test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "exhausted" }),
    });

    const res = await apiRoutes.fetch(req, mock.env, mock.ctx);
    assert.equal(res.status, 409);
    const data = (await res.json()) as { error: string };
    assert.equal(data.error, "room already exists");
    assert.equal(mock.getInitAttempts(), 5);
    assert.equal(mock.getIndexInserts(), 0);
  });
});
