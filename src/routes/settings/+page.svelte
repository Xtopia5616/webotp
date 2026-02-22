<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import {
    deriveLAK,
    deriveDEK,
    encryptVault,
    encryptKeyForRecovery,
    deriveREK,
    decryptVault,
    parseEncryptedPayload,
    generateRecoveryKey,
  } from "$lib/crypto/zk-engine";
  import {
    getLocalAuthParams,
    getLocalVault,
    getLocalPRF,
    clearLocalPRF,
    setLocalVault,
  } from "$lib/db";
  import { isPRFSupported, registerPRF, assertPRF } from "$lib/crypto/prf";
  import { cryptoState } from "$lib/stores/crypto.svelte";
  import { logout } from "$lib/stores/auth.svelte";
  import { vaultState, unlock } from "$lib/stores/vault.svelte";
  import * as m from "$paraglide/messages.js";
  import {
    ShieldAlert,
    Download,
    Fingerprint,
    KeyRound,
    Lock,
    MonitorSmartphone,
    RefreshCcw,
  } from "lucide-svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";

  let oldPassword = $state("");
  let newPassword = $state("");
  let confirmPassword = $state("");
  let loading = $state(false);
  let error = $state("");

  let prfSupported = $state(false);
  let hasPRF = $state(false);
  let prfPassword = $state("");
  let prfLoading = $state(false);
  let prfError = $state("");

  // Lock screen state
  let unlockPassword = $state("");
  let unlockLoading = $state(false);
  let unlockError = $state("");
  let hasUnlockPRF = $state(false);

  // Regenerate Recovery Key state
  let regenPassword = $state("");
  let regenLoading = $state(false);
  let regenError = $state("");
  let showRegenKey = $state(false);
  let newRecoveryKey = $state<string | null>(null);
  let hasDownloadedRegenKey = $state(false);

  // PWA Install state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let installPromptEvent = $state<any>(null);
  let isInstalled = $state(false);

  onMount(async () => {
    prfSupported = await isPRFSupported();
    const prfData = await getLocalPRF();
    hasPRF = !!prfData;
    hasUnlockPRF = !!prfData;

    // Check if already installed (standalone mode)
    if (window.matchMedia("(display-mode: standalone)").matches) {
      isInstalled = true;
    }

    // Listen for the install prompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      installPromptEvent = e;
    };

    // Listen for successful installation
    const handleAppInstalled = () => {
      isInstalled = true;
      installPromptEvent = null;
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  });

  async function handleUnlock(e: Event) {
    e.preventDefault();
    unlockLoading = true;
    unlockError = "";
    try {
      // Read directly from form to avoid autofill race condition
      const form = e.target as HTMLFormElement;
      const formData = new FormData(form);
      const password = formData.get("password") as string;

      const success = await unlock(password);
      if (!success) {
        throw new Error(cryptoState.error || m.err_invalid_password());
      }
      unlockPassword = "";
    } catch (e) {
      unlockError = (e as Error).message;
    } finally {
      unlockLoading = false;
    }
  }

  async function handlePRFUnlock() {
    unlockLoading = true;
    unlockError = "";
    try {
      const decryptedPassword = await assertPRF();
      const success = await unlock(decryptedPassword);
      if (!success) {
        throw new Error(cryptoState.error || m.err_invalid_password());
      }
    } catch (e) {
      const err = e as Error;
      unlockError = err.message || m.err_prf_unlock_failed();
    } finally {
      unlockLoading = false;
    }
  }

  async function handleEnablePRF() {
    prfLoading = true;
    prfError = "";
    try {
      if (!prfPassword) throw new Error(m.err_master_password_required());

      const params = await getLocalAuthParams();
      if (!params) throw new Error(m.err_local_auth_missing());

      const localVault = await getLocalVault();
      if (localVault && localVault.encryptedBlob) {
        const dek = await deriveDEK(
          prfPassword,
          params.dataSalt,
          params.kdfIterations,
        );
        const payload = parseEncryptedPayload(localVault.encryptedBlob);
        await decryptVault(payload, dek);
      }

      await registerPRF(prfPassword, params.email || "WebOTP User");
      hasPRF = true;
      hasUnlockPRF = true;
      prfPassword = "";
    } catch (e: unknown) {
      const err = e as Error;
      prfError = err.message || m.err_enable_prf_failed();
    } finally {
      prfLoading = false;
    }
  }

  async function handleDisablePRF() {
    await clearLocalPRF();
    hasPRF = false;
    hasUnlockPRF = false;
  }

  async function handleRegenerateKey() {
    regenLoading = true;
    regenError = "";
    try {
      if (!regenPassword) throw new Error(m.err_master_password_required());

      const params = await getLocalAuthParams();
      const localVault = await getLocalVault();

      if (!params || !localVault || !localVault.encryptedBlob) {
        throw new Error(m.err_vault_locked());
      }

      // 1. Verify password and get extractable DEK
      const dek = await deriveDEK(
        regenPassword,
        params.dataSalt,
        params.kdfIterations,
        true,
      );

      // Verify DEK by decrypting vault
      const payload = parseEncryptedPayload(localVault.encryptedBlob);
      await decryptVault(payload, dek);

      // 2. Generate new recovery key
      const rawNewRecoveryKey = generateRecoveryKey();
      const rek = await deriveREK(
        rawNewRecoveryKey,
        params.dataSalt,
        params.kdfIterations,
      );

      // 3. Encrypt DEK with new REK
      const rawDek = await crypto.subtle.exportKey("raw", dek);
      const encryptedDekPayload = await encryptKeyForRecovery(
        new Uint8Array(rawDek),
        rek,
      );
      const newEncryptedDekByRecoveryKey = `v=1;iv=${encryptedDekPayload.iv};ct=${encryptedDekPayload.ct}`;

      // 4. Update server
      const res = await fetch("/api/vault", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedBlob: localVault.encryptedBlob,
          version: vaultState.lastVersion,
          encryptedDekByRecoveryKey: newEncryptedDekByRecoveryKey,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || m.err_sync_failed());
      }

      const result = await res.json();

      // 5. Update local state
      await setLocalVault({
        encryptedBlob: localVault.encryptedBlob,
        version: result.version,
        updatedAt: new Date().toISOString(),
        encryptedDekByRecoveryKey: newEncryptedDekByRecoveryKey,
      });
      vaultState.lastVersion = result.version;

      newRecoveryKey = rawNewRecoveryKey;
      showRegenKey = true;
      regenPassword = "";
    } catch (e: unknown) {
      const err = e as Error;
      regenError = err.message || m.err_invalid_password();
    } finally {
      regenLoading = false;
    }
  }

  function handleDownloadRegenKey() {
    if (!newRecoveryKey) return;
    const blob = new Blob([newRecoveryKey], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "webotp-recovery-key.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    hasDownloadedRegenKey = true;
  }

  function handleDoneRegenKey() {
    showRegenKey = false;
    newRecoveryKey = null;
    hasDownloadedRegenKey = false;
  }

  async function handleChangePassword() {
    loading = true;
    error = "";

    if (newPassword !== confirmPassword) {
      error = m.err_new_passwords_mismatch();
      loading = false;
      return;
    }

    if (newPassword.length < 8) {
      error = m.err_password_length();
      loading = false;
      return;
    }

    try {
      const params = await getLocalAuthParams();
      const localVault = await getLocalVault();

      if (!params || !localVault || !cryptoState.dek) {
        throw new Error(m.err_vault_locked());
      }

      const oldLak = await deriveLAK(
        oldPassword,
        params.loginSalt,
        params.kdfIterations,
      );
      const newLoginSalt = Array.from(
        crypto.getRandomValues(new Uint8Array(16)),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const newDataSalt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const newLak = await deriveLAK(
        newPassword,
        newLoginSalt,
        params.kdfIterations,
      );
      const newDek = await deriveDEK(
        newPassword,
        newDataSalt,
        params.kdfIterations,
        true,
      );

      const payload = parseEncryptedPayload(localVault.encryptedBlob);
      const plaintext = await decryptVault(payload, cryptoState.dek);
      const newPayload = await encryptVault(plaintext, newDek);
      const newEncryptedBlob = `v=1;iv=${newPayload.iv};ct=${newPayload.ct}`;

      const rawDek = await crypto.subtle.exportKey("raw", newDek);
      const newRecoveryKey = Array.from(
        crypto.getRandomValues(new Uint8Array(32)),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const rek = await deriveREK(
        newRecoveryKey,
        newDataSalt,
        params.kdfIterations,
      );
      const encryptedDekPayload = await encryptKeyForRecovery(
        new Uint8Array(rawDek),
        rek,
      );
      const newEncryptedDekByRecoveryKey = `v=1;iv=${encryptedDekPayload.iv};ct=${encryptedDekPayload.ct}`;

      const res = await fetch("/api/vault/rotate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldLak,
          newLak,
          newLoginSalt,
          newDataSalt,
          newEncryptedBlob,
          newEncryptedDekByRecoveryKey,
          version: localVault.version,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || m.err_update_password_failed());
      }

      const { setLocalAuthParams, setLocalVault } = await import("$lib/db");
      await setLocalAuthParams({
        ...params,
        loginSalt: newLoginSalt,
        dataSalt: newDataSalt,
      });
      await setLocalVault({
        encryptedBlob: newEncryptedBlob,
        version: localVault.version + 1,
        updatedAt: new Date().toISOString(),
      });

      await clearLocalPRF();
      hasPRF = false;
      hasUnlockPRF = false;

      alert(m.success_password_changed({ key: newRecoveryKey }));
      await logout();
      await goto("/login");
    } catch (e: unknown) {
      const err = e as Error;
      error = err.message;
    } finally {
      loading = false;
    }
  }

  function handleExport() {
    if (!vaultState.accounts || vaultState.accounts.length === 0) {
      alert(m.err_no_data_export());
      return;
    }
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts: vaultState.accounts,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `webotp-backup-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleInstall() {
    if (installPromptEvent) {
      installPromptEvent.prompt();
      const { outcome } = await installPromptEvent.userChoice;
      if (outcome === "accepted") {
        installPromptEvent = null;
      }
    } else {
      alert(m.settings_install_fallback());
    }
  }
</script>

<div class="hero min-h-screen bg-base-200 py-10 relative">
  <div class="absolute top-4 right-4 z-50">
    <ThemeToggle />
  </div>
  <div class="hero-content flex-col w-full max-w-lg">
    {#if !cryptoState.isUnlocked}
      <div class="text-center mb-4">
        <div
          class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4"
        >
          <Lock size={32} />
        </div>
        <h1 class="text-3xl font-bold">{m.vault_locked_title()}</h1>
        <p class="py-2 text-base-content/70">
          {m.vault_locked_subtitle()}
          <br />
          <span class="text-xs opacity-75">{m.vault_locked_hint()}</span>
        </p>
      </div>

      <div class="card w-full shadow-xl bg-base-100 border border-base-300">
        <form
          class="card-body"
          onsubmit={(e) => {
            void handleUnlock(e);
          }}
        >
          {#if unlockError}
            <div class="alert alert-error text-sm py-2 rounded-lg">
              <span>{unlockError}</span>
            </div>
          {/if}

          <div class="form-control">
            <input
              name="password"
              type="password"
              bind:value={unlockPassword}
              class="input input-bordered input-lg text-center tracking-widest focus:input-primary"
              placeholder={m.placeholder_password()}
              required
              autocomplete="current-password"
            />
          </div>

          <div class="form-control mt-4">
            <button
              type="submit"
              class="btn btn-primary btn-lg"
              disabled={unlockLoading}
            >
              {#if unlockLoading}
                <span class="loading loading-spinner"></span>
              {/if}
              {m.vault_unlock_button()}
            </button>
          </div>

          {#if hasUnlockPRF}
            <div class="divider text-base-content/40 text-sm">
              {m.vault_unlock_or()}
            </div>
            <button
              type="button"
              onclick={handlePRFUnlock}
              disabled={unlockLoading}
              class="btn btn-outline btn-primary"
            >
              <Fingerprint size={20} />
              {m.vault_unlock_biometric()}
            </button>
          {/if}
        </form>
      </div>

      <div class="text-center mt-4">
        <a
          href="/recovery"
          class="link link-hover text-sm text-base-content/70 hover:text-primary"
        >
          {m.login_forgot_link()}
        </a>
      </div>
    {:else if showRegenKey && newRecoveryKey}
      <div class="card w-full shadow-xl bg-base-100 border border-base-300">
        <div class="card-body items-center text-center">
          <div
            class="w-16 h-16 bg-warning/20 text-warning rounded-full flex items-center justify-center mb-2"
          >
            <KeyRound size={32} />
          </div>
          <h2 class="card-title text-2xl">{m.register_recovery_title()}</h2>
          <p class="text-sm text-error font-bold mt-2">
            {m.register_recovery_description()}
          </p>

          <div
            class="w-full p-4 bg-base-200 rounded-lg font-mono text-sm break-all select-all my-6 border border-base-300"
          >
            {newRecoveryKey}
          </div>

          <div class="flex flex-col gap-3 w-full">
            <button
              onclick={handleDownloadRegenKey}
              class="btn btn-outline btn-secondary w-full"
            >
              <Download size={18} />
              {m.register_download_key()}
            </button>
            <button
              onclick={handleDoneRegenKey}
              class="btn btn-primary w-full"
              disabled={!hasDownloadedRegenKey}
            >
              {m.register_recovery_done()}
            </button>
          </div>
        </div>
      </div>
    {:else}
      <div class="text-center mb-4">
        <h1 class="text-3xl font-extrabold tracking-tight text-primary">
          {m.settings_title()}
        </h1>
        <p class="py-2 text-base-content/70 font-medium">
          {m.settings_subtitle()}
        </p>
      </div>

      <div class="card w-full shadow-xl bg-base-100 border border-base-300">
        <div class="card-body p-6">
          <!-- Password Change Section -->
          <div class="flex items-center gap-2 mb-3">
            <KeyRound size={20} class="text-primary" />
            <h2 class="card-title text-lg">
              {m.settings_change_password_title()}
            </h2>
          </div>

          <form
            onsubmit={(e) => {
              e.preventDefault();
              void handleChangePassword();
            }}
            class="space-y-4"
          >
            {#if error}
              <div class="alert alert-error text-sm py-2 rounded-lg">
                <ShieldAlert size={16} />
                <span>{error}</span>
              </div>
            {/if}

            <div class="form-control">
              <label for="old" class="label"
                ><span class="label-text"
                  >{m.settings_old_password_label()}</span
                ></label
              >
              <input
                id="old"
                type="password"
                bind:value={oldPassword}
                required
                class="input input-bordered focus:input-primary"
              />
            </div>
            <div class="form-control">
              <label for="new" class="label"
                ><span class="label-text"
                  >{m.settings_new_password_label()}</span
                ></label
              >
              <input
                id="new"
                type="password"
                bind:value={newPassword}
                required
                class="input input-bordered focus:input-primary"
              />
            </div>
            <div class="form-control">
              <label for="confirm" class="label"
                ><span class="label-text">{m.settings_confirm_label()}</span
                ></label
              >
              <input
                id="confirm"
                type="password"
                bind:value={confirmPassword}
                required
                class="input input-bordered focus:input-primary"
              />
            </div>
            <button
              type="submit"
              class="btn btn-primary w-full"
              disabled={loading}
            >
              {#if loading}<span class="loading loading-spinner loading-xs"
                ></span>{/if}
              {m.settings_change_button()}
            </button>
          </form>

          <div class="divider my-4"></div>

          <!-- Biometric Unlock Section -->
          <div class="flex items-center gap-2 mb-3">
            <Fingerprint size={20} class="text-primary" />
            <h2 class="card-title text-lg">{m.settings_prf_title()}</h2>
          </div>
          <p class="text-sm text-base-content/70 mb-4">
            {m.settings_prf_desc()}
          </p>

          {#if !prfSupported}
            <div class="alert alert-warning text-sm py-2 rounded-lg">
              <span>{m.settings_prf_unsupported()}</span>
            </div>
          {:else if hasPRF}
            <button
              type="button"
              onclick={handleDisablePRF}
              class="btn btn-error btn-outline w-full"
            >
              {m.settings_prf_disable()}
            </button>
          {:else}
            <form
              onsubmit={(e) => {
                e.preventDefault();
                void handleEnablePRF();
              }}
              class="flex flex-col gap-4"
            >
              {#if prfError}
                <div class="alert alert-error text-sm py-2 rounded-lg">
                  <span>{prfError}</span>
                </div>
              {/if}
              <div class="form-control">
                <input
                  type="password"
                  bind:value={prfPassword}
                  placeholder={m.settings_old_password_label()}
                  required
                  class="input input-bordered focus:input-primary"
                />
              </div>
              <button
                type="submit"
                class="btn btn-primary w-full"
                disabled={prfLoading}
              >
                {#if prfLoading}<span class="loading loading-spinner loading-xs"
                  ></span>{/if}
                {m.settings_prf_enable()}
              </button>
            </form>
          {/if}

          <div class="divider my-4"></div>

          <!-- Regenerate Recovery Key Section -->
          <div class="flex items-center gap-2 mb-3">
            <RefreshCcw size={20} class="text-primary" />
            <h2 class="card-title text-lg">{m.settings_regen_title()}</h2>
          </div>
          <p class="text-sm text-base-content/70 mb-4">
            {m.settings_regen_desc()}
          </p>

          <form
            onsubmit={(e) => {
              e.preventDefault();
              void handleRegenerateKey();
            }}
            class="flex flex-col gap-4"
          >
            {#if regenError}
              <div class="alert alert-error text-sm py-2 rounded-lg">
                <span>{regenError}</span>
              </div>
            {/if}
            <div class="form-control">
              <input
                type="password"
                bind:value={regenPassword}
                placeholder={m.settings_old_password_label()}
                required
                class="input input-bordered focus:input-primary"
              />
            </div>
            <button
              type="submit"
              class="btn btn-primary w-full"
              disabled={regenLoading}
            >
              {#if regenLoading}<span class="loading loading-spinner loading-xs"
                ></span>{/if}
              {m.settings_regen_button()}
            </button>
          </form>

          <div class="divider my-4"></div>

          <!-- PWA Install Section -->
          <div class="flex items-center gap-2 mb-3">
            <MonitorSmartphone size={20} class="text-primary" />
            <h2 class="card-title text-lg">{m.settings_install_title()}</h2>
          </div>
          <p class="text-sm text-base-content/70 mb-4">
            {m.settings_install_description()}
          </p>

          {#if isInstalled}
            <div class="alert alert-success text-sm py-2 rounded-lg">
              <span>{m.settings_install_installed()}</span>
            </div>
          {:else}
            <button
              type="button"
              onclick={handleInstall}
              class="btn btn-primary w-full"
            >
              <Download size={18} />
              {m.settings_install_button()}
            </button>
            {#if !installPromptEvent}
              <p class="text-xs text-base-content/50 mt-2 text-center">
                {m.settings_install_fallback()}
              </p>
            {/if}
          {/if}

          <div class="divider my-4"></div>

          <!-- Data Export Section -->
          <div class="flex items-center gap-2 mb-3">
            <Download size={20} class="text-error" />
            <h2 class="card-title text-lg text-error">
              {m.settings_export_title()}
            </h2>
          </div>
          <p class="text-sm text-base-content/70 mb-3">
            {m.settings_export_description()}
          </p>
          <button
            type="button"
            onclick={handleExport}
            class="btn btn-outline btn-error w-full"
          >
            {m.settings_export_button()}
          </button>
        </div>
      </div>

      <div class="text-center mt-4">
        <a
          href="/"
          class="link link-hover text-sm text-base-content/70 hover:text-primary"
        >
          {m.settings_back_link()}
        </a>
      </div>
    {/if}
  </div>
</div>
