<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import {
    vaultState,
    updateAccount,
    deleteAccount,
    unlock,
  } from "$lib/stores/vault.svelte";
  import { cryptoState } from "$lib/stores/crypto.svelte";
  import * as m from "$paraglide/messages.js";
  import { ShieldAlert, Lock, Trash2, Fingerprint } from "lucide-svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import { getLocalPRF } from "$lib/db";
  import { assertPRF } from "$lib/crypto/prf";

  const accountId = $page.params.id;
  const account = $derived(vaultState.accounts.find((a) => a.id === accountId));

  let issuer = $state("");
  let name = $state("");
  let secret = $state("");
  let loading = $state(false);
  let error = $state("");

  let unlockPassword = $state("");
  let unlockLoading = $state(false);
  let unlockError = $state("");
  let hasPRF = $state(false);

  // Delete Modal State
  let deleteLoading = $state(false);

  $effect(() => {
    if (account && !issuer && !name && !secret) {
      issuer = account.issuer;
      name = account.name;
      secret = account.secret;
    }
  });

  onMount(async () => {
    const prfData = await getLocalPRF();
    hasPRF = !!prfData;
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

  async function handleSave() {
    loading = true;
    error = "";

    if (!cryptoState.isUnlocked) {
      error = m.err_vault_locked_add();
      loading = false;
      return;
    }

    if (!issuer || !name || !secret) {
      error = m.err_all_fields_required();
      loading = false;
      return;
    }

    try {
      const cleanSecret = secret.replace(/\s/g, "").toUpperCase();
      await updateAccount(accountId, { issuer, name, secret: cleanSecret });
      await goto("/");
    } catch (e: unknown) {
      const err = e as Error;
      error = err.message;
    } finally {
      loading = false;
    }
  }

  function openDeleteModal() {
    const modal = document.getElementById("delete_modal") as HTMLDialogElement;
    modal?.showModal();
  }

  function closeDeleteModal() {
    const modal = document.getElementById("delete_modal") as HTMLDialogElement;
    modal?.close();
  }

  async function confirmDelete() {
    deleteLoading = true;
    try {
      await deleteAccount(accountId);
      await goto("/");
    } catch (e: unknown) {
      const err = e as Error;
      error = err.message;
    } finally {
      deleteLoading = false;
    }
  }
</script>

<div class="hero min-h-screen bg-base-200 relative">
  <div class="absolute top-4 right-4 z-50">
    <ThemeToggle />
  </div>
  <div class="hero-content flex-col w-full max-w-md">
    {#if !cryptoState.isUnlocked}
      <div class="text-center mb-6">
        <div
          class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4"
        >
          <Lock size={32} />
        </div>
        <h1 class="text-3xl font-bold">{m.vault_locked_title()}</h1>
        <p class="py-2 text-base-content/70">{m.add_unlock_desc()}</p>
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
              class="input input-bordered text-center focus:input-primary"
              placeholder={m.placeholder_master_password()}
              required
              autocomplete="current-password"
            />
          </div>

          <div class="form-control mt-4 gap-2">
            <button
              type="submit"
              class="btn btn-primary"
              disabled={unlockLoading}
            >
              {#if unlockLoading}<span class="loading loading-spinner"
                ></span>{/if}
              {m.vault_unlock_button()}
            </button>

            {#if hasPRF}
              <div class="divider text-base-content/40 text-sm my-0"></div>
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

            <button
              type="button"
              class="btn btn-ghost"
              onclick={() => goto("/")}
            >
              {m.action_cancel()}
            </button>
          </div>
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
    {:else if !account || account.deletedAt}
      <div class="text-center">
        <h1 class="text-2xl font-bold text-error">Account not found</h1>
        <button class="btn btn-primary mt-4" onclick={() => goto("/")}
          >Back to Vault</button
        >
      </div>
    {:else}
      <div class="text-center mb-6">
        <h1 class="text-3xl font-extrabold tracking-tight text-primary">
          {m.edit_title()}
        </h1>
        <p class="py-2 text-base-content/70 font-medium">{m.edit_subtitle()}</p>
      </div>

      <div class="card w-full shadow-xl bg-base-100 border border-base-300">
        <form
          class="card-body"
          onsubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
        >
          {#if error}
            <div class="alert alert-error text-sm py-2 rounded-lg">
              <ShieldAlert size={16} />
              <span>{error}</span>
            </div>
          {/if}

          <div class="form-control">
            <label for="issuer" class="label">
              <span class="label-text font-medium">{m.add_issuer_label()}</span>
            </label>
            <input
              id="issuer"
              type="text"
              bind:value={issuer}
              required
              class="input input-bordered focus:input-primary"
            />
          </div>

          <div class="form-control mt-2">
            <label for="name" class="label">
              <span class="label-text font-medium">{m.add_name_label()}</span>
            </label>
            <input
              id="name"
              type="text"
              bind:value={name}
              required
              class="input input-bordered focus:input-primary"
            />
          </div>

          <div class="form-control mt-2">
            <label for="secret" class="label">
              <span class="label-text font-medium">{m.add_secret_label()}</span>
            </label>
            <input
              id="secret"
              type="text"
              bind:value={secret}
              required
              class="input input-bordered focus:input-primary font-mono uppercase"
            />
          </div>

          <div class="form-control mt-6 flex-col gap-3">
            <div class="flex gap-3 w-full">
              <button
                type="button"
                class="btn btn-outline flex-1"
                onclick={() => goto("/")}
              >
                {m.action_cancel()}
              </button>
              <button
                type="submit"
                class="btn btn-primary flex-1"
                disabled={loading}
              >
                {#if loading}<span class="loading loading-spinner"></span>{/if}
                {m.action_save()}
              </button>
            </div>
            <button
              type="button"
              class="btn btn-error btn-outline w-full"
              onclick={openDeleteModal}
              disabled={loading}
            >
              <Trash2 size={18} />
              {m.action_delete()}
            </button>
          </div>
        </form>
      </div>
    {/if}
  </div>
</div>

<!-- Delete Modal -->
<dialog id="delete_modal" class="modal modal-bottom sm:modal-middle">
  <div class="modal-box">
    <h3 class="font-bold text-lg mb-4 text-error">{m.action_delete()}</h3>
    <p class="py-4">{m.edit_delete_confirm()}</p>
    <div class="modal-action flex gap-2">
      <button
        type="button"
        class="btn btn-ghost"
        onclick={closeDeleteModal}
        disabled={deleteLoading}>{m.action_cancel()}</button
      >
      <button
        type="button"
        class="btn btn-error"
        onclick={confirmDelete}
        disabled={deleteLoading}
      >
        {#if deleteLoading}<span class="loading loading-spinner"></span>{/if}
        {m.action_delete()}
      </button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button onclick={closeDeleteModal}>close</button>
  </form>
</dialog>
