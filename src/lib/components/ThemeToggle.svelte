<script lang="ts">
  import { themeState, toggleTheme } from "$lib/stores/theme.svelte";
  import { Sun, Moon } from "lucide-svelte";
</script>

<label class="swap btn btn-ghost btn-circle" title="Toggle Theme">
  <input
    type="checkbox"
    checked={themeState.current === "dim"}
    onchange={toggleTheme}
  />
  <div class="swap-on">
    <Sun size={20} />
  </div>
  <div class="swap-off">
    <Moon size={20} />
  </div>
</label>
