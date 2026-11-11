# Cómo contribuir

[English](CONTRIBUTING.en.md) · [Volver al README](README.md)

Gracias por querer sumarte. Urna Abierta es un proyecto personal mío: antes de un cambio grande, abrí un issue para charlarlo, así no
trabajás en algo que después no puede entrar. Si encontraste una falla de seguridad, no abras un issue: seguí [SECURITY.md](SECURITY.md).

## Firmá cada commit

No hay CLA: no le cedés nada a nadie, y tu código queda bajo la misma licencia que el resto, la
[AGPL-3.0-or-later](LICENSE). Lo único que se pide es el [Developer Certificate of Origin](https://developercertificate.org/) (DCO):
una línea al final de cada commit que dice que escribiste ese código, o que tenés derecho a aportarlo con esa licencia.

```sh
git commit -s
```

Eso agrega `Signed-off-by: Tu Nombre <tu@correo>`, con el nombre y el correo de tu configuración de git. Si no querés publicar tu correo,
usá el que te da GitHub, que termina en `@users.noreply.github.com`. Un pull request con commits sin esa línea no se puede aceptar. Si te
la olvidaste, en tu rama: `git rebase --signoff main` y después `git push --force-with-lease`.

## Las pruebas

Hace falta Node 26. Las pruebas del navegador necesitan además Podman.

```sh
corepack pnpm install
corepack pnpm test                                   # las pruebas unitarias de todo el repo
corepack pnpm check                                  # los tipos de cada paquete, con sus pruebas
node deploy/verificar-contraste.mjs                  # que todos los temas se puedan leer
sh deploy/server/prueba-estado.sh                    # lo que dice «urna estado», en los dos idiomas, con podman y curl de mentira
node deploy/verificar-documentos.mjs                 # que cada documento tenga su par en el otro idioma y sus enlaces lleguen
```

Las pruebas del servidor contra una base de verdad corren solo si les das una Postgres vacía. Sin `TEST_DATABASE_URL`, se saltean:

```sh
podman run -d --name urna-prueba-db -p 5432:5432 -e POSTGRES_USER=urna -e POSTGRES_PASSWORD=prueba -e POSTGRES_DB=urna \
  docker.io/library/postgres:18-alpine
TEST_DATABASE_URL=postgres://urna:prueba@localhost:5432/urna corepack pnpm test
```

Las pruebas de punta a punta arman los contenedores con Podman y manejan un navegador o una máquina Ubuntu:

| Comando | Qué prueba |
|---|---|
| `deploy/e2e.sh` | La app entera, contra Postgres, el servidor y Caddy de verdad |
| `deploy/e2e-instalador.sh` | El instalador, pantalla por pantalla, hasta la primera cuenta |
| `node apps/installer/e2e/texto.ts` | El bloque para pegar, tal como lo da el instalador, corrido por cloud-init como root en el primer arranque de un Ubuntu, hasta que la app responde en su dirección con certificado y `urna estado` dice que está todo bien |
| `node apps/installer/e2e/servidor.ts` | La instalación por SSH en dos Ubuntu: la copia cifrada, actualizar, volver de una versión que no arranca, restaurar en otro servidor y reiniciar |
| `deploy/e2e-lector.sh` | El lector de padrones, con el repo `urna-abierta-padrones` al lado de este |

Cada pull request corre en GitHub, cada una por su lado para que una que falla no tape a las otras: las unitarias, las del servidor con la
misma Postgres, las dos de navegador, la del bloque para pegar y, en Windows, Linux y las dos Mac, el instalador armado como se publica,
desempacado y arrancado. La de SSH tarda bastante más, así que corre en `main`, una vez por semana y antes de cada versión: si tu cambio
toca `deploy/server/` o el instalador, corréla vos y contalo en el pull request. La del lector necesita el otro repo y no corre en GitHub.

## Los idiomas

- **El código va en inglés:** nombres, comentarios, pruebas y mensajes de commit.
- **Lo que lee una persona va en castellano y en inglés.** Cada texto de la app está en `apps/web/src/lib/i18n.svelte.ts`, en los dos
  idiomas, y el chequeo de tipos falla si falta uno. Los del instalador están en `apps/installer/ui/texts.js`. Una prueba falla si a
  un texto le falta un idioma o si una pantalla escribe castellano por su cuenta.
- **La documentación va en `docs/es` y `docs/en`,** con la misma estructura. Los archivos de la raíz llevan su versión en inglés al lado,
  como `README.en.md`. Cada documento enlaza a su par arriba de todo, y `node deploy/verificar-documentos.mjs` falla si a uno le falta.
- **El castellano es rioplatense, con voseo,** llano y corto. Cada promesa va con lo que la hace cierta, y los límites se dicen como son.
- **Cada app arranca en el idioma del equipo:** castellano si alguno de los idiomas que prefiere el teléfono o la computadora es
  castellano, inglés si no. Siempre hay un selector a la vista, y lo que elige la persona manda.

## Cómo se trabaja

- **Nunca datos reales.** Ni en el código, ni en una prueba, ni en un issue o una captura. Para probar hay personas inventadas:
  `node deploy/padron-inventado.mjs 350 > padron.csv`, o `deploy/serve.sh`.
- **Una pantalla nueva o cambiada se aprueba antes de construirla.** Abrí un issue con la propuesta: una captura o un boceto alcanza.
- **Nada sale del servidor de cada partido.** Sin telemetría, sin servicios de terceros desde la app y sin nada que dependa de un servidor
  del proyecto.
- **Cada commit hace una sola cosa,** con el asunto en inglés con la forma `Área: qué cambió`, por ejemplo
  `Rolls: read the header below a title`. En el cuerpo va por qué.
