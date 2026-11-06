<script lang="ts">
  import { t } from '../i18n.svelte.ts';
  import { pressDigit } from '../keypad.ts';

  /** `code`: what is typed is a code, not a count, and a zero in front stays. */
  let { value = $bindable(''), code = false }: { value: string; code?: boolean } = $props();

  function press(digit: number) {
    value = pressDigit(value, digit, code);
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
