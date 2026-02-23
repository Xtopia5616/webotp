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
  import { ShieldAlert, Fingerprint, ArrowLeft } from "lucide-svelte";
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

  // State for the PRF email input flow
  let prfStep = $state<"button" | "email_input">("button");
  let prfPassword = $state<string | null>(null);
  let prfEmailInput = $state("");

  $effect(() => {
    if (authState.session && !authState.isLoading) {
      void goto("/");
    }
  });

  onMount(async () => {
    const prfData = await getLocalPRF();
    const params = await getLocalAuthParams();
    if (prfData) {
      hasPRF = true;
      if (params) {
        localParams = params;
        prfEmailInput = params.email; // Pre-fill if available
      }
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
      // Trigger Biometric prompt
      const decryptedPassword = await assertPRF();

      if (localParams) {
        // Standard flow with saved email
        const rawLak = await deriveLAK(
          decryptedPassword,
          localParams.loginSalt,
          localParams.kdfIterations,
        );
        // Fix: Ensure truncation to match registration logic
        const lak = rawLak.substring(0, 64);

        const signInRes = await authClient.signIn.email({
          email: localParams.email,
          password: lak,
        });

        if (signInRes.error) {
          throw new Error(signInRes.error.message || m.err_login_failed());
        }

        await initAuth();
        await setLocalAuthParams(localParams);

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
          await unlock(decryptedPassword);
        } catch (err) {
          console.error("Auto-unlock failed", err);
        }

        await goto("/");
      } else {
        // No local params, switch to email input UI
        prfPassword = decryptedPassword;
        prfStep = "email_input";
      }
    } catch (e) {
      const err = e as Error;
      prfError = err.message || m.err_prf_unlock_failed();
    } finally {
      prfLoading = false;
    }
  }

  async function handlePrfEmailSubmit(e: Event) {
    e.preventDefault();
    prfLoading = true;
    prfError = "";

    try {
      if (!prfPassword) {
        throw new Error(m.err_prf_expired());
      }

      const emailVal = prfEmailInput.trim().toLowerCase();

      const res = await fetch(
        `/api/auth-params?email=${encodeURIComponent(emailVal)}`,
      );

      if (!res.ok) {
        throw new Error(m.err_invalid_credentials());
      }

      const { loginSalt, dataSalt, kdfIterations } = await res.json();

      const rawLak = await deriveLAK(
        prfPassword,
        loginSalt,
        Number(kdfIterations),
      );
      const lak = rawLak.substring(0, 64);

      const signInRes = await authClient.signIn.email({
        email: emailVal,
        password: lak,
      });

      if (signInRes.error) {
        throw new Error(signInRes.error.message || m.err_login_failed());
      }

      await initAuth();

      const newParams = {
        loginSalt,
        dataSalt,
        kdfIterations: Number(kdfIterations),
        email: emailVal,
      };
      await setLocalAuthParams(newParams);

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
        await unlock(prfPassword);
      } catch (err) {
        console.error("Auto-unlock failed", err);
      }

      // Wipe temp password
      prfPassword = null;
      await goto("/");
    } catch (e) {
      const err = e as Error;
      prfError = err.message;
    } finally {
      prfLoading = false;
    }
  }

  function resetPrfFlow() {
    prfStep = "button";
    prfPassword = null;
    prfError = "";
    prfEmailInput = localParams?.email || "";
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
      <div class="card-body">
        <form onsubmit={handleLogin}>
          {#if error}
            <div class="alert alert-error text-sm py-2 rounded-lg">
              <ShieldAlert size={16} />
              <span>{error}</span>
            </div>
          {/if}

          <div class="form-control">
            <label for="email" class="label">
              <span class="label-text font-medium">{m.login_email_label()}</span
              >
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
        </form>

        {#if hasPRF}
          <div class="divider text-base-content/40 text-sm">
            {m.vault_unlock_or()}
          </div>

          {#if prfStep === "email_input"}
            <!-- Email Input Form for PRF flow -->
            <form onsubmit={handlePrfEmailSubmit}>
              <p class="text-sm text-center mb-3 text-base-content/80">
                {m.login_prf_email_prompt()}
              </p>

              {#if prfError}
                <div class="alert alert-error text-sm py-2 rounded-lg mb-3">
                  <ShieldAlert size={16} />
                  <span>{prfError}</span>
                </div>
              {/if}

              <div class="form-control">
                <input
                  type="email"
                  bind:value={prfEmailInput}
                  required
                  class="input input-bordered focus:input-primary"
                  placeholder={m.placeholder_email()}
                />
              </div>

              <div class="form-control mt-3">
                <button
                  type="submit"
                  class="btn btn-primary"
                  disabled={prfLoading}
                >
                  {#if prfLoading}
                    <span class="loading loading-spinner"></span>
                  {/if}
                  {m.login_button()}
                </button>
              </div>
              <button
                type="button"
                onclick={resetPrfFlow}
                class="btn btn-ghost btn-sm mt-2 w-full"
              >
                <ArrowLeft size={16} />
                {m.login_prf_back()}
              </button>
            </form>
          {:else}
            <!-- Default PRF Button -->
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
        {/if}
      </div>
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
