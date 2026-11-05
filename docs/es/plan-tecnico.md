# Plan técnico

[English](../en/technical-plan.md)

## Stack

| Pieza | Elección |
|---|---|
| Cliente | Una sola PWA con Svelte 5 y SvelteKit, sin renderizado en el servidor |
| Datos en el teléfono | IndexedDB con Dexie |
| Servidor | TypeScript en Node, con Fastify |
| Base de datos | Postgres, con esquema SQL versionado |
| Fotos de actas | Disco del servidor; S3 compatible como opción |
| Instalación | `compose` con app, Postgres y Caddy (TLS automático) |
| Escáner | CLI en Python, con reconocimiento de texto local |

Elegí una PWA para no depender de tiendas ni de una cuenta central: cada partido la sirve desde su propio dominio y el
fiscal entra con un link o un QR. Si los teléfonos reales la tratan mal, se empaqueta con Capacitor sin reescribirla.

## Servidores

La app apunta a poder correr en un servidor gratuito, sin depender de ningún servicio propio de una nube: solo Linux,
contenedores y disco. La guía de instalación cubre tres opciones, en este orden:

1. **Oracle Cloud Always Free:** el único gratis y sin plazo (ARM, equivalente a 2 OCPU y 12 GB). Puede recuperar
   instancias inactivas.
2. **AWS, plan gratuito:** para una sola elección, porque la cuenta se cierra a los 6 meses o al agotar los créditos.
3. **Google Cloud Free Tier:** cobra la IPv4 (unos USD 3,65 por mes) y solo tiene regiones en Estados Unidos.

Estos planes cambian seguido. Cada guía lleva la fecha en que se verificó y enlaces a las páginas oficiales.

- **El mínimo es 1 GB de RAM con CPU compartida**, en `amd64` y `arm64`, con imágenes ya compiladas.
- **El nombre del servidor no puede cambiar.** El teléfono guarda sus datos asociados a la dirección de la app. Un dominio
  propio permite mudarse de proveedor sin que los teléfonos pierdan nada.
- **Los backups salen cifrados y fuera de la cuenta**, con una clave que tiene solo el partido, porque una cuenta gratuita
  se puede cerrar.
- **El servidor es de temporada:** se crea unas semanas antes y se borra después de purgar los datos.
- **Datos y ley:** los servidores gratuitos suelen estar fuera de Argentina. La guía avisa, y decidir corre por cuenta del
  partido.

## Sin señal y sincronización

Todo se guarda primero en el teléfono, y la pantalla responde sin esperar a la red. Con señal, «Preparar mesa» baja el
padrón de esa mesa, sin domicilios. Cada acción es una operación con un identificador propio, y repetir un envío no
duplica nada.

| Dato | Regla |
|---|---|
| Tachado | Votó si hay una marca sin cancelar. Deshacer cancela solo las marcas que ese teléfono vio, así que la marca simultánea de otro fiscal se mantiene |
| Irregularidad | Solo se agrega; el estado lo cambia el jefe |
| Escrutinio | Cada carga es una versión nueva y nunca se fusiona. Si dos cargas difieren, decide el jefe |
| Foto del acta | Se identifica por su SHA-256 |
| Padrón, cronograma, permisos, semáforo | Se editan solo con señal |

Ninguna regla depende de la hora del teléfono. Cada mesa numera sus operaciones bajo un bloqueo de su fila, porque con una
secuencia global un lector puede pasar por alto filas que confirman fuera de orden. Lo que llega tarde o desde un teléfono
revocado queda en cuarentena para revisarlo, sin descartarse.

El aviso urgente se guarda y se envía. Si no sale, ofrece llamar, WhatsApp y SMS, con la mesa y el tipo de problema, sin
datos de votantes.

### Elecciones de varios días

Una elección puede durar varios días, así que la jornada no es una sola fecha:

- El padrón local vence al cierre de la elección, no a una cantidad fija de horas.
- Los tachados de un día siguen valiendo los días siguientes.
- Los turnos de los fiscales son por día.
- El panel no puede dar por terminada una mesa porque se haya hecho de noche.

## Roles y permisos

Cada permiso se asigna como usuario + rol + ámbito (elección, distrito, escuela o mesa), y puede vencer. Los permisos son
una lista fija; los roles son combinaciones editables. El servidor controla cada pedido y entrega solo lo que ese usuario
puede ver.

- El fiscal ve solo su mesa y no baja el semáforo, salvo que el partido lo habilite en una elección de bajo riesgo.
- El administrador técnico no ve datos políticos por su rol; para verlos necesita un permiso que queda registrado.
- Quien hace estadísticas ve solo agregados, con grupos de 5 personas o más, y su rol vence solo.
- Las categorías sensibles del semáforo llevan un permiso aparte y se cifran por campo. Eso protege copias de disco y
  backups, aunque no a un servidor en marcha, donde está la clave.
- El registro de auditoría no se puede editar.
- El fiscal entra con una invitación de un solo uso y un PIN; los demás roles, con passkey o contraseña y TOTP.

## Formato de padrón

Un archivo `.padron` es un ZIP con `manifest.json`, `units.jsonl` (la jerarquía) y `electors.jsonl` (una persona por línea).
La especificación se publica en el repo del escáner, con licencia CC0.

- Solo `id` y `full_name` son obligatorios, y `table` es opcional: los padrones reales llegan sin mesas asignadas.
- No hay campo para datos políticos: el semáforo vive solo en la app.
- Las filas dudosas se importan marcadas para revisar; nunca se descartan en silencio.
- Los ejemplos del repo llevan solo datos falsos.

## Idiomas

Todo va en español y en inglés, con el español como idioma principal. La interfaz tiene un selector, y el inglés se elige:
nunca se adivina. El código va en inglés.

## Licencia

- App y escáner: `AGPL-3.0-or-later`.
- Especificación del formato: `CC0-1.0`.
- Contribuciones: DCO, sin CLA.
- `LEGAL.md`, con un aviso de responsabilidad en castellano además del texto oficial en inglés. Un abogado lo revisa antes
  de publicar.

## Etapas

1. **Prueba de riesgos:** teléfonos reales, OCR sobre padrones reales y medición con 1 GB.
2. **Núcleo:** formato y validador, importación, mesas, login, vista del fiscal y permisos básicos.
3. **Jornada completa:** irregularidades, escrutinio con foto, panel del jefe, cronograma, varios días y modo práctica.
4. **Cumplimiento:** semáforo, permisos completos, auditoría, perfiles de seguridad, herramientas de la ley, purga,
   instalador, backups y guías de servidor.
5. **Simulacro** con personas reales y datos falsos, incluida una mudanza de proveedor en vivo.
6. **Landing:** un sitio estático, sin analíticas, formularios ni cookies, para quien instala el servidor.

## Mediciones de la etapa 1

Ver [resultados-etapa-1.md](resultados-etapa-1.md).
