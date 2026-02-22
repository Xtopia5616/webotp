/**
 * Zero-Knowledge Cryptography Engine (zk-engine)
 *
 * Core implementation of the cryptographic primitives required for the WebOTP project.
 * Strictly follows the "Zero-Knowledge" principle: keys are derived and used locally,
 * and sensitive material is handled with memory-safety in mind.
 */

// --- Constants ---

// PBKDF2 Iterations. Recommended >= 600,000 for PBKDF2-HMAC-SHA256.
const DEFAULT_ITERATIONS = 600000;
const HASH_ALGORITHM = "SHA-256";
const AES_ALGORITHM = "AES-GCM";
const AES_KEY_LENGTH = 256;
const AES_TAG_LENGTH = 128; // bits
const IV_LENGTH = 12; // bytes (96 bits) - Standard for AES-GCM

// --- Utility Functions ---

/**
 * Converts a string to a Uint8Array (UTF-8).
 */
export function stringToBuffer(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Converts a Uint8Array to a string (UTF-8).
 */
export function bufferToString(buffer: Uint8Array): string {
  return new TextDecoder().decode(buffer);
}

/**
 * Converts a Uint8Array to a Base64 string.
 * Uses a safe loop to prevent "Maximum call stack size exceeded" on large buffers.
 */
export function bufferToBase64(buffer: Uint8Array): string {
  let binary = "";
  const len = buffer.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

/**
 * Converts a Base64 string to a Uint8Array.
 */
export function base64ToBuffer(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Security Utility: Overwrites a Uint8Array with random values to wipe sensitive data from memory.
 * This mitigates memory dumping attacks.
 *
 * @param array - The array to wipe.
 */
export function wipeMemory(array: Uint8Array): void {
  crypto.getRandomValues(array);
}

// --- Core Cryptographic Primitives ---

/**
 * Imports a raw password string into a CryptoKey object suitable for PBKDF2.
 */
async function importPasswordKey(password: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    stringToBuffer(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"],
  );
}

/**
 * Derives the Login Authentication Key (LAK).
 * Used as the "virtual password" sent to the server (Better Auth).
 *
 * Formula: Base64(PBKDF2(MP, login_salt, iterations))[0:64]
 *
 * @param masterPassword - The user's master password.
 * @param loginSalt - The salt used for authentication (stored on server).
 * @param iterations - PBKDF2 iteration count.
 * @returns A 64-character Base64 string derived from the master password.
 */
export async function deriveLAK(
  masterPassword: string,
  loginSalt: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<string> {
  const keyMaterial = await importPasswordKey(masterPassword);

  // Derive 64 bytes (512 bits) to ensure we have enough for the Base64 string
  // Base64 encodes 3 bytes into 4 chars. 64 chars need 48 bytes.
  // We derive 64 bytes to be safe and truncate later.
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: stringToBuffer(loginSalt),
      iterations: iterations,
      hash: HASH_ALGORITHM,
    },
    keyMaterial,
    512, // bits
  );

  const buffer = new Uint8Array(derivedBits);
  const base64 = bufferToBase64(buffer);

  // Wipe intermediate buffer
  wipeMemory(buffer);

  // Return first 64 characters
  return base64.slice(0, 64);
}

/**
 * Derives the Data Encryption Key (DEK).
 * This key is used to encrypt/decrypt the vault data locally.
 * It is NEVER sent to the server.
 *
 * @param masterPassword - The user's master password.
 * @param dataSalt - The salt used for data encryption (stored on server).
 * @param iterations - PBKDF2 iteration count.
 * @param extractable - Whether the key can be exported. Defaults to false for security.
 * @returns A CryptoKey object for AES-GCM encryption.
 */
export async function deriveDEK(
  masterPassword: string,
  dataSalt: string,
  iterations: number = DEFAULT_ITERATIONS,
  extractable: boolean = false,
): Promise<CryptoKey> {
  const keyMaterial = await importPasswordKey(masterPassword);

  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: stringToBuffer(dataSalt),
      iterations: iterations,
      hash: HASH_ALGORITHM,
    },
    keyMaterial,
    {
      name: AES_ALGORITHM,
      length: AES_KEY_LENGTH,
    },
    extractable,
    ["encrypt", "decrypt"],
  );
}

/**
 * Imports a raw key (Uint8Array) into a CryptoKey object for AES-GCM decryption.
 * Used during disaster recovery to import the DEK decrypted by the Recovery Key.
 *
 * @param rawKey - The raw bytes of the DEK.
 * @returns A CryptoKey object.
 */
export async function importDEK(rawKey: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: AES_ALGORITHM },
    false, // Keep it non-extractable after import
    ["decrypt"],
  );
}

// --- Vault Encryption / Decryption ---

export interface EncryptedPayload {
  iv: string; // Base64 encoded IV
  ct: string; // Base64 encoded Ciphertext
}

/**
 * Parses the standard storage format string into an EncryptedPayload object.
 * Format: "v=1;iv=...;ct=..."
 *
 * @param blob - The string to parse.
 * @returns An EncryptedPayload object.
 * @throws Error if the format is invalid.
 */
export function parseEncryptedPayload(blob: string): EncryptedPayload {
  const parts = blob.split(";");
  const ivPart = parts.find((p) => p.startsWith("iv="));
  const ctPart = parts.find((p) => p.startsWith("ct="));

  if (!ivPart || !ctPart) {
    throw new Error("Invalid encrypted payload format");
  }

  return {
    iv: ivPart.replace("iv=", ""),
    ct: ctPart.replace("ct=", ""),
  };
}

/**
 * Encrypts vault data using AES-GCM.
 *
 * @param data - The plaintext string data (JSON).
 * @param dek - The Data Encryption Key.
 * @returns An object containing the Base64 IV and Ciphertext.
 */
export async function encryptVault(
  data: string,
  dek: CryptoKey,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const dataBuffer = stringToBuffer(data);

  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: AES_ALGORITHM,
      iv: iv,
      tagLength: AES_TAG_LENGTH,
    },
    dek,
    dataBuffer,
  );

  // Wipe plaintext from memory immediately after use
  wipeMemory(dataBuffer);

  return {
    iv: bufferToBase64(iv),
    ct: bufferToBase64(new Uint8Array(encryptedBuffer)),
  };
}

/**
 * Decrypts vault data using AES-GCM.
 *
 * @param payload - The encrypted payload containing IV and Ciphertext.
 * @param dek - The Data Encryption Key.
 * @returns The decrypted plaintext string.
 * @throws Error if decryption fails (e.g., wrong key or tampered data).
 */
export async function decryptVault(
  payload: EncryptedPayload,
  dek: CryptoKey,
): Promise<string> {
  try {
    const iv = base64ToBuffer(payload.iv);
    const ct = base64ToBuffer(payload.ct);

    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: AES_ALGORITHM,
        iv: iv,
        tagLength: AES_TAG_LENGTH,
      },
      dek,
      ct,
    );

    return bufferToString(new Uint8Array(decryptedBuffer));
  } catch {
    // Security: Do not log specific crypto errors to avoid leaking info.
    // Re-throw a generic error.
    throw new Error("Decryption failed. Invalid key or corrupted data.");
  }
}

// --- Disaster Recovery ---

/**
 * Generates a high-entropy Recovery Key.
 * Format: 32 bytes (256 bits) encoded as Hex string.
 * This key allows the user to recover their vault if they forget their Master Password.
 */
export function generateRecoveryKey(): string {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  // Convert to Hex for easier transcription (64 characters)
  const hexKey = Array.from(keyBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hexKey;
}

/**
 * Derives the Recovery Encryption Key (REK).
 * This key is used to encrypt the DEK for storage on the server.
 *
 * @param recoveryKey - The hex-encoded recovery key.
 * @param dataSalt - The data salt (same used for DEK derivation).
 * @param iterations - PBKDF2 iterations.
 * @returns A CryptoKey for wrapping the DEK.
 */
export async function deriveREK(
  recoveryKey: string,
  dataSalt: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<CryptoKey> {
  // We treat the Recovery Key as the "password" for derivation
  return await deriveDEK(recoveryKey, dataSalt, iterations, true);
}

/**
 * Wraps (encrypts) the DEK using the REK.
 * This allows storing the DEK safely on the server, recoverable only with the Recovery Key.
 *
 * Note: The DEK must have been derived with `extractable: true` to be exported/wrapped,
 * OR we re-derive it temporarily for wrapping during the setup phase.
 * For this implementation, we assume the caller handles the DEK extraction logic
 * or passes the raw key bytes if the architecture allows.
 *
 * However, standard Web Crypto `wrapKey` requires the key to be extractable.
 * If DEK is non-extractable, we cannot wrap it directly.
 * Architecture Doc 2.3 says: "Encrypt current DEK using REK".
 * To support this with `extractable: false` DEKs, we would typically encrypt the *Vault* with a random
 * DEK, and encrypt that random DEK with the MP-derived key.
 * But the Architecture Doc 2.2 says DEK = PBKDF2(MP).
 * This implies the DEK is deterministic.
 * To "Encrypt DEK with REK", we essentially encrypt the *deterministic inputs* or the key bytes.
 * Since we cannot export a non-extractable key, we will implement a helper that encrypts
 * the *Master Password* or the *DEK bytes* if they were generated randomly.
 *
 * Given the strict constraint "extractable: false" for DEK in 2.2, but "Encrypt current DEK" in 2.3:
 * We will implement `encryptDekForRecovery` assuming we are encrypting the *Master Password*
 * (which allows reconstructing the DEK), OR we assume the DEK passed here is a raw key.
 * Let's stick to the most secure interpretation: We encrypt the Master Password with the REK
 * (effectively creating a "Key Encrypting Key" scenario).
 *
 * BUT, the prompt asks to "Encrypt current DEK".
 * I will implement a generic `encryptKey` function that takes raw bytes (Uint8Array) and encrypts them.
 * The caller (Phase 6 logic) will handle the nuance of extracting the DEK (if possible)
 * or encrypting the MP.
 * For Phase 2, I will provide a function to encrypt a raw key payload.
 */
export async function encryptKeyForRecovery(
  rawKeyData: Uint8Array, // The raw bytes of the key to backup
  rek: CryptoKey,
): Promise<EncryptedPayload> {
  // We can reuse the vault encryption logic for this
  // Convert raw bytes to string -> encrypt -> result
  // This is a bit hacky for binary data, but works for AES-GCM.
  // Better: Encrypt the raw buffer directly.
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: AES_ALGORITHM,
      iv: iv,
      tagLength: AES_TAG_LENGTH,
    },
    rek,
    rawKeyData,
  );

  return {
    iv: bufferToBase64(iv),
    ct: bufferToBase64(new Uint8Array(encryptedBuffer)),
  };
}

export async function decryptKeyForRecovery(
  payload: EncryptedPayload,
  rek: CryptoKey,
): Promise<Uint8Array> {
  try {
    const iv = base64ToBuffer(payload.iv);
    const ct = base64ToBuffer(payload.ct);

    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: AES_ALGORITHM,
        iv: iv,
        tagLength: AES_TAG_LENGTH,
      },
      rek,
      ct,
    );
    return new Uint8Array(decryptedBuffer);
  } catch {
    throw new Error("Recovery key decryption failed.");
  }
}
