import { createHmac } from "node:crypto";

const base32Decode = (s: string): Buffer => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = s.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
};

interface TotpParams {
  secret: string;
  algorithm: string;
  digits: number;
  period: number;
}

const parseSeed = (seed: string): TotpParams => {
  const defaults = { algorithm: "SHA1", digits: 6, period: 30 };
  if (seed.startsWith("otpauth://")) {
    const u = new URL(seed);
    return {
      secret: u.searchParams.get("secret") ?? "",
      algorithm: (u.searchParams.get("algorithm") ?? defaults.algorithm).toUpperCase(),
      digits: Number(u.searchParams.get("digits") ?? defaults.digits),
      period: Number(u.searchParams.get("period") ?? defaults.period),
    };
  }
  return { secret: seed, ...defaults };
};

/** RFC 6238 TOTP from an RPass totpSeed (raw base32 or otpauth:// URL). */
export const totp = (seed: string, now = Date.now()): { code: string; expiresInSeconds: number } => {
  const { secret, algorithm, digits, period } = parseSeed(seed);
  const counter = Math.floor(now / 1000 / period);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(algorithm.replace("SHA", "sha"), base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  const code = (bin % 10 ** digits).toString().padStart(digits, "0");
  return { code, expiresInSeconds: period - Math.floor(now / 1000) % period };
};
