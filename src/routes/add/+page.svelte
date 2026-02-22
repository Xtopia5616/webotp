<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { addAccount, addAccounts, unlock } from "$lib/stores/vault.svelte";
  import { cryptoState } from "$lib/stores/crypto.svelte";
  import { pauseAutoLock, resumeAutoLock } from "$lib/stores/crypto.svelte";
  import {
    parseOtpauthUri,
    parseGoogleMigrationUri,
    parseImportData,
  } from "$lib/utils/totp";
  import * as m from "$paraglide/messages.js";
  import {
    ShieldAlert,
    Lock,
    QrCode,
    Upload,
    ImagePlus,
    Fingerprint,
  } from "lucide-svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import { getLocalPRF } from "$lib/db";
  import { assertPRF } from "$lib/crypto/prf";

  let issuer = $state("");
  let name = $state("");
  let secret = $state("");
  let loading = $state(false);
  let error = $state("");

  let unlockPassword = $state("");
  let unlockLoading = $state(false);
  let unlockError = $state("");
  let hasPRF = $state(false);

  // QR Scanner State
  let isScanning = $state(false);
  let scanError = $state("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Html5Qrcode: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let html5QrcodeInstance: any = null;

  // File Import State
  let fileInput = $state<HTMLInputElement | null>(null);
  let qrFileInput = $state<HTMLInputElement | null>(null);

  onMount(async () => {
    // Dynamically import to avoid SSR issues with window/document
    const module = await import("html5-qrcode");
    Html5Qrcode = module.Html5Qrcode;

    const prfData = await getLocalPRF();
    hasPRF = !!prfData;
  });

  $effect(() => {
    return () => {
      if (isScanning) {
        void stopScan();
      }
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
      await unlock(decryptedPassword);
    } catch (e) {
      const err = e as Error;
      unlockError = err.message || m.err_prf_unlock_failed();
    } finally {
      unlockLoading = false;
    }
  }

  async function handleAdd() {
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
      await addAccount({ issuer, name, secret: cleanSecret });
      await goto("/");
    } catch (e: unknown) {
      const err = e as Error;
      error = err.message;
    } finally {
      loading = false;
    }
  }

  function processQrText(decodedText: string) {
    if (decodedText.startsWith("otpauth-migration://")) {
      const parsed = parseGoogleMigrationUri(decodedText);
      if (parsed.length > 0) {
        addAccounts(parsed)
          .then(() => {
            void stopScan();
            void goto("/");
          })
          .catch((err) => {
            console.error("Failed to add accounts from migration URI", err);
            scanError = m.err_import_failed();
          });
      } else {
        scanError = m.err_invalid_qr();
      }
    } else {
      const parsed = parseOtpauthUri(decodedText);
      if (parsed) {
        issuer = parsed.issuer;
        name = parsed.name;
        secret = parsed.secret;
        void stopScan();
      } else {
        scanError = m.err_invalid_qr();
      }
    }
  }

  function startScan() {
    if (!Html5Qrcode) return;
    isScanning = true;
    scanError = "";

    // Wait for the modal and #qr-reader div to be rendered
    setTimeout(async () => {
      try {
        html5QrcodeInstance = new Html5Qrcode("qr-reader");
        await html5QrcodeInstance.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText: string) => {
            processQrText(decodedText);
          },
          () => {
            // Ignore frame errors (happens constantly when no QR is in view)
          },
        );
      } catch (err) {
        console.error("QR Scanner Error:", err);
        scanError = m.err_camera_permission();
        // Keep modal open so user can still use the "Upload Image" fallback
      }
    }, 100);
  }

  async function stopScan() {
    if (html5QrcodeInstance) {
      if (html5QrcodeInstance.isScanning) {
        try {
          await html5QrcodeInstance.stop();
        } catch (e) {
          console.error("Failed to stop scanner", e);
        }
      }
      html5QrcodeInstance.clear();
      html5QrcodeInstance = null;
    }
    isScanning = false;
  }

  async function handleQrImage(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];

    try {
      scanError = "";
      if (!html5QrcodeInstance) {
        html5QrcodeInstance = new Html5Qrcode("qr-reader");
      }

      if (html5QrcodeInstance.isScanning) {
        await html5QrcodeInstance.stop();
      }

      const decodedText = await html5QrcodeInstance.scanFile(file, true);
      processQrText(decodedText);
    } catch (err) {
      console.error("Failed to scan image", err);
      scanError = m.err_invalid_qr();
    } finally {
      input.value = ""; // reset
    }
  }

  function openFilePicker() {
    pauseAutoLock();
    fileInput?.click();
  }

  function handleFilePickerClose() {
    // Small delay to allow the file dialog to fully close and change event to fire
    setTimeout(() => {
      resumeAutoLock();
    }, 100);
  }

  async function handleImport(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      handleFilePickerClose();
      return;
    }

    const file = input.files[0];
    const text = await file.text();

    try {
      const parsedAccounts = parseImportData(text);
      if (parsedAccounts.length === 0) {
        alert(m.err_import_failed());
        return;
      }

      await addAccounts(parsedAccounts);
      alert(m.success_import({ count: parsedAccounts.length }));
      input.value = ""; // reset
      await goto("/");
    } catch {
      alert(m.err_import_failed());
    } finally {
      handleFilePickerClose();
    }
  }
</script>

<div class="hero min-h-screen bg-base-200 relative">
  <div class="absolute top-4 right-4 z-50">
    <ThemeToggle />
  </div>
  <div class="hero-content flex-col w-full max-w-md">
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
              {#if unlockLoading}<span class="loading loading-spinner"
                ></span>{/if}
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
    {:else}
      <div class="text-center mb-6">
        <h1 class="text-3xl font-extrabold tracking-tight text-primary">
          {m.add_title()}
        </h1>
        <p class="py-2 text-base-content/70 font-medium">{m.add_subtitle()}</p>
      </div>

      <div class="card w-full shadow-xl bg-base-100 border border-base-300">
        <div class="card-body">
          {#if error}
            <div class="alert alert-error text-sm py-2 rounded-lg mb-2">
              <ShieldAlert size={16} />
              <span>{error}</span>
            </div>
          {/if}

          <div class="flex flex-col gap-3">
            <button
              type="button"
              class="btn btn-outline btn-secondary btn-lg w-full"
              onclick={startScan}
            >
              <QrCode size={20} />
              {m.add_scan_qr()}
            </button>

            <div class="flex flex-col w-full">
              <button
                type="button"
                class="btn btn-outline btn-lg w-full"
                onclick={openFilePicker}
              >
                <Upload size={20} />
                {m.add_import_file()}
              </button>
              <span class="text-xs text-base-content/50 text-center mt-1.5">
                {m.add_import_hint()}
              </span>
            </div>
            <input
              type="file"
              accept=".json,.txt"
              bind:this={fileInput}
              onchange={handleImport}
              class="hidden"
            />
          </div>

          <div class="divider text-base-content/40 text-sm my-2">
            {m.add_or_manual()}
          </div>

          <form
            onsubmit={(e) => {
              e.preventDefault();
              void handleAdd();
            }}
          >
            <div class="form-control">
              <label for="issuer" class="label">
                <span class="label-text font-medium"
                  >{m.add_issuer_label()}</span
                >
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
                <span class="label-text font-medium"
                  >{m.add_secret_label()}</span
                >
              </label>
              <input
                id="secret"
                type="text"
                bind:value={secret}
                required
                class="input input-bordered focus:input-primary font-mono uppercase"
                placeholder="JBSWY3DPEHPK3PXP"
              />
            </div>

            <div class="form-control mt-6 flex-row gap-3">
              <button
                type="button"
                class="btn btn-outline flex-1"
                onclick={() => goto("/")}
              >
                {m.add_cancel_button()}
              </button>
              <button
                type="submit"
                class="btn btn-primary flex-1"
                disabled={loading}
              >
                {#if loading}<span class="loading loading-spinner"></span>{/if}
                {m.add_submit_button()}
              </button>
            </div>
          </form>
        </div>
      </div>
    {/if}
  </div>
</div>

{#if isScanning}
  <dialog class="modal modal-open bg-base-300/90 backdrop-blur-sm">
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-4">{m.add_scan_qr()}</h3>
      {#if scanError}
        <div class="alert alert-error text-sm py-2 rounded-lg mb-4">
          <span>{scanError}</span>
        </div>
      {/if}
      <div
        id="qr-reader"
        class="w-full overflow-hidden rounded-lg bg-base-200 min-h-[300px]"
      ></div>
      <div class="modal-action flex justify-between w-full mt-6">
        <button
          type="button"
          class="btn btn-outline"
          onclick={() => qrFileInput?.click()}
        >
          <ImagePlus size={18} />
          {m.add_scan_image()}
        </button>
        <button type="button" class="btn" onclick={stopScan}>
          {m.add_cancel_button()}
        </button>
      </div>
      <input
        type="file"
        accept="image/*"
        bind:this={qrFileInput}
        onchange={handleQrImage}
        class="hidden"
      />
    </div>
  </dialog>
{/if}
