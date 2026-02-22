/**
 * TOTP Generation Utility using Native Web Crypto API
 * Implements RFC 6238 (TOTP) and RFC 4226 (HOTP)
 */

/**
 * Decodes a Base32 encoded string into a Uint8Array.
 * Handles standard Base32 alphabet (A-Z, 2-7) and padding.
 */
function base32Decode(str: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  str = str.toUpperCase().replace(/\s/g, "").replace(/=+$/g, "");

  const len = str.length;
  let bits = 0;
  let value = 0;
  let index = 0;
  const output = new Uint8Array((len * 5) / 8);

  for (let i = 0; i < len; i++) {
    const val = alphabet.indexOf(str[i]);
    if (val === -1) {
      // Skip invalid characters (like spaces or dashes often found in secrets)
      continue;
    }
    value = (value << 5) | val;
    bits += 5;

    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }

  return output.slice(0, index);
}

/**
 * Encodes a Uint8Array into a Base32 string.
 */
export function base32Encode(buffer: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * Computes HMAC-SHA1.
 * @param key - The secret key buffer.
 * @param message - The message buffer (counter).
 */
async function hmacSha1(
  key: Uint8Array,
  message: Uint8Array,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );

  return await crypto.subtle.sign("HMAC", cryptoKey, message);
}

/**
 * Generates a Time-based One-Time Password (TOTP).
 *
 * @param secret - The Base32 encoded secret.
 * @param period - The time step in seconds (default 30).
 * @param digits - The number of digits in the OTP (default 6).
 * @returns The generated OTP string.
 */
export async function generateTOTP(
  secret: string,
  period: number = 30,
  digits: number = 6,
): Promise<string> {
  const secretBuffer = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / period);
  const counterBuffer = new ArrayBuffer(8);
  const counterView = new DataView(counterBuffer);
  counterView.setUint32(4, counter, false);
  const hmacResult = await hmacSha1(
    secretBuffer,
    new Uint8Array(counterBuffer),
  );
  const hmacBytes = new Uint8Array(hmacResult);
  const offset = hmacBytes[hmacBytes.length - 1] & 0x0f;
  const binary =
    ((hmacBytes[offset] & 0x7f) << 24) |
    ((hmacBytes[offset + 1] & 0xff) << 16) |
    ((hmacBytes[offset + 2] & 0xff) << 8) |
    (hmacBytes[offset + 3] & 0xff);
  const otp = binary % Math.pow(10, digits);
  return otp.toString().padStart(digits, "0");
}

/**
 * Calculates the remaining seconds in the current TOTP period.
 * @param period - The time step in seconds.
 */
export function getRemainingSeconds(period: number = 30): number {
  return period - (Math.floor(Date.now() / 1000) % period);
}

/**
 * Parses a standard otpauth:// URI into its components.
 * @param uri - The otpauth URI string.
 * @returns An object containing issuer, name, and secret, or null if invalid.
 */
export function parseOtpauthUri(
  uri: string,
): { issuer: string; name: string; secret: string } | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "otpauth:") return null;
    if (url.host !== "totp") return null;

    let name = decodeURIComponent(url.pathname.slice(1));
    let issuer = url.searchParams.get("issuer") || "";

    if (name.includes(":")) {
      const parts = name.split(":");
      if (!issuer) issuer = parts[0].trim();
      name = parts.slice(1).join(":").trim();
    }

    const secret = url.searchParams.get("secret");
    if (!secret) return null;

    return { issuer, name, secret: secret.toUpperCase() };
  } catch {
    return null;
  }
}

/**
 * Minimal Protobuf decoder specifically for Google Authenticator's otpauth-migration:// URIs.
 * Extracts the secret, name, and issuer from the payload.
 */
export function parseGoogleMigrationUri(
  uri: string,
): { issuer: string; name: string; secret: string }[] {
  try {
    const url = new URL(uri);
    let data = url.searchParams.get("data");
    if (!data) return [];

    // 修正 URL-safe Base64
    data = decodeURIComponent(data);
    let b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";

    const buffer = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

    const accounts: { issuer: string; name: string; secret: string }[] = [];
    const offset = { idx: 0 };

    const readVarint = (o: { idx: number }): number => {
      let result = 0;
      let shift = 0;
      while (true) {
        if (o.idx >= buffer.length) throw new Error("Unexpected end of buffer");
        const byte = buffer[o.idx++];
        result |= (byte & 0x7f) << shift;
        shift += 7;
        if (!(byte & 0x80)) break;
      }
      return result;
    };

    while (offset.idx < buffer.length) {
      const tag = readVarint(offset);
      const fieldNum = tag >> 3;
      const wireType = tag & 7;

      if (fieldNum === 1 && wireType === 2) {
        const length = readVarint(offset);
        const end = offset.idx + length;

        let secret = "";
        let name = "";
        let issuer = "";

        while (offset.idx < end) {
          const innerTag = readVarint(offset);
          const innerField = innerTag >> 3;
          const innerWire = innerTag & 7;

          if (innerWire === 2) {
            const innerLen = readVarint(offset);
            const fieldData = buffer.slice(offset.idx, offset.idx + innerLen);
            offset.idx += innerLen;

            if (innerField === 1) secret = base32Encode(fieldData);
            else if (innerField === 2)
              name = new TextDecoder().decode(fieldData);
            else if (innerField === 3)
              issuer = new TextDecoder().decode(fieldData);
          } else if (innerWire === 0) {
            readVarint(offset);
          } else {
            offset.idx = end;
            break;
          }
        }

        offset.idx = end;

        if (!issuer) issuer = "Unknown Issuer";
        if (!name) name = issuer;
        if (secret) accounts.push({ secret, name, issuer });
      } else {
        if (wireType === 0) readVarint(offset);
        else if (wireType === 2) offset.idx += readVarint(offset);
        else if (wireType === 5) offset.idx += 4;
        else if (wireType === 1) offset.idx += 8;
        else break;
      }
    }

    return accounts;
  } catch (e) {
    console.error("Failed to parse Google Migration URI", e);
    return [];
  }
}

/**
 * Parses various 2FA export formats (WebOTP, Aegis, 2FAS, Plain Text).
 */
export function parseImportData(
  text: string,
): { issuer: string; name: string; secret: string }[] {
  const results: { issuer: string; name: string; secret: string }[] = [];

  try {
    const data = JSON.parse(text);

    if (data.accounts && Array.isArray(data.accounts)) {
      for (const acc of data.accounts) {
        if (acc.secret) {
          results.push({
            issuer: acc.issuer || "",
            name: acc.name || "",
            secret: acc.secret,
          });
        }
      }
      return results;
    }

    if (data.db && data.db.entries && Array.isArray(data.db.entries)) {
      for (const entry of data.db.entries) {
        if (entry.info && entry.info.secret) {
          results.push({
            issuer: entry.issuer || "",
            name: entry.name || "",
            secret: entry.info.secret,
          });
        }
      }
      return results;
    }

    if (data.services && Array.isArray(data.services)) {
      for (const srv of data.services) {
        if (srv.secret) {
          results.push({
            issuer: srv.issuer?.name || srv.name || "",
            name: srv.name || "",
            secret: srv.secret,
          });
        }
      }
      return results;
    }
  } catch {
    // Ignore JSON parse errors and try line-by-line parsing
  }

  const lines = text.split(/[\r\n]+/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("otpauth://")) {
      const parsed = parseOtpauthUri(trimmed);
      if (parsed) results.push(parsed);
    } else if (trimmed.startsWith("otpauth-migration://")) {
      results.push(...parseGoogleMigrationUri(trimmed));
    }
  }

  return results;
}
