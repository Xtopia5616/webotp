<script lang="ts">
  import { generateTOTP } from "$lib/utils/totp";
  import { type Account } from "$lib/stores/vault.svelte";
  import { Check, Eye, EyeOff, Edit2, Trash2 } from "lucide-svelte";
  import * as m from "$paraglide/messages.js";

  let {
    account,
    onEdit,
    onDelete,
  }: {
    account: Account;
    onEdit: (account: Account) => void;
    onDelete: (account: Account) => void;
  } = $props();

  let code = $state("------");
  let exactRemaining = $state(0);
  let copied = $state(false);
  let isVisible = $state(false);

  // Swipe state
  let startX = $state(0);
  let startY = $state(0);
  let isDragging = $state(false);
  let swipeOffset = $state(0);
  let isSwipedOpen = $state(false);
  const MAX_SWIPE = -128; // 64px per button * 2

  const period = $derived(account.period ?? 30);
  const digits = $derived(account.digits ?? 6);

  const progress = $derived((exactRemaining / period) * 100);
  const displaySeconds = $derived(Math.ceil(exactRemaining));

  async function updateCode() {
    try {
      code = await generateTOTP(account.secret, period, digits);
    } catch (e) {
      console.error(`Failed to generate TOTP for ${account.issuer}`, e);
      code = "ERROR";
    }
  }

  $effect(() => {
    void updateCode();

    let animationFrameId: number;
    let previousPeriodIndex = Math.floor(Date.now() / 1000 / period);

    function tick() {
      const now = Date.now();
      const currentPeriodIndex = Math.floor(now / 1000 / period);

      if (currentPeriodIndex > previousPeriodIndex) {
        void updateCode();
        previousPeriodIndex = currentPeriodIndex;
      }

      const elapsed = (now / 1000) % period;
      exactRemaining = period - elapsed;

      animationFrameId = requestAnimationFrame(tick);
    }

    animationFrameId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animationFrameId);
  });

  function copyToClipboard() {
    if (code === "------" || code === "ERROR") return;
    void navigator.clipboard.writeText(code);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  function handleDelete(e: Event) {
    e.stopPropagation();
    onDelete(account);
  }

  function handleTouchStart(e: TouchEvent) {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isDragging = true;
  }

  function handleTouchMove(e: TouchEvent) {
    if (!isDragging) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - startX;
    const diffY = currentY - startY;

    // If scrolling vertically, cancel swipe
    if (Math.abs(diffY) > Math.abs(diffX) && !isSwipedOpen) {
      isDragging = false;
      return;
    }

    let newOffset = isSwipedOpen ? MAX_SWIPE + diffX : diffX;

    if (newOffset > 0) newOffset = 0;
    if (newOffset < MAX_SWIPE - 20) newOffset = MAX_SWIPE - 20;

    swipeOffset = newOffset;
  }

  function handleTouchEnd() {
    if (!isDragging) return;
    isDragging = false;
    if (swipeOffset < MAX_SWIPE / 2) {
      swipeOffset = MAX_SWIPE;
      isSwipedOpen = true;
    } else {
      swipeOffset = 0;
      isSwipedOpen = false;
    }
  }

  function handleCardClick(e: Event) {
    if (isSwipedOpen) {
      swipeOffset = 0;
      isSwipedOpen = false;
      e.stopPropagation();
      return;
    }
    copyToClipboard();
  }
</script>

<div
  class="relative h-full rounded-2xl overflow-hidden bg-base-200 border border-base-300 group transition-transform active:scale-[0.99] shadow-sm hover:shadow-md min-h-28"
>
  <!-- Background Actions (Swipe Reveal - Mobile Only) -->
  <div
    class="absolute inset-y-0 right-0 flex items-center justify-end w-[128px] md:hidden"
  >
    <button
      class="btn btn-square btn-ghost text-base-content h-full w-[64px] rounded-none hover:bg-base-300"
      onclick={(e) => {
        e.stopPropagation();
        onEdit(account);
        swipeOffset = 0;
        isSwipedOpen = false;
      }}
      title={m.action_edit()}
    >
      <Edit2 size={20} />
    </button>
    <button
      class="btn btn-square btn-ghost text-error h-full w-[64px] rounded-none hover:bg-error/20"
      onclick={handleDelete}
      title={m.action_delete()}
    >
      <Trash2 size={20} />
    </button>
  </div>

  <!-- Foreground Card -->
  <div
    class="bg-base-100 w-full h-full relative z-10 flex flex-row items-center justify-between p-5 sm:p-6 cursor-pointer"
    style="transform: translateX({swipeOffset}px); transition: {isDragging
      ? 'none'
      : 'transform 0.2s ease-out'}; touch-action: pan-y;"
    ontouchstart={handleTouchStart}
    ontouchmove={handleTouchMove}
    ontouchend={handleTouchEnd}
    onclick={handleCardClick}
    role="button"
    tabindex="0"
    onkeydown={(e) => e.key === "Enter" && handleCardClick(e)}
  >
    <div class="flex flex-col overflow-hidden pr-2 min-w-0 flex-1">
      <span class="font-bold text-xl truncate">{account.issuer}</span>
      <span class="text-base-content/60 text-base truncate">{account.name}</span
      >
    </div>

    <div class="flex items-center gap-2 sm:gap-4 shrink-0">
      <button
        class="btn btn-sm btn-circle btn-ghost text-base-content/40 hover:text-primary hover:bg-base-200"
        onclick={(e) => {
          e.stopPropagation();
          isVisible = !isVisible;
        }}
        title={isVisible ? m.action_hide_code() : m.action_show_code()}
      >
        {#if isVisible}<EyeOff size={18} />{:else}<Eye size={18} />{/if}
      </button>

      <div
        class="font-mono text-3xl sm:text-4xl tracking-widest select-all text-primary font-semibold w-[120px] sm:w-[150px] text-center flex items-center justify-center"
      >
        {#if copied}
          <span
            class="text-success text-sm sm:text-base flex items-center gap-1 font-bold tracking-normal"
          >
            <Check size={16} />
            {m.action_copied()}
          </span>
        {:else if isVisible}
          {code.slice(0, 3)}<span class="opacity-50 mx-0.5"></span>{code.slice(
            3,
          )}
        {:else}
          &bull;&bull;&bull;<span class="opacity-50 mx-0.5"
          ></span>&bull;&bull;&bull;
        {/if}
      </div>

      <div
        class="radial-progress text-primary ml-1"
        style="--value:{progress}; --size:2.5rem; --thickness: 3px;"
        role="progressbar"
      >
        <span class="text-sm font-medium text-base-content"
          >{displaySeconds}</span
        >
      </div>
    </div>

    <!-- Desktop Hover Actions -->
    <div
      class="absolute inset-y-0 right-0 hidden md:flex items-center gap-2 pr-4 pl-12 bg-gradient-to-l from-base-100 via-base-100 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-20"
    >
      <button
        class="btn btn-sm btn-circle btn-ghost text-base-content/60 hover:text-primary hover:bg-base-200 shadow-sm bg-base-100"
        onclick={(e) => {
          e.stopPropagation();
          onEdit(account);
        }}
        title={m.action_edit()}
      >
        <Edit2 size={16} />
      </button>
      <button
        class="btn btn-sm btn-circle btn-ghost text-base-content/60 hover:text-error hover:bg-error/10 shadow-sm bg-base-100"
        onclick={handleDelete}
        title={m.action_delete()}
      >
        <Trash2 size={16} />
      </button>
    </div>
  </div>
</div>
