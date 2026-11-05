<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';

  let { items, rowHeight, row }: { items: T[]; rowHeight: number; row: Snippet<[T]> } = $props();

  const OVERSCAN = 6;
  let scrollTop = $state(0);
  let height = $state(600);
  const first = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN));
  const last = $derived(Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + OVERSCAN));
  const visible = $derived(items.slice(first, last));
</script>

<div class="viewport" bind:clientHeight={height} onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}>
  <div style:height="{items.length * rowHeight}px" style:position="relative">
    <div style:transform="translateY({first * rowHeight}px)">
      {#each visible as item (item)}
        <div style:height="{rowHeight}px">{@render row(item)}</div>
      {/each}
    </div>
  </div>
</div>

<style>
  .viewport {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
</style>
