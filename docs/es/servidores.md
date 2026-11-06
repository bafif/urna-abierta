# Crear un servidor

[English](../en/servers.md) · [Volver a la instalación](instalacion.md)

El instalador crea el servidor por vos, en cualquiera de estas tres nubes. Te pide una credencial, que usa una sola vez y no guarda.
Acá está cómo sacarla. Si preferís no dársela, elegí **Prefiero pegar un texto** y creás el servidor a mano: el final de esta página
explica cómo.

Estos planes y sus pantallas cambian seguido: ante cualquier duda, manda la documentación de cada proveedor.

**Estado.** La creación automática de servidores se probó contra simulaciones de cada API, y la firma de AWS contra su suite oficial,
pero todavía no contra las nubes reales. Lo probado de punta a punta es la instalación por SSH en un Ubuntu, incluido restaurar una copia
en otro servidor. Hasta que se pruebe, si la creación automática falla, la opción de pegar un texto hace lo mismo a mano.

## Oracle Cloud

Es la recomendada: gratis y sin plazo. Las máquinas son ARM y a veces no hay disponibles: el instalador prueba cada zona, y si no hay,
crea una x86 más chica. Oracle puede recuperar las instancias inactivas de las cuentas gratuitas, así que no la dejes sin usar.

1. Creá una cuenta en [oracle.com/cloud/free](https://www.oracle.com/cloud/free/). Te pide una tarjeta para verificarte.
2. Arriba a la derecha, tu perfil, **Mi perfil**, **Claves de API**, **Agregar clave de API**. Bajá la clave privada.
3. Oracle te muestra un bloque con todo lo que pide el instalador: `user`, `fingerprint`, `tenancy` y `region`.
4. Pegá esos datos en el instalador, junto con el contenido del archivo de la clave privada.

[Documentación de Oracle sobre las claves de API](https://docs.oracle.com/en-us/iaas/Content/API/Concepts/apisigningkey.htm).

Cuando termines, borrá esa clave de API: el instalador ya no la necesita.

## AWS

Gratis hasta 6 meses, o hasta agotar los créditos: alcanza para una elección. Al terminar el plan la cuenta se cierra y los datos se
borran a los 90 días, así que no dejes nada ahí.

1. Creá una cuenta en [aws.amazon.com/free](https://aws.amazon.com/free/).
2. Entrá a **IAM**, **Usuarios**, **Crear usuario**. Dale el permiso `AmazonEC2FullAccess`.
3. Dentro del usuario, **Credenciales de seguridad**, **Crear clave de acceso**. Copiá las dos partes.
4. Pegalas en el instalador. La región `sa-east-1` es São Paulo, la más cercana.

[Documentación de AWS sobre las claves de acceso](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html).

Cuando termines, borrá el usuario: el instalador ya no lo necesita.

## Google Cloud

La máquina es gratuita, pero la dirección IP se cobra: unos USD 3,65 por mes. Solo tiene el plan gratuito en Estados Unidos, y ahí la crea
el instalador.

1. Creá una cuenta y un proyecto en [console.cloud.google.com](https://console.cloud.google.com/), y activá la facturación.
2. Activá la **Compute Engine API** en ese proyecto.
3. **IAM y administración**, **Cuentas de servicio**, **Crear cuenta de servicio**. Dale el rol **Administrador de Compute**.
4. Dentro de la cuenta, **Claves**, **Agregar clave**, **JSON**. Se baja un archivo.
5. Pegá el contenido de ese archivo en el instalador.

[Documentación de Google sobre las cuentas de servicio](https://cloud.google.com/iam/docs/service-account-creds).

Cuando termines, borrá esa clave.

## Sin darle ninguna clave al instalador

Elegí **Prefiero pegar un texto**. Al final, el instalador te da un bloque. Creá vos el servidor, en cualquier proveedor:

- **Sistema:** Ubuntu 24.04.
- **Tamaño:** alcanza con 1 GB de memoria y 20 GB de disco.
- **Dirección fija:** IP reservada en Oracle, Elastic IP en AWS, IP estática en Google. Tiene que estar puesta antes de que arranque.
- **Puertos abiertos:** 80 y 443 en TCP, y 443 en UDP. El 22 solo si vas a entrar a mantenerlo.
- **Bloque:** pegalo en el campo de inicio. Se llama *user data*, *cloud-init* o *script de inicio*, según el proveedor.

El servidor se instala solo en unos minutos, y le pregunta a un servicio público cuál es su dirección. Volvé al instalador y escribila.

El bloque trae las claves de tu instalación. Queda guardado en la cuenta de esa nube: no lo compartas.

## Mantenerlo

Con SSH en el servidor:

```sh
sudo urna estado      # dice si está todo bien y qué hacer si no
sudo urna copia       # hace una copia cifrada ahora
sudo urna actualizar  # hace una copia y pasa a la última versión
sudo urna reiniciar   # vuelve a crear los contenedores con lo que dice /opt/urna-abierta/.env, sin borrar datos
```

Lo que estaba andando vuelve solo después de un reinicio.

### Actualizar

`sudo urna actualizar` baja la última versión publicada, hace una copia, cambia también los comandos de `urna` por los de esa versión y
vuelve a crear los contenedores, sin borrar datos. Para ir a una versión en particular: `sudo urna actualizar v0.2.0`. Mientras tanto,
el sitio deja de responder uno o dos minutos. `sudo urna estado` dice en qué versión está.

Actualizá antes de preparar una elección o después de cerrarla, nunca durante la votación ni en los días previos. Si una versión nueva
trae un problema, tiene que aparecer en un [simulacro](simulacro.md), no el día de la elección.

Si la versión nueva no arranca, `urna actualizar` lo dice, con lo último que dijo el servidor, y explica cómo volver: primero
`sudo urna actualizar` con la versión anterior y, si así tampoco arranca, restaurar la copia que hizo antes de actualizar.

La base queda en el formato de la versión nueva. Una copia hecha después de actualizar se restaura en esa versión o en una más nueva.

### Restaurar una copia

Primero subí la copia al servidor. Desde tu computadora, en la carpeta donde la bajaste y con la llave SSH del servidor:

```sh
scp -i tu-llave-ssh urna-20270406-063000.tar.gpg ubuntu@203.0.113.24:
```

En Windows ese mismo comando anda en PowerShell; también sirve [WinSCP](https://winscp.net/). La copia queda en la carpeta de tu
usuario. Después, en el servidor:

```sh
sudo urna restaurar urna-20270406-063000.tar.gpg TU-LLAVE-DE-RECUPERACION
```

Restaurar reemplaza todos los datos de ese servidor. Va la llave de recuperación de la instalación que hizo la copia: si es otra, lo
dice, y si el archivo no es una copia o se cortó al subirlo, también.

Las copias que el servidor haga después se abren con **su** llave de recuperación, no con la de la copia restaurada. Guardá las dos.

Si las fotos iban a un almacenamiento S3, en el servidor nuevo completá también las líneas `URNA_S3_...` de `/opt/urna-abierta/.env`
y corré `sudo urna reiniciar`: esos datos no entran en la copia, y sin ellos el servidor guarda en el disco y no encuentra las fotos del
bucket. `urna restaurar` te lo recuerda.

### Copias fuera del servidor

Las copias se hacen cada 6 horas y quedan en el disco del servidor: las últimas 28, una semana. Si se pierde el servidor, o la nube
cierra la cuenta, se pierden con él. Para tener siempre una afuera:

- **Bajalas desde la app**, en **Más cosas**, **Copias de seguridad**, cada tanto y sobre todo antes de la elección.
- **Mandalas a un almacenamiento S3.** Si configurás uno para las fotos (abajo), cada copia va también al bucket, a la carpeta
  `backups/`, y ahí quedan las 28 más nuevas. Siguen cifradas con la llave de recuperación: el proveedor guarda algo que no puede abrir.
  Para borrar las viejas, la clave de acceso necesita permiso de listar el bucket; sin él se mandan igual, pero se acumulan. Conviene un
  bucket de otro proveedor que el del servidor, así la copia sobrevive si se cierra esa cuenta.

`urna estado` dice si la última copia llegó al bucket. Sin S3, lo recuerda con una línea `aviso`: las copias quedan solo en ese
servidor.

## Fotos en un almacenamiento S3

Las fotos de las actas se guardan en el disco del servidor y entran en cada copia de seguridad. Para la mayoría de las elecciones
alcanza. Conviene mandarlas a un almacenamiento S3 si esperás muchas mesas (cada foto pesa hasta 8 MB y cada copia las lleva todas), si
el disco del servidor es chico, o si querés que las fotos queden aparte de la máquina.

Antes de salir del servidor, cada foto se cifra con AES-256-GCM, con una clave que sale de `URNA_FIELD_KEY`. El proveedor guarda datos
que no puede leer, con nombres que tampoco dicen de qué foto son. La contracara: sin `URNA_FIELD_KEY` esas fotos no se pueden abrir.
Esa clave viaja dentro de cada copia de seguridad; los datos del bucket (dirección, nombre y claves de acceso) no. Para recuperar todo
hacen falta la copia, la llave de recuperación y esos datos, que volvés a poner en el servidor nuevo.

| Variable | Qué es |
| --- | --- |
| `URNA_S3_ENDPOINT` | La dirección del servicio, sin el bucket. Ejemplos abajo. |
| `URNA_S3_BUCKET` | El nombre del bucket. Crealo antes, privado. |
| `URNA_S3_REGION` | La región del bucket. Si queda vacía, `us-east-1`. |
| `URNA_S3_ACCESS_KEY_ID` | La parte pública de la clave de acceso. |
| `URNA_S3_SECRET_ACCESS_KEY` | La parte secreta. |
| `URNA_S3_PREFIX` | La carpeta dentro del bucket. Si queda vacía, `fotos/`. Si no termina en `/`, se la agrega. |

Las fotos van al bucket solo si están `URNA_S3_ENDPOINT` y `URNA_S3_BUCKET`; si las dos quedan vacías, van al disco. Si está una sola,
o faltan las claves de acceso, el servidor no arranca y dice qué falta. Las direcciones usan el estilo de ruta
(`https://servicio/bucket/foto`), que aceptan todos los de abajo.

Para activarlo en un servidor ya instalado:

1. Editá `/opt/urna-abierta/.env` (por ejemplo con `sudo nano /opt/urna-abierta/.env`) y completá las líneas `URNA_S3_...`. Si tu
   servidor se instaló con una versión anterior, esas líneas no están: agregalas al final. Escribí los valores sin comillas ni espacios.
2. `sudo urna reiniciar`, para que el servidor tome lo nuevo. Los datos quedan.
3. `sudo urna estado` tiene que decir `bien   fotos: en el bucket ...`. Si dice `espera`, el servidor todavía está probando el bucket:
   volvé a correrlo en un minuto.

Cada vez que arranca, el servidor guarda, lee y borra un objeto de prueba. Si algo falla, lo escribe bien visible en su registro y
`urna estado` lo marca como `FALLA`, pero el resto sigue andando: una foto que no se puede guardar no se guarda en otro lado, y cada
teléfono la conserva y la vuelve a mandar hasta que entra. Para borrar el objeto de prueba hace falta permiso de borrar; si no se lo das,
queda uno solo, siempre el mismo.

Conviene decidirlo antes de la elección. Las fotos que ya estaban en el disco se siguen viendo y siguen entrando en la copia; las nuevas
van al bucket. Si después volvés al disco, las que quedaron en el bucket dejan de verse en la app.

**Las fotos del bucket no entran en la copia de seguridad.** La copia lleva la base y la carpeta de fotos del disco, que con S3 queda
vacía o con las de antes. Las fotos del bucket las cuida el proveedor; si querés más resguardo, activá el versionado del bucket. Las
copias, en cambio, sí van al bucket, a `backups/`: lo explica [Copias fuera del servidor](#copias-fuera-del-servidor).

Direcciones y regiones de cada proveedor:

- **AWS S3:** `https://s3.<región>.amazonaws.com`, por ejemplo `https://s3.sa-east-1.amazonaws.com` con la región `sa-east-1`. Tiene que
  ser la región del bucket. Para las claves, creá en IAM un usuario que solo pueda `s3:PutObject`, `s3:GetObject` y `s3:DeleteObject`
  sobre `arn:aws:s3:::TU-BUCKET/*`, y `s3:ListBucket` sobre `arn:aws:s3:::TU-BUCKET` (sin `/*`). Sin permiso de listar, AWS contesta
  «acceso denegado» en vez de «no existe» cuando le piden una foto que no tiene, y el servidor no puede distinguir una foto que falta de
  una clave sin permiso.
- **Oracle Object Storage:** usá su API compatible con S3, `https://<espacio-de-nombres>.compat.objectstorage.<región>.oci.customer-oci.com`,
  con la región de Oracle, por ejemplo `sa-saopaulo-1`. El espacio de nombres (*namespace*) aparece en los detalles del bucket. Las claves
  son una **clave secreta de cliente** (*Customer Secret Key*), de tu perfil: Oracle muestra la parte secreta una sola vez.
  [Documentación de Oracle](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi.htm).
- **Cloudflare R2:** `https://<id-de-cuenta>.r2.cloudflarestorage.com`, con la región `auto`. Las claves son un token de la API de R2
  con permiso de lectura y escritura de objetos en ese bucket.
  [Documentación de Cloudflare](https://developers.cloudflare.com/r2/api/s3/api/).
- **MinIO propio:** su dirección, por ejemplo `https://minio.tu-dominio.org`, con la región `us-east-1` si no le configuraste otra. Usá
  `https`: con `http` las fotos viajan cifradas igual, pero cualquiera en el camino ve los pedidos firmados. Solo dentro de una red propia
  da lo mismo.

**Estado.** Lo probé contra MinIO y contra una simulación que verifica cada firma; contra AWS, Oracle y R2 todavía no.

## Cuando termina la elección

El servidor es de temporada. Purgá los datos desde la app, bajá la última copia si hace falta y borrá la máquina, el disco y la dirección
en la consola de la nube. Si no los borrás, pueden seguir cobrando.

Si las fotos iban a un almacenamiento S3, purgar no las toca y borrar el servidor tampoco: siguen en el bucket, junto con las copias de
`backups/`, y el proveedor sigue cobrando por ellas. Cuando ya no las necesites, en la consola del proveedor vaciá el bucket (con todas las versiones, si activaste el
versionado), borralo y borrá la clave de acceso que creaste para el servidor.
