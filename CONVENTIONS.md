# Project Rules & Conventions

## Tech Stack

- **Frontend**: SvelteKit with Svelte 5 Runes (`$state`, `$derived`, `$effect`, `$props`).
  - ❌ DO NOT use `export let` (Svelte 4).
  - ❌ DO NOT use `$: ` (Svelte 4).
  - ✅ USE `$state` for reactivity.
- **Styling**: Tailwind CSS + shadcn-svelte.
- **Backend**: Node.js + Drizzle ORM (PostgreSQL) + Better Auth.
- **Package Manager**: pnpm.

## Zero-Knowledge Security (CRITICAL)

- **NO LOGGING**: Never `console.log` variables named `password`, `key`, `salt`, `dek`, or `plainText`.
- **Memory**: Use `crypto.getRandomValues()` to wipe `Uint8Array` secrets when done.
- **Extractable**: Always set `extractable: false` for CryptoKeys unless exporting the wrapped/encrypted version.

## Testing

- Use **Vitest** for unit logic (crypto, state machines).
- Use **Playwright** for E2E (offline capability, sync).

## Workflow

- Always verify implementation against `docs/architecture.md`.
