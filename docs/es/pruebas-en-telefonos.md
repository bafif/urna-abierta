# Prueba en teléfonos reales

Lo único que no se puede probar desde una computadora es qué hace un teléfono de verdad con la app: si la conserva
después de reiniciarlo, si la borra después de varios días, y si anda bien en un equipo viejo. La app de prueba usa
personas inventadas y no manda ningún informe sola.

## Qué hace falta

Un Android viejo y un iPhone. Los dos necesitan abrir la app por HTTPS, salvo el caso de Android por USB.

- **Android por USB, sin publicar nada:**

  ```sh
  deploy/serve.sh
  adb reverse tcp:8090 tcp:8090
  ```

  Con la app corriendo en la computadora, abrí `http://localhost:8090` en Chrome. Para el teléfono, `localhost` cuenta
  como conexión segura.

- **iPhone (o cualquier teléfono):** publicá la carpeta `apps/web/build` en un sitio con HTTPS. Sin servidor, la app usa
  el mismo padrón inventado y deja los envíos pendientes; alcanza para esta prueba. Si la carpeta queda bajo una ruta,
  compilá con `BASE_PATH=/ruta corepack pnpm --filter @urna-abierta/web build`.

## Los pasos

Hacelos en cada teléfono. Al final de cada día, en **Estado**, tocá **Copiar informe** y guardalo.

| Cuándo | Qué hacer | Qué tiene que pasar |
|---|---|---|
| Día 1, con señal | Instalar la app. En Android con **Instalar la app**; en iPhone con Compartir y **Agregar a inicio**. Abrirla desde el ícono | **Instalada** dice «sí» |
| Día 1 | Elegir 350 personas y tocar **Preparar mesa** | **Faltan 350 de 350**. Mirar si **Almacenamiento protegido** dice «sí» |
| Día 1 | Poner modo avión, cerrar la app y abrirla | Abre igual, con las 350 personas |
| Día 1 | Tachar 20 personas rápido, buscar `nunez` y tachar otra | Cada toque responde sin demora; la búsqueda encuentra «Núñez» |
| Día 1 | Reiniciar el teléfono, sin señal, y abrir la app | Siguen tachadas, **Datos intactos** dice «sí» |
| Día 1 | En **Aviso urgente**, poner un teléfono de prueba y avisar | Aparecen Llamar, WhatsApp y SMS, y cada botón abre lo que dice |
| Día 1 | Volver a **Mesa**, dejarla como está y sacar el modo avión | Con servidor: **Todo enviado**. Sin servidor: siguen pendientes |
| Día 4 | Abrir la app sin señal | Todo sigue ahí. Es el largo real de una elección de tres días |
| Día 9 | Abrir la app sin señal, sin haberla abierto desde el día 4 | Todo sigue ahí. Pasa la regla de 7 días de Safari |
| Después | Repetir con 5000 personas en el teléfono más viejo | Tachar y buscar siguen andando bien |

## Cómo se decide

- Si en los dos teléfonos todo sigue ahí el día 9, la app web alcanza.
- Si el iPhone borra datos estando instalada, o si **Almacenamiento protegido** queda en «no» y además se pierden datos,
  hay que empaquetarla con Capacitor antes de seguir.
- Si tachar tarda más de 200 ms en el teléfono más viejo, hay que aligerar la interfaz.
