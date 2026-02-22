import { bufferToBase64, base64ToBuffer } from "./zk-engine";
import { getLocalPRF, setLocalPRF } from "$lib/db";
import * as m from "$paraglide/messages.js";

/**
 * Checks if the browser supports WebAuthn.
 * We no longer restrict to platform authenticators only, allowing Android phones
 * (via Bluetooth/Hybrid) to be used as roaming authenticators.
 */
export async function isPRFSupported(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    return false;
  }

  // Basic check for WebAuthn support.
  // We rely on the browser to handle authenticator selection (Platform vs Roaming).
  return true;
}

/**
 * Registers a new Passkey with PRF extension and uses the derived symmetric key
 * to encrypt the Master Password. The ciphertext is stored in IndexedDB.
 */
export async function registerPRF(
  masterPassword: string,
  email: string,
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "WebOTP", id: window.location.hostname },
        user: {
          id: userId,
          name: email,
          displayName: email,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 }, // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          userVerification: "required",
          residentKey: "preferred",
          // REMOVED: authenticatorAttachment: "platform"
          // This allows the browser to list available authenticators, including
          // Android phones (via Bluetooth/Hybrid) and hardware keys.
        },
        extensions: {
          prf: {
            eval: { first: salt },
          },
        },
      },
    })) as PublicKeyCredential;

    if (!cred) throw new Error(m.err_prf_creation_failed());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extResults = cred.getClientExtensionResults() as any;
    if (
      !extResults.prf ||
      !extResults.prf.results ||
      !extResults.prf.results.first
    ) {
      throw new Error(m.err_prf_unsupported());
    }

    const prfKeyBuffer = extResults.prf.results.first;

    // Hash the PRF output to ensure it's exactly 256 bits for AES-GCM
    const prfCryptoKey = await crypto.subtle.importKey(
      "raw",
      await crypto.subtle.digest("SHA-256", prfKeyBuffer),
      { name: "AES-GCM" },
      false,
      ["encrypt"],
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ctBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      prfCryptoKey,
      new TextEncoder().encode(masterPassword),
    );

    await setLocalPRF({
      credentialId: bufferToBase64(new Uint8Array(cred.rawId)),
      salt: bufferToBase64(salt),
      iv: bufferToBase64(iv),
      ct: bufferToBase64(new Uint8Array(ctBuffer)),
    });
  } catch (e: unknown) {
    console.error("PRF Registration Error:", e);
    // Provide a more user-friendly error message for common issues
    if (e instanceof Error) {
      if (e.name === "NotAllowedError") {
        throw new Error("Passkey registration was cancelled or not allowed.");
      }
      // The specific error mentioned by the user
      if (e.message.includes("credential manager")) {
        throw new Error(
          "An unknown error occurred while talking to the credential manager. Please ensure your device has a supported authenticator (Windows Hello, Touch ID) and you are using HTTPS.",
        );
      }
      throw e;
    }
    throw new Error(m.err_prf_creation_failed());
  }
}

/**
 * Asserts the Passkey, re-derives the PRF symmetric key, and decrypts
 * the Master Password from IndexedDB.
 */
export async function assertPRF(): Promise<string> {
  const prfData = await getLocalPRF();
  if (!prfData) throw new Error(m.err_prf_not_configured());

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const salt = base64ToBuffer(prfData.salt);
  const credentialId = base64ToBuffer(prfData.credentialId);

  try {
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: [
          {
            id: credentialId,
            type: "public-key",
            // Removed transports: ["internal"] to improve compatibility
            // across different authenticators and synced passkeys.
          },
        ],
        userVerification: "required",
        extensions: {
          prf: {
            eval: { first: salt },
          },
        },
      },
    })) as PublicKeyCredential;

    if (!cred) throw new Error(m.err_prf_assertion_failed());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extResults = cred.getClientExtensionResults() as any;
    if (
      !extResults.prf ||
      !extResults.prf.results ||
      !extResults.prf.results.first
    ) {
      throw new Error(m.err_prf_assertion_missing_data());
    }

    const prfKeyBuffer = extResults.prf.results.first;

    const prfCryptoKey = await crypto.subtle.importKey(
      "raw",
      await crypto.subtle.digest("SHA-256", prfKeyBuffer),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );

    const iv = base64ToBuffer(prfData.iv);
    const ct = base64ToBuffer(prfData.ct);

    const ptBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      prfCryptoKey,
      ct,
    );

    return new TextDecoder().decode(ptBuffer);
  } catch (e: unknown) {
    console.error("PRF Assertion Error:", e);
    if (e instanceof Error) {
      if (e.name === "NotAllowedError") {
        throw new Error("Biometric verification failed or was cancelled.");
      }
      throw e;
    }
    throw new Error(m.err_prf_assertion_failed());
  }
}
