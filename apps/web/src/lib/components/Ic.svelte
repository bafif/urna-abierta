<script lang="ts">
  const PATHS: Record<string, string> = {
    flecha: '<path d="M5 12h13M12 6l6 6-6 6"/>',
    tilde: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    tel: '<path d="M6 3h3l2 5-2.5 1.5a11 11 0 006 6L16 13l5 2v3a3 3 0 01-3 3A15 15 0 013 6a3 3 0 013-3z"/>',
    aviso: '<path d="M12 4l9 16H3zM12 10v4M12 17.5v.5"/>',
    lupa: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
    camara: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    sobre: '<path d="M3 6h18v13H3zM3 7l9 7 9-7"/>',
    atras: '<path d="M19 12H6M12 6l-6 6 6 6"/>',
    mas: '<path d="M12 5v14M5 12h14"/>',
  };
  let { name }: { name: string } = $props();
</script>

<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">{@html PATHS[name]}</svg>
