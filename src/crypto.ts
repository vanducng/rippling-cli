import { webcrypto as wc } from "node:crypto";

const subtle = wc.subtle;

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.trim().replace(/\s+/g, "");
  if (clean.length % 2 !== 0) throw new Error("odd-length hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const bytesToHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// RPass encodes plaintext as UTF-16LE (JS charCodeAt into a Uint16Array).
const utf16leEncode = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "utf16le"));
const utf16leDecode = (b: Uint8Array): string => Buffer.from(b).toString("utf16le");

const GCM = { name: "AES-GCM" } as const;

async function aesGcmDecrypt(cipherHex: string, ivHex: string, keyHex: string): Promise<Uint8Array> {
  const key = await subtle.importKey("raw", hexToBytes(keyHex), GCM, false, ["decrypt"]);
  const plain = await subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(ivHex) }, key, hexToBytes(cipherHex));
  return new Uint8Array(plain);
}

/** Decrypt a value that RPass stored as a hex string (keys, nested item keys). */
export const decryptHex = async (cipherHex: string, ivHex: string, keyHex: string): Promise<string> =>
  bytesToHex(await aesGcmDecrypt(cipherHex, ivHex, keyHex));

/** Decrypt a value that RPass stored as UTF-16LE text (item JSON payloads). */
export const decryptText = async (cipherHex: string, ivHex: string, keyHex: string): Promise<string> =>
  utf16leDecode(await aesGcmDecrypt(cipherHex, ivHex, keyHex));

/**
 * PBKDF2-SHA256 → 32-byte key as hex. Password is always UTF-16LE of its NFKD form;
 * salt is hex-decoded when saltIsHex, otherwise UTF-16LE (the v0 email-salt case).
 */
export async function pbkdf2Hex(
  password: string,
  salt: string,
  iterations: number,
  saltIsHex: boolean,
): Promise<string> {
  const pw = await subtle.importKey("raw", utf16leEncode(password.normalize("NFKD")), "PBKDF2", false, [
    "deriveBits",
  ]);
  const saltBytes = saltIsHex ? hexToBytes(salt) : utf16leEncode(salt);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    pw,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

/** RSA-OAEP-SHA256 unwrap of the AES broadcast key using the user's private key (both hex). */
export async function rsaUnwrapHex(wrappedHex: string, privateKeyHex: string): Promise<string> {
  const key = await subtle.importKey(
    "pkcs8",
    hexToBytes(privateKeyHex),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
  const raw = await subtle.decrypt({ name: "RSA-OAEP" }, key, hexToBytes(wrappedHex));
  return bytesToHex(new Uint8Array(raw));
}

export const encodings = { hexToBytes, bytesToHex, utf16leEncode, utf16leDecode };
