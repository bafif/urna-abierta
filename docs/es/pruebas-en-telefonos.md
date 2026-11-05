# Prueba en un teléfono, desde la PC

[English](../en/phone-tests.md)

No hace falta publicar nada. La app de prueba usa personas inventadas y no manda ningún informe sola.

## Verla en el tamaño de un teléfono

```sh
deploy/serve.sh
```

Te da un link por cada rol. Abrí el del fiscal en el navegador de la PC y activá el modo de dispositivo con F12. Sirve para probar la
interfaz, no para saber qué hace un teléfono de verdad.

## Android, en un emulador

```sh
deploy/android-emulator.sh
```

La primera vez baja unos 5,5 GB y acepta las licencias del SDK de Android. Se abre una ventana con el teléfono: en su Chrome,
abrí el link que te dio `deploy/serve.sh`. Para cortar la señal, activá el modo avión y corré:

```sh
~/.local/share/urna-abierta/android-sdk/platform-tools/adb reverse --remove-all
```

Hace falta porque el emulador llega a la app por un túnel que el modo avión no corta.

También se puede correr entero sin ventana. Prueba sin señal, reinicio, reloj adelantado 9 días, disco casi lleno y un
teléfono lento:

```sh
deploy/android-emulator.sh --headless
ADB=~/.local/share/urna-abierta/android-sdk/platform-tools/adb node apps/web/e2e-android/check.mjs resultados.json
```

## iPhone

No hay emulador de iPhone para Linux: el de Apple solo corre en una Mac. Las pruebas con WebKit son lo más parecido, pero no
reproducen ni la instalación ni la regla de Safari que borra los datos de un sitio tras 7 días de uso sin entrar.

Por eso el iPhone se prueba con un servidor con HTTPS, donde alcanza con abrir el link. **Esa prueba está pendiente.** Mientras tanto,
el riesgo es acotado: una elección de tres días, con la mesa preparada el día anterior, no llega a esos 7 días.
Si aun así pierde datos, lo enviado sigue en el servidor y el fiscal vuelve a preparar la mesa.

En ese momento, los pasos son estos:

| Cuándo | Qué hacer | Qué tiene que pasar |
|---|---|---|
| Día 1, con señal | Abrir el link, tocar **Preparar la mesa**, seguir los pasos para agregarla a inicio y abrirla desde el ícono | Entra con el número que mostró. En **Ajustes**, **Instalada** dice «sí» |
| Día 1 | Tocar **Preparar la mesa** | En **Ajustes**, mirar si **Almacenamiento protegido** dice «sí» |
| Día 1 | Poner modo avión, cerrar la app y abrirla | Abre igual |
| Día 1 | Tachar 20 personas y reiniciar el teléfono | Siguen tachadas y **Datos intactos** dice «sí» |
| Día 9 | Abrirla sin haberla abierto antes | Todo sigue ahí |

## Cómo se decide

- Si todo sigue ahí en el iPhone el día 9, la app web alcanza.
- Si la borra estando instalada, hay que decidir entre empaquetarla, que exige una Mac y una cuenta paga, o avisar que en iPhone
  la mesa se prepara el día anterior.
- Si tachar tarda más de 200 ms en un teléfono lento, hay que aligerar la interfaz.
