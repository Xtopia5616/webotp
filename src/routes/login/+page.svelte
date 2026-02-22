<script lang="ts">
  import { onMount } from "svelte";
  import { authClient, authState, initAuth } from "$lib/stores/auth.svelte";
  import { deriveLAK } from "$lib/crypto/zk-engine";
  import { goto } from "$app/navigation";
  import {
    setLocalAuthParams,
    setLocalVault,
    getLocalPRF,
    getLocalAuthParams,
  } from "$lib/db";
  import * as m from "$paraglide/messages.js";
  import { unlock } from "$lib/stores/vault.svelte";
  import { ShieldAlert, Fingerprint } from "lucide-svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import { assertPRF } from "$lib/crypto/prf";

  let email = $state("");
  let password = $state("");
  let loading = $state(false);
  let error = $state("");

  let hasPRF = $state(false);
  let prfLoading = $state(false);
  let prfError = $state("");
  let localParams = $state<Awaited<
    ReturnType<typeof getLocalAuthParams>
  > | null>(null);

  $effect(() => {
    if (authState.session && !authState.isLoading) {
      void goto("/");
    }
  });

  onMount(async () => {
    const prfData = await getLocalPRF();
    const params = await getLocalAuthParams();
    if (prfData && params) {
      hasPRF = true;
      localParams = params;
    }
  });

  async function handleLogin(e: Event) {
    e.preventDefault();
    loading = true;
    error = "";

    // Read directly from form to avoid autofill race condition
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const emailVal = formData.get("email") as string;
    const passwordVal = formData.get("password") as string;

    try {
      const normalizedEmail = emailVal.trim().toLowerCase();

      const res = await fetch(
        `/api/auth-params?email=${encodeURIComponent(normalizedEmail)}`,
      );

      if (!res.ok) {
        throw new Error(m.err_invalid_credentials());
      }

      const { loginSalt, dataSalt, kdfIterations } = await res.json();

      const rawLak = await deriveLAK(
        passwordVal,
        loginSalt,
        Number(kdfIterations),
      );

      const lak = rawLak.substring(0, 64);

      const signInRes = await authClient.signIn.email({
        email: normalizedEmail,
        password: lak,
      });

      if (signInRes.error) {
        throw new Error(signInRes.error.message || m.err_login_failed());
      }

      await initAuth();

      await setLocalAuthParams({
        loginSalt,
        dataSalt,
        kdfIterations: Number(kdfIterations),
        email: normalizedEmail,
      });

      const vaultRes = await fetch("/api/vault");
      if (vaultRes.ok) {
        const vaultData = await vaultRes.json();
        if (vaultData) {
          await setLocalVault({
            encryptedBlob: vaultData.encryptedBlob,
            version: vaultData.version,
            updatedAt: vaultData.updatedAt || new Date().toISOString(),
            encryptedDekByRecoveryKey: vaultData.encryptedDekByRecoveryKey,
          });
        }
      }

      try {
        await unlock(passwordVal);
      } catch (err) {
        console.error("Auto-unlock failed", err);
      }

      await goto("/");
    } catch (e: unknown) {
      const err = e as Error;
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function handlePRFLogin() {
    prfLoading = true;
    prfError = "";
    try {
      if (!localParams) {
        throw new Error(m.err_no_local_credentials());
      }

      const decryptedPassword = await assertPRF();
      const lak = await deriveLAK(
        decryptedPassword,
        localParams.loginSalt,
        localParams.kdfIterations,
      );

      const signInRes = await authClient.signIn.email({
        email: localParams.email,
        password: lak,
      });

      if (signInRes.error) {
        throw new Error(signInRes.error.message || m.err_login_failed());
      }

      await initAuth();

      // Ensure local params are up to date
      await setLocalAuthParams(localParams);

      // Fetch Vault
      const vaultRes = await fetch("/api/vault");
      if (vaultRes.ok) {
        const vaultData = await vaultRes.json();
        if (vaultData) {
          await setLocalVault({
            encryptedBlob: vaultData.encryptedBlob,
            version: vaultData.version,
            updatedAt: vaultData.updatedAt || new Date().toISOString(),
            encryptedDekByRecoveryKey: vaultData.encryptedDekByRecoveryKey,
          });
        }
      }

      // Unlock Vault
      try {
        await unlock(decryptedPassword);
      } catch (err) {
        console.error("Auto-unlock failed", err);
      }

      await goto("/");
    } catch (e) {
      const err = e as Error;
      prfError = err.message || m.err_prf_unlock_failed();
    } finally {
      prfLoading = false;
    }
  }
</script>

<div class="hero min-h-screen bg-base-200 relative">
  <div class="absolute top-4 right-4 z-50">
    <ThemeToggle />
  </div>
  <div class="hero-content flex-col w-full max-w-md">
    <div class="text-center mb-6">
      <h1 class="text-4xl font-extrabold tracking-tight text-primary">
        {m.login_title()}
      </h1>
      <p class="py-2 text-base-content/70 font-medium">{m.login_subtitle()}</p>
    </div>

    <div class="card w-full shadow-xl bg-base-100 border border-base-300">
      <form
        class="card-body"
        onsubmit={(e) => {
          void handleLogin(e);
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
            <span class="label-text font-medium">{m.login_email_label()}</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            bind:value={email}
            required
            class="input input-bordered focus:input-primary"
            placeholder={m.placeholder_email()}
            autocomplete="username"
          />
        </div>

        <div class="form-control mt-2">
          <label for="password" class="label">
            <span class="label-text font-medium"
              >{m.login_password_label()}</span
            >
          </label>
          <input
            id="password"
            name="password"
            type="password"
            bind:value={password}
            required
            class="input input-bordered focus:input-primary"
            placeholder={m.placeholder_password()}
            autocomplete="current-password"
          />
        </div>

        <div class="text-right mt-1">
          <a
            href="/recovery"
            class="link link-hover text-sm text-base-content/70 hover:text-primary"
          >
            {m.login_forgot_link()}
          </a>
        </div>

        <div class="form-control mt-4">
          <button type="submit" class="btn btn-primary" disabled={loading}>
            {#if loading}
              <span class="loading loading-spinner"></span>
            {/if}
            {loading ? m.login_unlocking() : m.login_button()}
          </button>
        </div>

        {#if hasPRF}
          <div class="divider text-base-content/40 text-sm">
            {m.vault_unlock_or()}
          </div>

          {#if prfError}
            <div class="alert alert-error text-sm py-2 rounded-lg">
              <ShieldAlert size={16} />
              <span>{prfError}</span>
            </div>
          {/if}

          <button
            type="button"
            onclick={handlePRFLogin}
            disabled={prfLoading}
            class="btn btn-outline btn-primary"
          >
            {#if prfLoading}
              <span class="loading loading-spinner"></span>
            {/if}
            <Fingerprint size={20} />
            {m.vault_unlock_biometric()}
          </button>
        {/if}
      </form>
    </div>

    <div class="text-center mt-4">
      <a
        href="/register"
        class="link link-hover text-sm text-base-content/70 hover:text-primary"
      >
        {m.login_create_link()}
      </a>
    </div>
  </div>
</div>
