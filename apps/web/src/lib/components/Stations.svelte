<script lang="ts">
  import { t } from '../i18n.svelte.ts';
  import Ic from './Ic.svelte';

  export interface Station {
    text: string;
    when: string;
    state: 'hecho' | 'ahora' | '';
    help?: string;
  }

  let { steps }: { steps: Station[] } = $props();
</script>

<ol class="plan">
  {#each steps as step}
    <li class="estacion {step.state}" aria-current={step.state === 'ahora' ? 'step' : undefined}>
      <span class="punto">{#if step.state === 'hecho'}<Ic name="tilde" />{/if}</span>
      <div>
        <strong>{step.text}</strong>
        <span class="cuando">{step.state === 'ahora' ? t('plan.here') : step.when}</span>
        {#if step.help && step.state === 'ahora'}<p class="ayuda">{step.help}</p>{/if}
      </div>
    </li>
  {/each}
</ol>
