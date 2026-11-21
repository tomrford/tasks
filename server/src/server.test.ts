import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSameOrigin, verifyCfAccessJwt } from "./auth";
import { formatSender, isValidStatus, matchesMention, type MessageRecord } from "./types";
import { generateRoomUid, generateUserCode, isValidRoomUid, normalizeUserCode } from "./uid";

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

describe("uid", () => {
  it("generateRoomUid produces valid 4-segment capability uid with 12-char suffix", () => {
    const uid = generateRoomUid();
    expectValidUid(uid);
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
  assert.equal(parts.length, 4);
  assert.equal(parts[3]?.length, 12);
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
