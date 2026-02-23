<script lang="ts">
  import {
    deriveLAK,
    generateRecoveryKey,
    deriveDEK,
    deriveREK,
    encryptVault,
    encryptKeyForRecovery,
  } from "$lib/crypto/zk-engine";
  import { goto } from "$app/navigation";
  import { authState } from "$lib/stores/auth.svelte";
  import * as m from "$paraglide/messages.js";
  import { ShieldAlert, KeyRound, Download } from "lucide-svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import { validatePasswordStrength } from "$lib/utils/password";

  function generateSalt() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  let email = $state("");
  let password = $state("");
  let confirmPassword = $state("");
  let loading = $state(false);
  let error = $state("");
  let recoveryKey = $state<string | null>(null);
  let showRecoveryKey = $state(false);
  let hasDownloadedKey = $state(false);

  const KDF_ITERATIONS = 600000;

  $effect(() => {
    if (authState.session && !authState.isLoading) {
      void goto("/");
    }
  });

  // Helper to map backend error codes to i18n messages
  function getErrorMessage(code: string): string {
    switch (code) {
      case "missing_fields":
        return m.err_missing_fields();
      case "email_exists":
        return m.err_email_exists();
      case "registration_failed":
        return m.err_registration_failed();
      default:
        return m.err_server_error();
    }
  }

  async function handleRegister() {
    loading = true;
    error = "";

    const validationError = validatePasswordStrength(password);
    if (validationError) {
      error = validationError;
      loading = false;
      return;
    }

    if (password !== confirmPassword) {
      error = m.err_passwords_mismatch();
      loading = false;
      return;
    }

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const loginSalt = generateSalt();
      const dataSalt = generateSalt();
      const lak = await deriveLAK(password, loginSalt, KDF_ITERATIONS);
      const rawRecoveryKey = generateRecoveryKey();
      const dek = await deriveDEK(password, dataSalt, KDF_ITERATIONS, true);
      const rek = await deriveREK(rawRecoveryKey, dataSalt, KDF_ITERATIONS);

      const emptyVault = JSON.stringify({ accounts: [] });
      const encryptedPayload = await encryptVault(emptyVault, dek);
      const encryptedBlob = `v=1;iv=${encryptedPayload.iv};ct=${encryptedPayload.ct}`;

      const rawDek = await crypto.subtle.exportKey("raw", dek);
      const encryptedDekPayload = await encryptKeyForRecovery(
        new Uint8Array(rawDek),
        rek,
      );
      const encryptedDekByRecoveryKey = `v=1;iv=${encryptedDekPayload.iv};ct=${encryptedDekPayload.ct}`;

      const registerRes = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          password: lak,
          loginSalt,
          dataSalt,
          kdfIterations: KDF_ITERATIONS,
          encryptedBlob,
          encryptedDekByRecoveryKey,
        }),
      });

      if (!registerRes.ok) {
        const data = await registerRes.json();
        throw new Error(getErrorMessage(data.error));
      }

      recoveryKey = rawRecoveryKey;
      showRecoveryKey = true;
    } catch (e: unknown) {
      const err = e as Error;
      error = err.message;
    } finally {
      loading = false;
    }
  }

  function handleDownloadKey() {
    if (!recoveryKey) return;
    const blob = new Blob([recoveryKey], { type: "text/plain" });
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
    {#if showRecoveryKey && recoveryKey}
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
            {recoveryKey}
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
      <div class="text-center mb-6">
        <h1 class="text-4xl font-extrabold tracking-tight text-primary">
          {m.register_title()}
        </h1>
        <p class="py-2 text-base-content/70 font-medium">
          {m.register_subtitle()}
        </p>
      </div>

      <div class="card w-full shadow-xl bg-base-100 border border-base-300">
        <form
          class="card-body"
          onsubmit={(e) => {
            e.preventDefault();
            void handleRegister();
          }}
        >
          {#if error}
            <div class="alert alert-error text-sm py-2 rounded-lg">
              <ShieldAlert size={16} />
              <span>{error}</span>
            </div>
          {/if}

          <div class="form-control">
            <label for="email" class="label">
              <span class="label-text font-medium"
                >{m.register_email_label()}</span
              >
            </label>
            <input
              id="email"
              type="email"
              bind:value={email}
              required
              class="input input-bordered focus:input-primary"
              placeholder={m.placeholder_email()}
            />
          </div>

          <div class="form-control mt-2">
            <label for="password" class="label">
              <span class="label-text font-medium"
                >{m.register_password_label()}</span
              >
            </label>
            <input
              id="password"
              type="password"
              bind:value={password}
              required
              class="input input-bordered focus:input-primary"
              placeholder={m.placeholder_password()}
            />
          </div>

          <div class="form-control mt-2">
            <label for="confirm" class="label">
              <span class="label-text font-medium"
                >{m.register_confirm_label()}</span
              >
            </label>
            <input
              id="confirm"
              type="password"
              bind:value={confirmPassword}
              required
              class="input input-bordered focus:input-primary"
              placeholder={m.placeholder_password()}
            />
          </div>

          <div class="form-control mt-6">
            <button type="submit" class="btn btn-primary" disabled={loading}>
              {#if loading}
                <span class="loading loading-spinner"></span>
              {/if}
              {loading ? m.register_creating() : m.register_button()}
            </button>
          </div>
        </form>
      </div>

      <div class="text-center mt-4">
        <a
          href="/login"
          class="link link-hover text-sm text-base-content/70 hover:text-primary"
        >
          {m.register_already_have_account()}
        </a>
      </div>
    {/if}
  </div>
</div>
