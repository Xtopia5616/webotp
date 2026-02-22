import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

/**
 * Hash a password (LAK) using scrypt.
 * Returns a string in the format "salt:derivedKeyHex".
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error("Password is required for hashing");
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

/**
 * Verify a password against a stored hash.
 * Supports scrypt format (salt:hash).
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  if (!password || !storedHash || typeof storedHash !== "string") {
    return false;
  }

  // Check if it's our scrypt format (salt:hash)
  if (!storedHash.includes(":")) {
    // If not scrypt format, it's likely bcrypt (better-auth default)
    // We cannot verify bcrypt hashes without a dedicated library
    // Cannot verify non-scrypt password hash format
    return false;
  }

  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;

  try {
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    const derivedHash = derivedKey.toString("hex");

    // Use timing-safe comparison to prevent timing attacks
    if (derivedHash.length !== hash.length) return false;
    return timingSafeEqual(Buffer.from(derivedHash), Buffer.from(hash));
  } catch {
    return false;
  }
}
