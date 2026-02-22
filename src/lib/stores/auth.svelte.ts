import { createAuthClient } from "better-auth/svelte";
import { clearLocalAuthParams, clearLocalVault } from "$lib/db";
import { lock } from "./crypto.svelte";
import { vaultState } from "./vault.svelte";

export const authClient = createAuthClient();

export const authState = $state({
  isLoading: true,
  session: null as (typeof authClient.$Infer.Session)["session"] | null,
  user: null as (typeof authClient.$Infer.Session)["user"] | null,
});

export async function initAuth() {
  try {
    const { data } = await authClient.getSession();
    authState.session = data?.session ?? null;
    authState.user = data?.user ?? null;
  } catch (e) {
    console.error("Failed to init auth", e);
    authState.session = null;
    authState.user = null;
  } finally {
    authState.isLoading = false;
  }
}

export async function logout() {
  // 1. Clear server session
  // Wrapped in try-catch so network/offline errors don't block local logout
  try {
    await authClient.signOut();
  } catch (e) {
    console.error("Server signout failed or offline", e);
  }

  // 2. Clear local data (Security requirement)
  try {
    await clearLocalAuthParams();
    await clearLocalVault();
  } catch (e) {
    console.error("Failed to clear local DB", e);
  }

  // 3. Reset memory state
  lock(); // Clears DEK and isUnlocked
  vaultState.accounts = [];
  vaultState.baseSnapshot = [];
  vaultState.lastVersion = 0;
  vaultState.syncStatus = "idle";

  // 4. Clear auth state
  authState.session = null;
  authState.user = null;
}
