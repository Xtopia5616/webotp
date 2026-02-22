<script lang="ts">
  import { onMount } from "svelte";
  import {
    vaultState,
    unlock,
    updateAccount,
    deleteAccount,
    type Account,
  } from "$lib/stores/vault.svelte";
  import { authState, logout } from "$lib/stores/auth.svelte";
  import { cryptoState, lock } from "$lib/stores/crypto.svelte";
  import { goto } from "$app/navigation";
  import OtpCard from "$lib/components/OtpCard.svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import { checkClockDrift } from "$lib/utils/time";
  import { getDB, getLocalPRF } from "$lib/db";
  import { assertPRF } from "$lib/crypto/prf";
  import * as m from "$paraglide/messages.js";
  import {
    Settings,
    LogOut,
    Lock,
    Plus,
    Fingerprint,
    ShieldAlert,
    LogIn,
    ShieldCheck,
    Github,
  } from "lucide-svelte";

  let masterPassword = $state("");
  let unlockError = $state("");
  let clockDriftWarning = $state(false);
  let isUnlocking = $state(false);
  let isCheckingLocal = $state(true);
  let hasPRF = $state(false);

  // Edit Modal State
  let editingAccount = $state<Account | null>(null);
  let editIssuer = $state("");
  let editName = $state("");
  let editSecret = $state("");
  let editLoading = $state(false);
  let editError = $state("");

  // Delete Modal State
  let deletingAccount = $state<Account | null>(null);
  let deleteLoading = $state(false);

  // Sign Out Modal State
  let signOutLoading = $state(false);

  const activeAccounts = $derived(
    vaultState.accounts.filter((a) => !a.deletedAt),
  );

  onMount(async () => {
    try {
      const res = await fetch("/", { method: "HEAD" });
      const serverDate = res.headers.get("Date");
      if (serverDate) {
        const drift = checkClockDrift(serverDate);
        if (drift.isDrifted) {
          clockDriftWarning = true;
          console.warn("Clock drift detected:", drift.driftMs, "ms");
        }
      }
    } catch (e) {
      console.error("Failed to check clock drift", e);
    }

    try {
      if (authState.session) {
        const db = await getDB();
        const localParams = await db.get("authParams", "current");
        if (!localParams) {
          console.error(
            "Session valid, but no local credentials found. Redirecting to login.",
          );
          await logout();
          await goto("/login");
          return;
        }
      }
      const prfData = await getLocalPRF();
      hasPRF = !!prfData;
    } catch (e) {
      console.error("Error checking local credentials", e);
    } finally {
      isCheckingLocal = false;
    }
  });

  async function handleUnlock(e: Event) {
    e.preventDefault();
    isUnlocking = true;
    unlockError = "";
    try {
      // Read directly from form to avoid autofill race condition
      const form = e.target as HTMLFormElement;
      const formData = new FormData(form);
      const password = formData.get("password") as string;

      await unlock(password);
      masterPassword = "";
    } catch (e) {
      const err = e as Error;
      unlockError = err.message || m.err_unlock_failed();
    } finally {
      isUnlocking = false;
    }
  }

  async function handlePRFUnlock() {
    isUnlocking = true;
    unlockError = "";
    try {
      const decryptedPassword = await assertPRF();
      await unlock(decryptedPassword);
    } catch (e) {
      const err = e as Error;
      unlockError = err.message || m.err_prf_unlock_failed();
    } finally {
      isUnlocking = false;
    }
  }

  function handleAddAccount() {
    void goto("/add");
  }

  function handleLock() {
    lock();
  }

  function openSignOutModal() {
    const modal = document.getElementById("signout_modal") as HTMLDialogElement;
    modal?.showModal();
  }

  async function confirmSignOut() {
    signOutLoading = true;
    try {
      await logout();
      await goto("/login");
    } finally {
      signOutLoading = false;
    }
  }

  function openEditModal(account: Account) {
    editingAccount = account;
    editIssuer = account.issuer;
    editName = account.name;
    editSecret = account.secret;
    editError = "";
    const modal = document.getElementById("edit_modal") as HTMLDialogElement;
    modal?.showModal();
  }

  function closeEditModal() {
    const modal = document.getElementById("edit_modal") as HTMLDialogElement;
    modal?.close();
    editingAccount = null;
  }

  async function handleEditSave() {
    if (!editingAccount) return;
    editLoading = true;
    editError = "";
    try {
      const cleanSecret = editSecret.replace(/\s/g, "").toUpperCase();
      await updateAccount(editingAccount.id, {
        issuer: editIssuer,
        name: editName,
        secret: cleanSecret,
      });
      closeEditModal();
    } catch (e) {
      editError = (e as Error).message;
    } finally {
      editLoading = false;
    }
  }

  function openDeleteModal(account: Account) {
    deletingAccount = account;
    const modal = document.getElementById("delete_modal") as HTMLDialogElement;
    modal?.showModal();
  }

  function closeDeleteModal() {
    const modal = document.getElementById("delete_modal") as HTMLDialogElement;
    modal?.close();
    deletingAccount = null;
  }

  async function confirmDelete() {
    if (!deletingAccount) return;
    deleteLoading = true;
    try {
      await deleteAccount(deletingAccount.id);
      closeDeleteModal();
      // Also close edit modal if open for the same account
      if (editingAccount?.id === deletingAccount.id) {
        closeEditModal();
      }
    } catch (e) {
      console.error("Failed to delete account", e);
    } finally {
      deleteLoading = false;
    }
  }
</script>

<svelte:head>
  <title>WebOTP</title>
</svelte:head>

{#if clockDriftWarning}
  <div class="toast toast-top toast-center z-[100] w-full max-w-md pt-4">
    <div class="alert alert-warning shadow-lg">
      <ShieldAlert size={20} />
      <span>{m.clock_drift_warning()}</span>
    </div>
  </div>
{/if}

{#if authState.isLoading || isCheckingLocal}
  <div class="flex items-center justify-center h-screen bg-base-200">
    <span class="loading loading-spinner loading-lg text-primary"></span>
  </div>
{:else if !authState.session}
  <!-- Home Page for Unauthenticated Users -->
  <div class="hero min-h-screen bg-base-200 relative">
    <div class="absolute top-4 right-4 z-50">
      <ThemeToggle />
    </div>
    <div class="hero-content flex-col w-full max-w-md text-center">
      <div
        class="inline-flex items-center justify-center w-24 h-24 rounded-full bg-primary/10 text-primary mb-6"
      >
        <ShieldCheck size={48} />
      </div>
      <h1 class="text-5xl font-extrabold tracking-tight text-primary mb-4">
        {m.login_title()}
      </h1>
      <p class="text-lg text-base-content/70 mb-8 max-w-sm">
        {m.home_description()}
      </p>
      <div class="flex flex-col gap-3 w-full max-w-xs">
        <button
          type="button"
          class="btn btn-primary btn-lg"
          onclick={() => goto("/login")}
        >
          <LogIn size={20} />
          {m.home_get_started()}
        </button>
        <a
          href="/register"
          class="link link-hover text-sm text-base-content/70 hover:text-primary"
        >
          {m.login_create_link()}
        </a>
      </div>

      <div class="mt-8 text-center">
        <a
          href="https://github.com/Xtopia5616/webotp"
          target="_blank"
          rel="noopener noreferrer"
          class="link link-hover text-sm text-base-content/50 hover:text-primary flex items-center justify-center gap-1"
        >
          <Github size={14} />
          <span>{m.home_opensource_link()}</span>
        </a>
      </div>
    </div>
  </div>
{:else if !cryptoState.isUnlocked}
  <div class="hero min-h-screen bg-base-200 relative">
    <div class="absolute top-4 right-4 z-50">
      <ThemeToggle />
    </div>
    <div class="hero-content flex-col w-full max-w-md">
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
              bind:value={masterPassword}
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
              disabled={isUnlocking}
            >
              {#if isUnlocking}
                <span class="loading loading-spinner"></span>
              {/if}
              {m.vault_unlock_button()}
            </button>
          </div>

          {#if hasPRF}
            <div class="divider text-base-content/40 text-sm">
              {m.vault_unlock_or()}
            </div>
            <button
              type="button"
              onclick={handlePRFUnlock}
              disabled={isUnlocking}
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
    </div>
  </div>
{:else}
  <div class="min-h-screen bg-base-200 pb-12">
    <div
      class="navbar bg-base-100 shadow-sm sticky top-0 z-50 px-4 lg:px-8 border-b border-base-300"
    >
      <div class="flex-1">
        <a href="/" class="text-xl font-extrabold text-primary tracking-tight"
          >{m.vault_header_title()}</a
        >
      </div>
      <div class="flex-none gap-1">
        <ThemeToggle />
        <button
          onclick={handleLock}
          class="btn btn-ghost btn-circle"
          title={m.vault_lock_button()}
        >
          <Lock size={20} />
        </button>
        <a
          href="/settings"
          class="btn btn-ghost btn-circle"
          title={m.settings_title()}
        >
          <Settings size={20} />
        </a>
        <button
          onclick={openSignOutModal}
          class="btn btn-ghost btn-circle text-error hover:bg-error/10"
          title={m.vault_signout_button()}
        >
          <LogOut size={20} />
        </button>
      </div>
    </div>

    <main class="container mx-auto px-4 lg:px-8 py-8 max-w-5xl">
      {#if vaultState.isLoading}
        <div
          class="flex flex-col items-center justify-center py-20 text-base-content/50"
        >
          <span class="loading loading-ring loading-lg mb-4"></span>
          <p>{m.vault_loading_accounts()}</p>
        </div>
      {:else if activeAccounts.length === 0}
        <div
          class="hero py-20 bg-base-100 rounded-box border border-base-300 shadow-sm"
        >
          <div class="hero-content text-center">
            <div class="max-w-md">
              <h2 class="text-2xl font-bold mb-2">{m.vault_empty_title()}</h2>
              <p class="text-base-content/70 mb-6">
                {m.vault_empty_subtitle()}
              </p>
              <button onclick={handleAddAccount} class="btn btn-primary btn-lg">
                <Plus size={20} />
                {m.vault_add_button()}
              </button>
            </div>
          </div>
        </div>
      {:else}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {#each activeAccounts as account (account.id)}
            <OtpCard
              {account}
              onEdit={openEditModal}
              onDelete={openDeleteModal}
            />
          {/each}

          <!-- Add New Card Button -->
          <button
            onclick={handleAddAccount}
            class="relative h-full rounded-2xl overflow-hidden bg-base-100 border border-dashed border-base-300 hover:border-primary hover:bg-base-200 transition-all cursor-pointer flex items-center justify-center text-base-content/50 hover:text-primary group shadow-sm hover:shadow-md p-5 sm:p-6 min-h-28"
          >
            <div
              class="flex items-center gap-2 font-medium group-hover:scale-105 transition-transform"
            >
              <Plus size={24} />
              <span class="text-base">{m.vault_add_button()}</span>
            </div>
          </button>
        </div>
      {/if}
    </main>

    <!-- Edit Modal -->
    <dialog id="edit_modal" class="modal modal-bottom sm:modal-middle">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">{m.edit_title()}</h3>
        <form
          onsubmit={(e) => {
            e.preventDefault();
            void handleEditSave();
          }}
        >
          {#if editError}
            <div class="alert alert-error text-sm py-2 rounded-lg mb-4">
              <ShieldAlert size={16} />
              <span>{editError}</span>
            </div>
          {/if}

          <div class="form-control">
            <label for="editIssuer" class="label"
              ><span class="label-text font-medium">{m.add_issuer_label()}</span
              ></label
            >
            <input
              id="editIssuer"
              type="text"
              bind:value={editIssuer}
              required
              class="input input-bordered focus:input-primary"
            />
          </div>

          <div class="form-control mt-2">
            <label for="editName" class="label"
              ><span class="label-text font-medium">{m.add_name_label()}</span
              ></label
            >
            <input
              id="editName"
              type="text"
              bind:value={editName}
              required
              class="input input-bordered focus:input-primary"
            />
          </div>

          <div class="form-control mt-2">
            <label for="editSecret" class="label"
              ><span class="label-text font-medium">{m.add_secret_label()}</span
              ></label
            >
            <input
              id="editSecret"
              type="text"
              bind:value={editSecret}
              required
              class="input input-bordered focus:input-primary font-mono uppercase"
            />
          </div>

          <div class="modal-action flex gap-2">
            <button
              type="button"
              class="btn btn-ghost"
              onclick={closeEditModal}
              disabled={editLoading}>{m.action_cancel()}</button
            >
            <button
              type="submit"
              class="btn btn-primary"
              disabled={editLoading}
            >
              {#if editLoading}<span class="loading loading-spinner"
                ></span>{/if}
              {m.action_save()}
            </button>
          </div>
        </form>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button onclick={closeEditModal}>close</button>
      </form>
    </dialog>

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
            {#if deleteLoading}<span class="loading loading-spinner"
              ></span>{/if}
            {m.action_delete()}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button onclick={closeDeleteModal}>close</button>
      </form>
    </dialog>

    <!-- Sign Out Modal -->
    <dialog id="signout_modal" class="modal modal-bottom sm:modal-middle">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">{m.vault_signout_button()}</h3>
        <p class="py-4">Are you sure you want to sign out?</p>
        <div class="modal-action flex gap-2">
          <form method="dialog" class="w-full">
            <button
              type="submit"
              class="btn btn-ghost w-full"
              disabled={signOutLoading}>{m.action_cancel()}</button
            >
          </form>
          <button
            type="button"
            class="btn btn-error w-full"
            onclick={confirmSignOut}
            disabled={signOutLoading}
          >
            {#if signOutLoading}<span class="loading loading-spinner"
              ></span>{/if}
            {m.vault_signout_button()}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  </div>
{/if}
