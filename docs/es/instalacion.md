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

Se baja de la página de releases de GitHub, para Windows, macOS o Linux. Se abre en tu navegador y solo se ve desde tu computadora. Mientras
no haya una versión publicada, se corre desde el código con `node apps/installer/src/main.ts`, y hay que tener las imágenes de los
contenedores armadas.

Te hace tres preguntas y hace el resto.

**1. ¿Dónde va a vivir tu Urna Abierta?** Cualquiera de estas opciones funciona:

| Opción | Qué necesitás |
|---|---|
| Crear un servidor nuevo | Una cuenta en Oracle Cloud, AWS o Google Cloud. [Acá está cómo crearla](servidores.md) |
| Ya tengo un servidor | Ubuntu o Debian, su dirección y una llave SSH de un usuario con `sudo` sin contraseña |
| Pegar un texto | Pegar un bloque al crear el servidor, sin darle ninguna credencial al instalador |
| Probar en esta computadora | Podman o Docker abierto. Solo se ve desde ahí |

**2. ¿Cómo leemos los padrones escaneados?** En tu computadora, con el lector de padrones, que es lo recomendado porque un padrón
trae datos de personas, o lo decidís después. Usar tu propia IA todavía no está disponible. El lector se baja aparte y solo hace falta
para los PDF escaneados: lo explica [Cargar el padrón](#cargar-el-padrón).

**3. ¿Cómo querés que se vea?** Elegís uno de los temas, viéndolos antes en claro y en oscuro. Cada persona lo puede cambiar después en
su teléfono. También podés [hacer el tuyo](temas.md) y cargarlo acá, arrastrando el archivo.

Al terminar te da la dirección de tu servidor y una llave de recuperación para las copias de seguridad, y abre la app. Ahí sigue un
asistente para el partido, el equipo y la primera elección: lo recorre [Tu primera elección](primera-eleccion.md).

**Guardá esa llave.** Es lo único que abre tus copias de seguridad, y no se puede volver a generar.

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

## Los avisos del sistema

El instalador puede estar sin firmar, así que tu computadora te va a avisar. Es esperable:

- **Windows:** tocá «Más información» y después «Ejecutar de todas formas».
- **macOS:** lo bloquea la primera vez. Andá a Ajustes, Privacidad y seguridad, y tocá «Abrir igual».
- **Linux:** no hay aviso.

Bajalo solamente de la página de releases, y comprobá que su SHA-256 sea el publicado. Un instalador falso es la forma más fácil de
robarle los datos a un partido.

[Comprobar la descarga](comprobar-descarga.md) explica cómo, en Windows, macOS y Linux.
