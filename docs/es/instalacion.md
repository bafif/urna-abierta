# Instalación

[English](../en/installation.md) · [Volver al README](../../README.md)

**Todavía no hay una versión publicada, y no se usó en una elección real.** Antes de usarla, hacé un [simulacro](simulacro.md).

## Probarla con personas inventadas

Hace falta Node 24 y Podman.

```sh
git clone https://github.com/bafif/urna-abierta
cd urna-abierta
corepack pnpm install
deploy/serve.sh
```

Te da un link para cada rol: fiscal, jefe de distrito, coordinación, semáforo y estadísticas. Cada link sirve una vez. Para verla como
en un teléfono, activá el modo de dispositivo con F12, o seguí la [prueba en un emulador de Android](pruebas-en-telefonos.md).

Para ver la propuesta de diseño alcanza con abrir `design/index.html` en el navegador.

## El instalador

Se baja de la página de releases de GitHub, para Windows, macOS o Linux: [Bajarlo y abrirlo](#bajarlo-y-abrirlo) dice cuál. Se abre en tu
navegador y solo se ve desde tu computadora.

Mientras no haya una versión publicada, se corre desde el código, en la carpeta del repo, con Node 24 y Podman:

```sh
deploy/instalador.sh
```

Arma las imágenes del servidor y de la app con ese mismo código, y abre el instalador. Con esas imágenes anda la opción de probar en
esta computadora; para instalar en un servidor hacen falta imágenes publicadas.

Te hace tres preguntas y hace el resto.

**1. ¿Dónde va a vivir tu Urna Abierta?** Cualquiera de estas opciones funciona:

| Opción | Qué necesitás |
|---|---|
| Crear un servidor nuevo | Una cuenta en Oracle Cloud, AWS o Google Cloud. [Acá está cómo crearla](servidores.md) |
| Ya tengo un servidor | Un Linux conocido (Debian, Ubuntu, Kali, Fedora, Arch, Alpine u openSUSE), su dirección y una llave SSH de un usuario con `sudo` sin contraseña, o la contraseña de root: sirve solo para entrar la primera vez, y después el servidor deja de aceptar contraseñas |
| Pegar un texto | Pegar un bloque al crear el servidor, sin darle ninguna credencial al instalador |
| Probar en esta computadora | Podman o Docker abierto. Para mirarla o hacer un simulacro: [con teléfonos](#probar-con-teléfonos-sin-servidor) |

**2. ¿Cómo leemos los padrones escaneados?** En tu computadora, con el lector de padrones, que es lo recomendado porque un padrón
trae datos de personas, o lo decidís después. Usar tu propia IA todavía no está disponible. El lector se baja aparte y solo hace falta
para los PDF escaneados: lo explica [Cargar el padrón](#cargar-el-padrón).

**3. ¿Cómo querés que se vea?** Elegís uno de los temas, viéndolos antes en claro y en oscuro. Cada persona lo puede cambiar después en
su teléfono. También podés [hacer el tuyo](temas.md) y cargarlo acá, arrastrando el archivo.

Al terminar te da la dirección de tu servidor, una llave de recuperación para las copias de seguridad y el archivo de acceso, con la llave para entrar al servidor y cómo actualizarlo o restaurar una copia. Cuando marcás «Ya guardé la llave», abre la app. Ahí sigue un
asistente para el partido, el equipo y la primera elección: lo recorre [Tu primera elección](primera-eleccion.md).

**Guardá esa llave.** Es lo único que abre tus copias de seguridad, y no se puede volver a generar.

### Probar con teléfonos sin servidor

Un teléfono necesita una dirección `https` para guardar la app y seguir andando sin señal, y tu computadora no tiene una. Hay dos maneras
de conseguirla sin crear un servidor:

| Manera | Para qué sirve | Qué pasa con los datos |
|---|---|---|
| **También desde los teléfonos**, en «Probar en esta computadora» | Un simulacro con varias personas, cada una con su teléfono, con wifi o con datos | Pasan por Cloudflare, que presta la dirección |
| Un teléfono Android con cable | Probarla vos solo | No salen de tu computadora |

**Con el túnel.** Elegí «También desde los teléfonos». Al terminar, la dirección es del estilo `https://algo.trycloudflare.com`: abrí la
app desde ahí, también en tu computadora, porque las invitaciones llevan la dirección desde la que se crean. Esa dirección dura mientras
la computadora esté prendida; si volvés a correr el instalador cambia, y cada teléfono vuelve a preparar la mesa. Para un simulacro con
un padrón de verdad, tené en cuenta que pasa entero por Cloudflare.

**Con cable.** Elegí «Solo desde esta computadora». Activá la depuración USB en el teléfono, conectalo y corré `adb reverse tcp:8090
tcp:8090` (`adb` viene en el paquete `android-tools`). En el teléfono, abrí `http://localhost:8090` en Chrome: para el teléfono es su
propia dirección, y ahí no hace falta `https`. Las invitaciones que crees desde `http://localhost:8090` en la computadora también andan
en ese teléfono. Si otro programa ya usaba el 8090, el instalador toma el siguiente libre y te lo muestra al terminar: en ese caso, usá
ese número en lugar de 8090.

## Cargar el padrón

En cada elección, en el paso «Padrón», tocás «Subir el padrón» y elegís el archivo. Antes de cargar nada, la app te muestra cuántas
personas entendió y qué cambia respecto de lo que ya estaba.

| Lo que tenés | Qué hacer |
|---|---|
| Una planilla de Excel (`.xlsx`) o CSV | La subís directo. Se usa la primera hoja, y la fila de títulos puede estar debajo de un título. Tiene que tener una columna «Apellido y nombre», «Nombre» o «Apellido», y puede tener «Nombres», «DNI» o «Documento», «Legajo», «N°» u «Orden», «Mesa» y «Domicilio». Las demás columnas no se leen |
| Una planilla `.xls` u `.ods` | La abrís y la guardás como `.xlsx` o CSV |
| Un PDF escaneado | Primero lo abrís con el [lector de padrones](https://github.com/bafif/urna-abierta-padrones#descargar), que corre en tu computadora sin mandar el padrón a ningún lado. Te da un archivo `.padron` |
| Un archivo `.padron` | Lo subís directo |

Hasta que se publique la primera versión del lector en su página de Releases, el lector se usa desde una terminal: su
[README](https://github.com/bafif/urna-abierta-padrones#readme) explica cómo.

Una planilla de Excel se convierte en `.padron` en tu teléfono o tu computadora, antes de mandarla al servidor. Si un PDF se sube
directo, la app no lo manda y te explica cómo leerlo.

Si algo no se puede leer, la app dice dónde está el problema (la fila, o la línea del archivo) y qué le pasa, sin mostrar lo que dice
esa fila. Junta los problemas iguales en un solo renglón. En una planilla, una fila sin nombre, o con el DNI o el legajo de una fila
anterior, queda afuera, y el resto se puede cargar igual. Una fila con un documento que no tiene 7 u 8 números se carga igual, marcada
para revisar.

Cuando el lector no está seguro de una fila, la marca para revisar. Esas personas se cargan igual que las demás, y la elección muestra
«Hay N personas del padrón para revisar». Al tocarlo ves cada una con su nombre y su documento: corregís lo que esté mal, o confirmás
que está bien.

## Qué servidor elegir

Lo verifiqué el 4/11/2026. Estos planes cambian seguido, así que confirmalo en su página antes de decidir. La
[guía de servidores](servidores.md) explica cada uno, paso a paso.

| Proveedor | Costo | A tener en cuenta |
|---|---|---|
| [Oracle Cloud](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) | Gratis y sin plazo | Puede recuperar instancias inactivas, y a veces no hay capacidad para crearlas |
| [AWS](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html) | Gratis hasta 6 meses | Al terminar el plan la cuenta se cierra, y los datos se borran a los 90 días |
| [Google Cloud](https://docs.cloud.google.com/free/docs/free-cloud-features) | Unos USD 3,65 por mes, por la dirección IP | Solo tiene el plan gratuito en Estados Unidos |

Dos cosas importan más que el proveedor:

- **La dirección IP tiene que ser fija.** Cada teléfono guarda sus datos asociados a esa dirección. Si cambia, cada fiscal vuelve a
  preparar la mesa y lo que no había enviado queda inaccesible.
- **Los servidores gratuitos suelen estar fuera de Argentina.** Eso tiene consecuencias legales, que corren por cuenta del partido.
  Están en la [información legal](../../LEGAL.md).

## Bajarlo y abrirlo

En la [página de releases](https://github.com/bafif/urna-abierta/releases/latest), bajá el de tu computadora. El instalador puede estar
sin firmar, así que tu computadora te va a avisar. Es esperable:

| Tu computadora | El archivo | Cómo abrirlo |
|---|---|---|
| Windows | `urna-abierta-instalador-windows.exe` | Doble clic. Si aparece «Windows protegió tu PC», tocá «Más información» y después «Ejecutar de todas formas» |
| Mac con chip Apple | `urna-abierta-instalador-mac-apple.zip` | Doble clic en el `.zip`, y después en `urna-abierta-instalador`. La primera vez macOS lo bloquea: andá a Ajustes, Privacidad y seguridad, y tocá «Abrir igual» |
| Mac con Intel | `urna-abierta-instalador-mac-intel.zip` | Igual que en una Mac con chip Apple |
| Linux (Debian, Ubuntu, Fedora, Arch y casi todos) | `urna-abierta-instalador-linux-x64.tar.gz` | Descomprimilo y, en una terminal abierta en esa carpeta, corré `./urna-abierta-instalador`. No hay aviso |
| Linux Alpine | `urna-abierta-instalador-linux-x64-musl.tar.gz` | Igual que en los otros Linux. Si no arranca, `apk add libstdc++` |

Para saber qué Mac tenés: menú Apple, «Acerca de esta Mac». Dice «Chip Apple M…» o «Procesador Intel».

Junto con el navegador se abre una ventana con letras sobre fondo negro. **Dejala abierta hasta terminar:** si la cerrás, el instalador
se frena.

Bajalo solamente de la página de releases, y comprobá que su SHA-256 sea el publicado. Un instalador falso es la forma más fácil de
robarle los datos a un partido.

[Comprobar la descarga](comprobar-descarga.md) explica cómo, en Windows, macOS y Linux.
