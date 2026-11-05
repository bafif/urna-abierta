# Instalación

[English](../en/installation.md) · [Volver al README](../../README.md)

**Todavía no se puede usar en una elección real.** La versión de hoy no tiene login y usa personas inventadas. Esta página explica
cómo probarla, y cómo va a ser la instalación cuando esté lista.

## Probarla hoy

Hace falta Node 24 y Podman.

```sh
git clone https://github.com/bafif/urna-abierta
cd urna-abierta
corepack pnpm install
deploy/serve.sh
```

Abrí `http://localhost:8090`. Para verla como en un teléfono, activá el modo de dispositivo con F12, o seguí la
[prueba en un emulador de Android](pruebas-en-telefonos.md).

Para ver la propuesta de diseño alcanza con abrir `design/index.html` en el navegador.

## Cómo va a ser

Vas a bajar un instalador desde la página de releases de GitHub, para Windows, macOS o Linux. Te hace tres preguntas y hace el resto.

**1. ¿Dónde va a vivir tu Urna Abierta?** Cualquiera de estas opciones funciona:

| Opción | Qué necesitás |
|---|---|
| Crear un servidor nuevo | Una cuenta en Oracle Cloud, AWS o Google Cloud. Te guiamos para crearla |
| Ya tengo un servidor | Su dirección y una llave SSH |
| Pegar un texto | Pegar un bloque al crear el servidor, sin darle ninguna credencial al instalador |
| Probar en esta computadora | Nada. Solo se ve desde ahí |

**2. ¿Cómo leemos los padrones escaneados?** En tu computadora, que es lo recomendado porque un padrón trae datos de personas; con
tu propia IA, pegando tu clave; o lo decidís después.

**3. ¿Cómo querés que se vea?** Elegís uno de los temas, viéndolos antes en claro y en oscuro. Cada persona lo puede cambiar después en
su teléfono.

Al terminar te da la dirección de tu servidor y una llave de recuperación para las copias de seguridad, y abre la app. Ahí sigue un
asistente para el partido, el equipo y la primera elección.

## Qué servidor elegir

Lo verifiqué el 4/11/2026. Estos planes cambian seguido, así que confirmalo en su página antes de decidir.

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
