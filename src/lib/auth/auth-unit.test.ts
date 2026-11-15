import { describe, expect, it } from "vitest";
import { canonicalJson } from "../canonical";
import { hashPassword, passwordProblems, verifyPassword } from "./password";
import { base32Decode, base32Encode, generateTotpSecret, totpCode, verifyTotp } from "./totp";

describe("TOTP [REQ-11.200]", () => {
  // RFC 6238 Appendix B test vector for SHA-1 (secret "12345678901234567890").
  const secret = base32Encode(Buffer.from("12345678901234567890"));

  it("matches the RFC 6238 test vectors", () => {
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totpCode(secret, 59_000, 30, 8)).toBe("94287082");
    expect(totpCode(secret, 1111111109_000, 30, 8)).toBe("07081804");
    expect(totpCode(secret, 20000000000_000, 30, 8)).toBe("65353130");
  });

  it("round-trips base32", () => {
    const buf = Buffer.from([0, 1, 2, 250, 255, 128, 64]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
  });

  it("accepts the current code and one step of drift, rejects others", () => {
    const s = generateTotpSecret();
    const t = 1_800_000_000_000;
    expect(verifyTotp(s, totpCode(s, t), t)).toBe(true);
    expect(verifyTotp(s, totpCode(s, t - 30_000), t)).toBe(true);
    expect(verifyTotp(s, totpCode(s, t - 120_000), t)).toBe(false);
    expect(verifyTotp(s, "abc", t)).toBe(false);
  });
});

describe("passwords [REQ-11.300]", () => {
  it("hashes and verifies", async () => {
    const h = await hashPassword("correct horse 42 battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse 42 battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });

  it("enforces a minimum policy", () => {
    expect(passwordProblems("short1")).not.toEqual([]);
    expect(passwordProblems("longenoughbutnodigits")).not.toEqual([]);
    expect(passwordProblems("long enough 12345")).toEqual([]);
  });
});

describe("canonical JSON", () => {
  it("is independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe(
      canonicalJson({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }),
    );
  });
});
