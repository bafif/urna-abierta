<script lang="ts">
  import qrcode from 'qrcode-generator';

  let { text }: { text: string } = $props();

  const code = $derived.by(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ scalable: true, margin: 0 });
  });
</script>

<div class="qr">{@html code}</div>
