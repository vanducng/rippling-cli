import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto as wc } from "node:crypto";
import { decryptHex, decryptText, pbkdf2Hex, encodings } from "./crypto.ts";

const { bytesToHex, utf16leEncode } = encodings;

// Round-trip AES-256-GCM encrypt (via node) then decrypt (via our helpers),
// proving the hex/UTF-16LE boundary and IV handling match the extension's scheme.
test("aes-gcm decrypt round-trips both hex and text payloads", async () => {
  const key = wc.getRandomValues(new Uint8Array(32));
  const iv = wc.getRandomValues(new Uint8Array(12));
  const keyHex = bytesToHex(key);
  const ivHex = bytesToHex(iv);
  const ck = await wc.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);

  const secretText = JSON.stringify({ username: "a@b.com", password: "p@ss wörd" });
  const ctText = new Uint8Array(
    await wc.subtle.encrypt({ name: "AES-GCM", iv }, ck, utf16leEncode(secretText)),
  );
  assert.equal(await decryptText(bytesToHex(ctText), ivHex, keyHex), secretText);

  const innerKeyHex = bytesToHex(wc.getRandomValues(new Uint8Array(32)));
  const ctHex = new Uint8Array(
    await wc.subtle.encrypt({ name: "AES-GCM", iv }, ck, Buffer.from(innerKeyHex, "hex")),
  );
  assert.equal(await decryptHex(bytesToHex(ctHex), ivHex, keyHex), innerKeyHex);
});

// RFC-style determinism: same inputs → same key, and saltIsHex changes the result.
test("pbkdf2 is deterministic and salt encoding matters", async () => {
  const a = await pbkdf2Hex("pw", "00112233", 1000, true);
  const b = await pbkdf2Hex("pw", "00112233", 1000, true);
  const c = await pbkdf2Hex("pw", "00112233", 1000, false);
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.notEqual(a, c);
});
