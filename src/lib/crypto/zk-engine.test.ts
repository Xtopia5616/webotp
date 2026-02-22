import { describe, it, expect, beforeEach } from "vitest";
import {
  deriveLAK,
  deriveDEK,
  encryptVault,
  decryptVault,
  wipeMemory,
  generateRecoveryKey,
  deriveREK,
  encryptKeyForRecovery,
  decryptKeyForRecovery,
  stringToBuffer,
  bufferToString,
} from "./zk-engine";

describe("Zero-Knowledge Engine", () => {
  const mockPassword = "MySecretPassword123!";
  const mockSalt = "salt_" + Math.random().toString(36).substring(2);
  const iterations = 100000; // Lower for test speed, prod uses 600k

  describe("deriveLAK", () => {
    it("should derive a 64-character string", async () => {
      const lak = await deriveLAK(mockPassword, mockSalt, iterations);
      expect(lak).toHaveLength(64);
      expect(typeof lak).toBe("string");
    });

    it("should produce the same key for the same inputs", async () => {
      const lak1 = await deriveLAK(mockPassword, mockSalt, iterations);
      const lak2 = await deriveLAK(mockPassword, mockSalt, iterations);
      expect(lak1).toBe(lak2);
    });

    it("should produce different keys for different passwords", async () => {
      const lak1 = await deriveLAK(mockPassword, mockSalt, iterations);
      const lak2 = await deriveLAK("WrongPassword", mockSalt, iterations);
      expect(lak1).not.toBe(lak2);
    });
  });

  describe("deriveDEK", () => {
    it("should derive a valid CryptoKey", async () => {
      const dek = await deriveDEK(mockPassword, mockSalt, iterations);
      expect(dek).toBeDefined();
      expect(dek.type).toBe("secret");
      // @ts-expect-error checking internal property for test
      expect(dek.extractable).toBe(false);
    });

    it("should derive an extractable key if requested", async () => {
      const dek = await deriveDEK(mockPassword, mockSalt, iterations, true);
      // @ts-expect-error checking internal property for test
      expect(dek.extractable).toBe(true);
    });
  });

  describe("Vault Encryption & Decryption", () => {
    const plaintext = JSON.stringify({
      accounts: [{ id: 1, secret: "JBSWY3DPEHPK3PXP" }],
    });
    let dek: CryptoKey;

    beforeEach(async () => {
      dek = await deriveDEK(mockPassword, mockSalt, iterations);
    });

    it("should encrypt data and return valid payload structure", async () => {
      const payload = await encryptVault(plaintext, dek);
      expect(payload).toHaveProperty("iv");
      expect(payload).toHaveProperty("ct");
      expect(payload.iv.length).toBeGreaterThan(0);
      expect(payload.ct.length).toBeGreaterThan(0);
    });

    it("should decrypt data correctly", async () => {
      const payload = await encryptVault(plaintext, dek);
      const decrypted = await decryptVault(payload, dek);
      expect(decrypted).toBe(plaintext);
    });

    it("should fail decryption with a different key", async () => {
      const payload = await encryptVault(plaintext, dek);
      const wrongDek = await deriveDEK("WrongPassword", mockSalt, iterations);

      await expect(decryptVault(payload, wrongDek)).rejects.toThrow(
        "Decryption failed",
      );
    });

    it("should fail decryption if ciphertext is tampered", async () => {
      const payload = await encryptVault(plaintext, dek);
      // Tamper with the ciphertext by changing the first character
      payload.ct =
        payload.ct[0] === "A"
          ? "B" + payload.ct.slice(1)
          : "A" + payload.ct.slice(1);

      await expect(decryptVault(payload, dek)).rejects.toThrow(
        "Decryption failed",
      );
    });

    it("should fail decryption if IV is tampered", async () => {
      const payload = await encryptVault(plaintext, dek);
      // Tamper with the IV by changing the first character
      payload.iv =
        payload.iv[0] === "A"
          ? "B" + payload.iv.slice(1)
          : "A" + payload.iv.slice(1);

      await expect(decryptVault(payload, dek)).rejects.toThrow();
    });
  });

  describe("Memory Safety", () => {
    it("should wipe memory by overwriting with random values", () => {
      const buffer = stringToBuffer("sensitive_data");

      wipeMemory(buffer);

      // It is theoretically possible (though extremely unlikely) for random values to match original
      // So we just check that it changed, or trust the implementation.
      // A better check: ensure it's not the same string.
      expect(bufferToString(buffer)).not.toBe("sensitive_data");
    });
  });

  describe("Disaster Recovery", () => {
    it("should generate a 64-character hex recovery key", () => {
      const rk = generateRecoveryKey();
      expect(rk).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(rk)).toBe(true);
    });

    it("should derive a valid REK", async () => {
      const rk = generateRecoveryKey();
      const rek = await deriveREK(rk, mockSalt, iterations);
      expect(rek).toBeDefined();
      expect(rek.type).toBe("secret");
    });

    it("should encrypt and decrypt a raw key (DEK backup simulation)", async () => {
      const rk = generateRecoveryKey();
      const rek = await deriveREK(rk, mockSalt, iterations);

      // Simulate a raw DEK (32 bytes for AES-256)
      const rawDek = new Uint8Array(32);
      crypto.getRandomValues(rawDek);

      const payload = await encryptKeyForRecovery(rawDek, rek);
      const decryptedRawDek = await decryptKeyForRecovery(payload, rek);

      expect(decryptedRawDek).toEqual(rawDek);
    });

    it("should fail recovery decryption with wrong recovery key", async () => {
      const rk1 = generateRecoveryKey();
      const rek = await deriveREK(rk1, mockSalt, iterations);

      const rawDek = new Uint8Array(32);
      const payload = await encryptKeyForRecovery(rawDek, rek);

      const rk2 = generateRecoveryKey(); // Different key
      const wrongRek = await deriveREK(rk2, mockSalt, iterations);

      await expect(decryptKeyForRecovery(payload, wrongRek)).rejects.toThrow(
        "Recovery key decryption failed",
      );
    });
  });
});
