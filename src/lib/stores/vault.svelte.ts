import { getLocalVault, setLocalVault } from "$lib/db";
import {
  decryptVault,
  encryptVault,
  type EncryptedPayload,
} from "$lib/crypto/zk-engine";
import {
  cryptoState,
  unlock as cryptoUnlock,
  lock as cryptoLock,
} from "./crypto.svelte";
import { mergeVault } from "$lib/merge";
import { browser } from "$app/environment";
import * as m from "$paraglide/messages.js";

export interface Account {
  id: string;
  issuer: string;
  name: string;
  secret: string;
  algorithm?: string;
  digits?: number;
  period?: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

// API Response Types
interface VaultApiResponse {
  id: string;
  userId: string;
  encryptedBlob: string | null;
  version: number;
  updatedAt: string | null;
  encryptedDekByRecoveryKey: string | null;
}

interface SyncApiResponse {
  version: number;
}

interface DecryptedVaultData {
  accounts: Account[];
}

export const vaultState = $state({
  accounts: [] as Account[],
  baseSnapshot: [] as Account[], // For 3-way merge
  syncStatus: "idle" as "idle" | "dirty" | "syncing" | "conflict",
  lastVersion: 0,
  isLoading: true,
});

// Debounce helper for async functions
function debounce<A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
  delay: number,
): (...args: A) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: A) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      void fn(...args);
    }, delay);
  };
}

// Background sync to pull changes from other devices
async function backgroundSync() {
  if (!cryptoState.dek) return;
  try {
    const res = await fetch("/api/vault");
    if (!res.ok) return;
    const remoteData = (await res.json()) as VaultApiResponse;

    const localVault = await getLocalVault();
    if (!localVault) return;

    if (remoteData.version > localVault.version) {
      // Server has newer data, we must merge
      await handleConflict(remoteData);
    } else if (
      remoteData.version === localVault.version &&
      remoteData.encryptedBlob !== localVault.encryptedBlob
    ) {
      // We have local changes that didn't finish syncing to the server
      vaultState.syncStatus = "dirty";
      debouncedSync();
    }
  } catch (e) {
    console.error("Background sync failed", e);
  }
}

// Sync logic
async function sync() {
  if (!cryptoState.dek || vaultState.syncStatus === "syncing") return;

  vaultState.syncStatus = "syncing";

  try {
    // 1. Push local changes
    const dataToEncrypt = JSON.stringify({ accounts: vaultState.accounts });
    const payload = await encryptVault(dataToEncrypt, cryptoState.dek);
    const blob = `v=1;iv=${payload.iv};ct=${payload.ct}`;

    const res = await fetch("/api/vault", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        encryptedBlob: blob,
        version: vaultState.lastVersion,
      }),
    });

    if (res.status === 412) {
      // Conflict! Need to merge.
      await handleConflict();
      return;
    }

    if (!res.ok) {
      throw new Error(m.err_sync_failed());
    }

    const rawData: unknown = await res.json();
    const data = rawData as SyncApiResponse;
    vaultState.lastVersion = data.version;
    vaultState.baseSnapshot = JSON.parse(JSON.stringify(vaultState.accounts)); // Update base snapshot

    const localVault = await getLocalVault();
    await setLocalVault({
      encryptedBlob: blob,
      version: data.version,
      updatedAt: new Date().toISOString(),
      encryptedDekByRecoveryKey: localVault?.encryptedDekByRecoveryKey || null,
    });

    vaultState.syncStatus = "idle";
  } catch {
    vaultState.syncStatus = "dirty"; // Retry later
  }
}

async function handleConflict(prefetchedRemote?: VaultApiResponse) {
  if (!cryptoState.dek) return;

  // 1. Fetch remote if not provided
  let remoteData = prefetchedRemote;
  if (!remoteData) {
    const res = await fetch("/api/vault");
    if (!res.ok) throw new Error(m.err_fetch_remote_vault());
    remoteData = (await res.json()) as VaultApiResponse;
  }

  // Check if remote vault is empty
  if (!remoteData.encryptedBlob) {
    await sync(); // Force push
    return;
  }

  // 2. Decrypt remote
  const parts = remoteData.encryptedBlob.split(";");
  const ivPart = parts.find((p) => p.startsWith("iv="));
  const ctPart = parts.find((p) => p.startsWith("ct="));
  if (!ivPart || !ctPart) throw new Error(m.err_invalid_remote_format());

  const remotePayload: EncryptedPayload = {
    iv: ivPart.replace("iv=", ""),
    ct: ctPart.replace("ct=", ""),
  };

  const remoteJson = await decryptVault(remotePayload, cryptoState.dek);
  const remoteParsed: unknown = JSON.parse(remoteJson);
  const remoteAccounts = (remoteParsed as DecryptedVaultData).accounts || [];

  // 3. Perform 3-way merge
  const merged = mergeVault(
    vaultState.baseSnapshot,
    vaultState.accounts,
    remoteAccounts,
  );

  // Check if we actually had local changes before the merge
  const hadLocalChanges =
    JSON.stringify(vaultState.accounts) !==
    JSON.stringify(vaultState.baseSnapshot);

  // 4. Update local state with merged result
  vaultState.accounts = merged;
  vaultState.lastVersion = remoteData.version; // Update version to remote's current
  vaultState.baseSnapshot = JSON.parse(JSON.stringify(merged));

  // 5. Save merged locally
  if (!hadLocalChanges) {
    // If we didn't have local changes, the merge result is identical to the remote data.
    // We can just adopt the remote blob directly without pushing a new one.
    const localVault = await getLocalVault();
    await setLocalVault({
      encryptedBlob: remoteData.encryptedBlob,
      version: remoteData.version,
      updatedAt: remoteData.updatedAt ?? new Date().toISOString(),
      encryptedDekByRecoveryKey:
        localVault?.encryptedDekByRecoveryKey ||
        remoteData.encryptedDekByRecoveryKey ||
        null,
    });
    vaultState.syncStatus = "idle";
  } else {
    // We had local changes, so we need to re-encrypt and push the merged result
    await saveVault();
  }
}

const debouncedSync = debounce(sync, 2000);

export async function loadVault() {
  if (!cryptoState.dek) return;

  let localVault = await getLocalVault();

  // If no local vault found, try to fetch from server (e.g., new device login)
  if (!localVault) {
    try {
      const res = await fetch("/api/vault");
      if (res.ok) {
        const serverData = (await res.json()) as VaultApiResponse;
        // If server has data, save it locally first
        if (serverData.encryptedBlob) {
          await setLocalVault({
            encryptedBlob: serverData.encryptedBlob,
            version: serverData.version,
            updatedAt: serverData.updatedAt ?? new Date().toISOString(),
            encryptedDekByRecoveryKey: serverData.encryptedDekByRecoveryKey,
          });
          localVault = await getLocalVault(); // Re-read from IDB
        } else {
          // Server has no data (new user), set version to 0
          vaultState.accounts = [];
          vaultState.lastVersion = 0;
          vaultState.isLoading = false;
          return;
        }
      }
    } catch (e) {
      console.error("Failed to fetch vault from server", e);
      // Proceed with empty state if offline or error
      vaultState.accounts = [];
      vaultState.lastVersion = 0;
      vaultState.isLoading = false;
      return;
    }
  }

  // If still no local vault (e.g. offline new user), return empty
  if (!localVault) {
    vaultState.accounts = [];
    vaultState.lastVersion = 0;
    vaultState.isLoading = false;
    return;
  }

  // If blob is null/empty (shouldn't happen if logic above works, but safety check)
  if (!localVault.encryptedBlob) {
    vaultState.accounts = [];
    vaultState.lastVersion = localVault.version || 0;
    vaultState.isLoading = false;
    return;
  }

  try {
    const parts = localVault.encryptedBlob.split(";");
    const ivPart = parts.find((p) => p.startsWith("iv="));
    const ctPart = parts.find((p) => p.startsWith("ct="));

    if (!ivPart || !ctPart) throw new Error(m.err_invalid_format());

    const payload: EncryptedPayload = {
      iv: ivPart.replace("iv=", ""),
      ct: ctPart.replace("ct=", ""),
    };

    const decryptedJson = await decryptVault(payload, cryptoState.dek);
    const rawData: unknown = JSON.parse(decryptedJson);
    const data = rawData as DecryptedVaultData;

    vaultState.accounts = data.accounts || [];
    vaultState.baseSnapshot = JSON.parse(JSON.stringify(data.accounts || []));
    vaultState.lastVersion = localVault.version;
    vaultState.syncStatus = "idle";
  } catch {
    // Failed to load vault — likely wrong key or corrupted data
    vaultState.accounts = [];
    vaultState.lastVersion = 0;
    cryptoLock(); // Re-lock the vault immediately
    throw new Error(m.err_invalid_password_or_corrupted());
  } finally {
    vaultState.isLoading = false;
  }

  // Trigger background sync to catch any updates from other devices
  if (browser && navigator.onLine) {
    void backgroundSync();
  }
}

export async function saveVault() {
  if (!cryptoState.dek) {
    throw new Error(m.err_vault_locked_save());
  }

  const dataToEncrypt = JSON.stringify({ accounts: vaultState.accounts });
  const payload = await encryptVault(dataToEncrypt, cryptoState.dek);

  const blob = `v=1;iv=${payload.iv};ct=${payload.ct}`;

  const localVault = await getLocalVault();
  await setLocalVault({
    encryptedBlob: blob,
    version: vaultState.lastVersion,
    updatedAt: new Date().toISOString(),
    encryptedDekByRecoveryKey: localVault?.encryptedDekByRecoveryKey || null,
  });

  vaultState.syncStatus = "dirty";

  // Trigger sync (debounced)
  if (browser) {
    debouncedSync();
  }
}

/**
 * Unlocks the vault by delegating to the crypto engine (which handles security listeners)
 * and then loading the data.
 */
export async function unlock(masterPassword: string) {
  // 1. Use crypto engine to unlock (derives DEK, sets up auto-lock listeners)
  const success = await cryptoUnlock(masterPassword);
  if (!success) {
    throw new Error(cryptoState.error || m.err_unlock_failed());
  }

  // 2. Load vault data
  await loadVault();

  // 3. Initialize empty vault blob if missing
  // This ensures that future offline unlocks have a ciphertext to verify the password against.
  const localVault = await getLocalVault();
  if (!localVault || !localVault.encryptedBlob) {
    await saveVault();
  }
}

/**
 * Adds a new account to the vault.
 */
export async function addAccount(
  account: Omit<Account, "id" | "createdAt" | "updatedAt">,
) {
  const newAccount: Account = {
    ...account,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  vaultState.accounts.push(newAccount);
  await saveVault();
}

/**
 * Adds multiple accounts to the vault efficiently.
 */
export async function addAccounts(
  newAccounts: Omit<Account, "id" | "createdAt" | "updatedAt">[],
) {
  const now = new Date().toISOString();
  const accountsToAdd = newAccounts.map((acc) => ({
    ...acc,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }));

  vaultState.accounts.push(...accountsToAdd);
  await saveVault();
}

/**
 * Updates an existing account in the vault.
 */
export async function updateAccount(
  id: string,
  updates: Partial<
    Omit<Account, "id" | "createdAt" | "updatedAt" | "deletedAt">
  >,
) {
  const index = vaultState.accounts.findIndex((a) => a.id === id);
  if (index !== -1) {
    vaultState.accounts[index] = {
      ...vaultState.accounts[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await saveVault();
  }
}

/**
 * Soft deletes an account from the vault.
 */
export async function deleteAccount(id: string) {
  const index = vaultState.accounts.findIndex((a) => a.id === id);
  if (index !== -1) {
    vaultState.accounts[index].deletedAt = new Date().toISOString();
    vaultState.accounts[index].updatedAt = new Date().toISOString();
    await saveVault();
  }
}

// Setup listeners to automatically sync when the app comes back online or into focus
if (browser) {
  window.addEventListener("online", () => {
    if (cryptoState.isUnlocked) void backgroundSync();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && cryptoState.isUnlocked) {
      void backgroundSync();
    }
  });
}
