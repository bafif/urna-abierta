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
sudo urna actualizar  # baja la última versión
```

Lo que estaba andando vuelve solo después de un reinicio. Las copias de seguridad se hacen cada 6 horas, y se bajan desde la app, en
**Más cosas**, **Copias de seguridad**. Para volver a poner una en un servidor nuevo:

```sh
sudo urna restaurar /ruta/a/la/copia.tar.gpg TU-LLAVE-DE-RECUPERACION
```

## Cuando termina la elección

El servidor es de temporada. Purgá los datos desde la app, bajá la última copia si hace falta y borrá la máquina, el disco y la dirección
en la consola de la nube. Si no los borrás, pueden seguir cobrando.
