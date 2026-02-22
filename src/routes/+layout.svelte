<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { initAuth, authState } from "$lib/stores/auth.svelte";
  import { cryptoState } from "$lib/stores/crypto.svelte";
  import { loadVault } from "$lib/stores/vault.svelte";
  import { initTheme } from "$lib/stores/theme.svelte";
  import { setLanguageTag } from "$paraglide/runtime.js";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";

  let { children } = $props();

  // Set language on the client side based on the HTML lang attribute set by SSR
  if (browser) {
    setLanguageTag(document.documentElement.lang as "en" | "zh");
  }

  onMount(() => {
    initTheme();
    // Init Auth (Network request, might fail if offline)
    void initAuth();
  });

  // Watch for unlock to load vault
  $effect(() => {
    if (cryptoState.isUnlocked) {
      void loadVault();
    }
  });

  // Global Auth Guard: Redirect to login if not authenticated
  $effect(() => {
    if (browser && !authState.isLoading) {
      const path = $page.url.pathname;
      // Allow access to home, login, register, and recovery without session
      const isPublic =
        path === "/" ||
        path === "/login" ||
        path === "/register" ||
        path === "/recovery";
      if (!authState.session && !isPublic) {
        void goto("/login");
      }
    }
  });
</script>

<div class="min-h-screen flex flex-col font-sans">
  {@render children()}
</div>
