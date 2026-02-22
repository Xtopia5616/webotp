<script lang="ts">
  import {
    deriveREK,
    decryptKeyForRecovery,
    importDEK,
    decryptVault,
    deriveLAK,
    deriveDEK,
    encryptVault,
    encryptKeyForRecovery,
    generateRecoveryKey,
    parseEncryptedPayload,
  } from "$lib/crypto/zk-engine";
  import { goto } from "$app/navigation";
  import * as m from "$paraglide/messages.js";
  import { ShieldAlert, KeyRound, Download } from "lucide-svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";

  let step = $state(1);
  let email = $state("");
  let recoveryKey = $state("");
  let newPassword = $state("");
  let confirmPassword = $state("");
  let loading = $state(false);
  let error = $state("");

  let recoveryData = $state<{
    encryptedBlob: string;
    encryptedDekByRecoveryKey: string;
    dataSalt: string;
    kdfIterations: number;
    decryptedDek: CryptoKey;
    plaintextVault: string;
  } | null>(null);

  let newRecoveryKey = $state<string | null>(null);
  let showRecoveryKey = $state(false);
  let hasDownloadedKey = $state(false);

  async function handleVerifyKey() {
    loading = true;
    error = "";
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const res = await fetch(
        `/api/vault/recover?email=${encodeURIComponent(normalizedEmail)}`,
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || m.err_fetch_recovery_failed());
      }

      const data = await res.json();
      const {
        encryptedBlob,
        encryptedDekByRecoveryKey,
        dataSalt,
        kdfIterations,
      } = data;

      const rek = await deriveREK(recoveryKey, dataSalt, kdfIterations);
      const dekPayload = parseEncryptedPayload(encryptedDekByRecoveryKey);
      const rawDek = await decryptKeyForRecovery(dekPayload, rek);
      const dek = await importDEK(rawDek);

      const vaultPayload = parseEncryptedPayload(encryptedBlob);
      const plaintext = await decryptVault(vaultPayload, dek);

      recoveryData = {
        encryptedBlob,
        encryptedDekByRecoveryKey,
        dataSalt,
        kdfIterations,
        decryptedDek: dek,
        plaintextVault: plaintext,
      };
      step = 2;
    } catch (e: unknown) {
      const err = e as Error;
      error = err.message || m.err_invalid_recovery_key();
    } finally {
      loading = false;
    }
  }

  async function handleResetPassword() {
    loading = true;
    error = "";
    try {
      if (newPassword !== confirmPassword)
        throw new Error(m.err_passwords_mismatch());
      if (!recoveryData) throw new Error(m.err_session_expired());

      const normalizedEmail = email.trim().toLowerCase();
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
        recoveryData.kdfIterations,
      );
      const newDek = await deriveDEK(
        newPassword,
        newDataSalt,
        recoveryData.kdfIterations,
        true,
      );

      const newPayload = await encryptVault(
        recoveryData.plaintextVault,
        newDek,
      );
      const newEncryptedBlob = `v=1;iv=${newPayload.iv};ct=${newPayload.ct}`;

      const rawNewRecoveryKey = generateRecoveryKey();
      const rek = await deriveREK(
        rawNewRecoveryKey,
        newDataSalt,
        recoveryData.kdfIterations,
      );
      const rawDek = await crypto.subtle.exportKey("raw", newDek);
      const encryptedDekPayload = await encryptKeyForRecovery(
        new Uint8Array(rawDek),
        rek,
      );
      const newEncryptedDekByRecoveryKey = `v=1;iv=${encryptedDekPayload.iv};ct=${encryptedDekPayload.ct}`;

      const res = await fetch("/api/vault/recovery-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          newLak,
          newLoginSalt,
          newDataSalt,
          newEncryptedBlob,
          newEncryptedDekByRecoveryKey,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || m.err_reset_password_failed());
      }

      newRecoveryKey = rawNewRecoveryKey;
      showRecoveryKey = true;
    } catch (e: unknown) {
      const err = e as Error;
      error = err.message;
    } finally {
      loading = false;
    }
  }

  function handleDownloadKey() {
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
    hasDownloadedKey = true;
  }

  function handleDone() {
    void goto("/login");
  }
</script>

<div class="hero min-h-screen bg-base-200 relative">
  <div class="absolute top-4 right-4 z-50">
    <ThemeToggle />
  </div>
  <div class="hero-content flex-col w-full max-w-md">
    {#if showRecoveryKey && newRecoveryKey}
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
              onclick={handleDownloadKey}
              class="btn btn-outline btn-secondary w-full"
            >
              <Download size={18} />
              {m.register_download_key()}
            </button>
            <button
              onclick={handleDone}
              class="btn btn-primary w-full"
              disabled={!hasDownloadedKey}
            >
              {m.register_recovery_done()}
            </button>
          </div>
        </div>
      </div>
    {:else}
      <div class="text-center mb-2">
        <h1 class="text-3xl font-extrabold tracking-tight text-primary">
          {m.recovery_title()}
        </h1>
        <p class="py-2 text-base-content/70 font-medium">
          {m.recovery_subtitle()}
        </p>
      </div>

      <ul class="steps w-full mb-4">
        <li class="step step-primary text-sm font-medium">
          {m.recovery_title()}
        </li>
        <li class="step {step === 2 ? 'step-primary' : ''} text-sm font-medium">
          {m.recovery_reset_button()}
        </li>
      </ul>

      <div class="card w-full shadow-xl bg-base-100 border border-base-300">
        {#if step === 1}
          <form
            class="card-body"
            onsubmit={(e) => {
              e.preventDefault();
              void handleVerifyKey();
            }}
          >
            {#if error}
              <div class="alert alert-error text-sm py-2 rounded-lg">
                <ShieldAlert size={16} />
                <span>{error}</span>
              </div>
            {/if}

            <div class="form-control">
              <label for="email" class="label"
                ><span class="label-text font-medium"
                  >{m.recovery_email_label()}</span
                ></label
              >
              <input
                id="email"
                type="email"
                bind:value={email}
                required
                class="input input-bordered focus:input-primary"
              />
            </div>

            <div class="form-control mt-2">
              <label for="rkey" class="label"
                ><span class="label-text font-medium"
                  >{m.recovery_key_label()}</span
                ></label
              >
              <input
                id="rkey"
                type="text"
                bind:value={recoveryKey}
                required
                class="input input-bordered focus:input-primary font-mono text-sm"
                placeholder={m.placeholder_recovery_key()}
              />
            </div>

            <div class="form-control mt-6">
              <button type="submit" class="btn btn-primary" disabled={loading}>
                {#if loading}<span class="loading loading-spinner"></span>{/if}
                {loading
                  ? m.recovery_verifying()
                  : m.recovery_continue_button()}
              </button>
            </div>
          </form>
        {:else if step === 2}
          <form
            class="card-body"
            onsubmit={(e) => {
              e.preventDefault();
              void handleResetPassword();
            }}
          >
            <div class="alert alert-success text-sm py-2 rounded-lg mb-2">
              <span>{m.recovery_verified_desc()}</span>
            </div>

            {#if error}
              <div class="alert alert-error text-sm py-2 rounded-lg">
                <ShieldAlert size={16} />
                <span>{error}</span>
              </div>
            {/if}

            <div class="form-control">
              <label for="new" class="label"
                ><span class="label-text font-medium"
                  >{m.recovery_new_password_label()}</span
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

            <div class="form-control mt-2">
              <label for="confirm" class="label"
                ><span class="label-text font-medium"
                  >{m.recovery_confirm_label()}</span
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

            <div class="form-control mt-6">
              <button type="submit" class="btn btn-primary" disabled={loading}>
                {#if loading}<span class="loading loading-spinner"></span>{/if}
                {loading ? m.recovery_resetting() : m.recovery_reset_button()}
              </button>
            </div>
          </form>
        {/if}
      </div>

      <div class="text-center mt-4">
        <a
          href="/login"
          class="link link-hover text-sm text-base-content/70 hover:text-primary"
        >
          {m.recovery_back_link()}
        </a>
      </div>
    {/if}
  </div>
</div>
