<script lang="ts">
  import { authClient, authState, initAuth } from "$lib/stores/auth.svelte";
  import { deriveLAK } from "$lib/crypto/zk-engine";
  import { goto } from "$app/navigation";
  import { setLocalAuthParams, setLocalVault } from "$lib/db";
  import * as m from "$paraglide/messages.js";
  import { unlock } from "$lib/stores/vault.svelte";
  import { ShieldAlert } from "lucide-svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";

  let email = $state("");
  let password = $state("");
  let loading = $state(false);
  let error = $state("");

  $effect(() => {
    if (authState.session && !authState.isLoading) {
      void goto("/");
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
