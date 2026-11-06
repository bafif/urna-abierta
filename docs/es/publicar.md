# Publicar una versión

[English](../en/releasing.md) · [Volver al plan técnico](plan-tecnico.md)

Una versión se publica con una etiqueta que empieza con `v`, como `v0.1.0`. Todo lo demás lo hace GitHub Actions
(`.github/workflows/release.yml`), en este orden, y cada paso espera al anterior:

1. **Las pruebas.** Las de cada cambio, más la instalación por SSH en dos máquinas Ubuntu. Si alguna falla, no se arma nada.
2. **Las imágenes** del servidor y de la app, para x86 y ARM, con la etiqueta de la versión y su atestación. Todavía no se toca
   `latest`.
3. **Un release en borrador.**
4. **Los instaladores** de Windows, macOS (Apple e Intel) y Linux. Cada uno se desempaca y se arranca como lo haría una persona, y
   tiene que mostrar sus pantallas y decir su versión antes de subirse al borrador, con su SHA-256 y su atestación.
5. **La publicación.** Antes, comprueba que las imágenes se puedan bajar sin cuenta, para las dos arquitecturas, como las baja cada
   servidor. Recién entonces `latest` pasa a apuntar a esta versión y el release deja de ser borrador.

Los archivos que se publican tienen nombres que una persona reconoce: `urna-abierta-instalador-windows.exe`,
`urna-abierta-instalador-mac-apple.zip`, `urna-abierta-instalador-mac-intel.zip` y `urna-abierta-instalador-linux.tar.gz`. Los de macOS
y Linux van comprimidos porque así conservan el permiso de ejecutarse, que el navegador pierde al bajar un archivo suelto.

## La primera vez: hacer públicas las imágenes

GitHub crea cada paquete nuevo como privado, y un servidor no puede bajar una imagen privada. En la primera versión el paso 5 va a
fallar con «cannot be pulled without an account». Hay que hacerlo una sola vez, para cada uno de los dos paquetes:

1. En GitHub, tu perfil, **Packages**, `urna-abierta-server`.
2. **Package settings**, **Change visibility**, **Public**, y confirmar con el nombre del paquete.
3. Lo mismo con `urna-abierta-web`.
4. En la ejecución que falló, **Re-run failed jobs**.

Después quedan públicos, y las versiones siguientes se publican solas.

## Después de publicar

`urna actualizar` en cada servidor busca la última versión publicada en la página de releases. Antes de anunciar una versión nueva,
probala en un servidor de prueba con `sudo urna actualizar vX.Y.Z`.
