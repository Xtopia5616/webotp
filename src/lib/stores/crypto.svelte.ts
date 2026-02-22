import {
  deriveDEK,
  deriveLAK,
  decryptVault,
  type EncryptedPayload,
} from "$lib/crypto/zk-engine";
import { getLocalAuthParams, getLocalVault } from "$lib/db";
import { authClient } from "$lib/stores/auth.svelte";
import * as m from "$paraglide/messages.js";

export const cryptoState = $state({
  isUnlocked: false,
  dek: null as CryptoKey | null,
  error: null as string | null,
});

let lockTimeout: ReturnType<typeof setTimeout>;
let lockPaused = false;

// Store bound handlers so we can remove them
const handleVisibilityChange = () => {
  if (document.visibilityState === "hidden") {
    if (!lockPaused) {
      lock();
    }
  }
};

const handleUserActivity = () => {
  resetLockTimer();
};

function resetLockTimer() {
  clearTimeout(lockTimeout);
  if (lockPaused) return;
  lockTimeout = setTimeout(
    () => {
      if (!lockPaused) {
        lock();
      }
    },
    5 * 60 * 1000,
  ); // 5 minutes
}

function cleanupListeners() {
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  document.removeEventListener("mousemove", handleUserActivity);
  document.removeEventListener("keydown", handleUserActivity);
  clearTimeout(lockTimeout);
}

export function lock() {
  if (lockPaused) return;
  cleanupListeners(); // Remove listeners on lock

  if (cryptoState.dek) {
    // CryptoKey objects are not directly wipeable via getRandomValues,
    // but setting reference to null allows GC.
    cryptoState.dek = null;
  }
  cryptoState.isUnlocked = false;
  // Vault locked (inactivity or manual)
}

export function pauseAutoLock() {
  lockPaused = true;
  clearTimeout(lockTimeout);
}

export function resumeAutoLock() {
  lockPaused = false;
  // Restart listeners and timer if currently unlocked
  if (cryptoState.isUnlocked) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("mousemove", handleUserActivity);
    document.addEventListener("keydown", handleUserActivity);
    resetLockTimer();
  }
}

export async function unlock(masterPassword: string): Promise<boolean> {
  const params = await getLocalAuthParams();
  if (!params) {
    cryptoState.error = m.err_no_local_credentials();
    return false;
  }

  try {
    // 1. Derive DEK
    const dek = await deriveDEK(
      masterPassword,
      params.dataSalt,
      params.kdfIterations,
    );

    // 2. Verify DEK by trying to decrypt local vault (if exists)
    const localVault = await getLocalVault();
    if (localVault && localVault.encryptedBlob) {
      const parts = localVault.encryptedBlob.split(";");
      const ivPart = parts.find((p) => p.startsWith("iv="));
      const ctPart = parts.find((p) => p.startsWith("ct="));

      if (!ivPart || !ctPart) throw new Error(m.err_invalid_vault_format());

      const payload: EncryptedPayload = {
        iv: ivPart.replace("iv=", ""),
        ct: ctPart.replace("ct=", ""),
      };

      // Attempt decryption to verify key
      await decryptVault(payload, dek);
    } else {
      // Vault is uninitialized (no encrypted blob).
      // We MUST verify the password against the server to prevent accepting a wrong password
      // and corrupting future data.

      // Fallback to session if email is missing from local params
      let userEmail = params.email;
      if (!userEmail) {
        try {
          const sessionRes = await authClient.getSession();
          if (sessionRes?.data?.user?.email) {
            userEmail = sessionRes.data.user.email;
          }
        } catch (err) {
          console.error("Failed to fetch session for email verification", err);
        }
      }

      if (!userEmail) {
        cryptoState.error = m.err_missing_email();
        return false;
      }

      if (!navigator.onLine) {
        cryptoState.error = m.err_offline_uninitialized();
        return false;
      }

      const lak = await deriveLAK(
        masterPassword,
        params.loginSalt,
        params.kdfIterations,
      );

      const signInRes = await authClient.signIn.email({
        email: userEmail,
        password: lak,
      });

      if (signInRes.error) {
        cryptoState.error = signInRes.error.message || m.err_invalid_password();
        return false;
      }
    }

    cryptoState.dek = dek;
    cryptoState.isUnlocked = true;
    cryptoState.error = null;

    // Setup auto-lock listeners
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("mousemove", handleUserActivity);
    document.addEventListener("keydown", handleUserActivity);
    resetLockTimer(); // Start the inactivity timer

    return true;
  } catch {
    cryptoState.error = m.err_invalid_password_or_corrupted();
    return false;
  }
}
