<script lang="ts">
  import { t } from '../i18n.svelte.ts';

  const MAX_DIGITS = 6;
  let { value = $bindable('') }: { value: string } = $props();

  function press(digit: number) {
    if (value.length < MAX_DIGITS) value = value === '0' ? String(digit) : value + digit;
  }
</script>

<output class="numero-grande" data-testid="keypad-value">{value === '' ? '0' : value}</output>
<div class="teclado">
  {#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as digit}
    <button class="tecla" onclick={() => press(digit)}>{digit}</button>
  {/each}
  <button class="tecla" aria-label={t('keypad.erase')} onclick={() => (value = value.slice(0, -1))}>←</button>
  <button class="tecla" onclick={() => press(0)}>0</button>
  <span></span>
</div>
