<script lang="ts">
  export interface Option {
    id: string;
    title: string;
    detail?: string;
    color?: string;
  }

  let { items, value = $bindable() }: { items: Option[]; value: string | null } = $props();
</script>

<div class="opciones" class:semaforo={items.some((item) => item.color)} role="radiogroup">
  {#each items as item (item.id)}
    <button class="opcion" class:elegida={item.id === value} role="radio" aria-checked={item.id === value} onclick={() => (value = item.id)}>
      {#if item.color}
        <span class="luz" style:background={item.color}></span>
      {:else}
        <span class="radio"></span>
      {/if}
      <span><strong>{item.title}</strong>{#if item.detail}<small>{item.detail}</small>{/if}</span>
    </button>
  {/each}
</div>
