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
| Instalador | App de escritorio para Windows, macOS y Linux, publicada en GitHub Releases |
| Escáner | CLI en Python, con reconocimiento de texto local |

Elegí una PWA para no depender de tiendas ni de una cuenta central: cada partido la sirve desde su propio dominio y el
fiscal entra con un link o un QR. Si un teléfono la trata mal, se empaqueta con Capacitor sin reescribirla: en Android es
barato, y en iPhone exige una Mac y una cuenta paga de desarrollador.

## Servidores

La app apunta a poder correr en un servidor gratuito, sin depender de ningún servicio propio de una nube: solo Linux,
contenedores y disco. La guía de instalación cubre tres opciones, en este orden:

1. **Oracle Cloud Always Free:** el único gratis y sin plazo (ARM, equivalente a 2 OCPU y 12 GB). Puede recuperar
   instancias inactivas.
2. **AWS, plan gratuito:** para una sola elección, porque la cuenta se cierra a los 6 meses o al agotar los créditos.
3. **Google Cloud Free Tier:** cobra la IPv4 (unos USD 3,65 por mes) y solo tiene regiones en Estados Unidos.

Estos planes cambian seguido. Cada guía lleva la fecha en que se verificó y enlaces a las páginas oficiales.

- **El mínimo es 1 GB de RAM con CPU compartida**, en `amd64` y `arm64`, con imágenes ya compiladas.
- **Se entra por la IP, sin dominio.** Caddy saca un certificado de Let's Encrypt para la IP, que dura 6 días, y lo renueva
  solo. Un dominio propio es opcional.
- **La IP tiene que ser fija:** IP reservada en Oracle, Elastic IP en AWS, IP estática en Google. El teléfono guarda sus datos
  asociados a esa dirección: si cambia, cada fiscal vuelve a preparar la mesa con el link nuevo y lo que no había enviado
  queda inaccesible. Por eso, mudarse de servidor durante la votación no es una opción.
- **Los backups salen cifrados y fuera de la cuenta**, con una clave que tiene solo el partido, porque una cuenta gratuita
  se puede cerrar.
- **El servidor es de temporada:** se crea unas semanas antes y se borra después de purgar los datos.
- **Datos y ley:** los servidores gratuitos suelen estar fuera de Argentina. La guía avisa, y decidir corre por cuenta del
  partido.

## Instalación y landing

La landing es una página estática que presenta la app y enlaza a un release de GitHub, con un instalador de escritorio para
Windows, macOS y Linux. No hay una versión alojada por el proyecto: alojaría los datos de los partidos, y yo pasaría a ser
encargado del tratamiento.

1. El administrador del partido baja el instalador y crea su cuenta gratuita en la nube, siguiendo la guía.
2. El instalador genera una llave SSH. El administrador la pega al crear el servidor, y copia su IP en el instalador.
3. El instalador entra por SSH, instala y configura todo, y abre `https://<IP>`, donde se completa el partido: nombre, tipo de
   elección, valores de seguridad, su usuario y el aviso de responsabilidad.
4. Desde ahí crea las cuentas y le manda a cada fiscal su link o QR.

Así hay un solo camino para los tres proveedores, y el instalador nunca maneja las credenciales de la nube del partido.

### Firma

Mi nombre puede figurar en una firma. Lo que no puede salir es mi dirección ni nada de mis máquinas.

- **Todo se compila y se firma en GitHub Actions**, con sus máquinas y nunca con la mía. Así el instalador no arrastra rutas ni
  nombres de equipo, y el servicio de sello de tiempo nunca ve mi IP.
- **Una firma no envía nada:** es un sello dentro del archivo. Lo único que puede revelar es lo que diga el certificado.

| Sistema | Qué se publica | Qué ve quien instala |
|---|---|---|
| Windows | Sin firmar. Cuando haya un release, se pide la firma gratuita de SignPath Foundation, cuyo certificado va a nombre de la fundación y no lleva datos míos | SmartScreen avisa hasta que haya firma: «Más información» y «Ejecutar de todas formas» |
| macOS | Firma ad-hoc, que no identifica a nadie. Si hace falta evitar el aviso: Developer ID y notarización, por USD 99 al año | macOS lo bloquea la primera vez: Ajustes, Privacidad y seguridad, «Abrir igual» |
| Linux | AppImage | Sin aviso |

Descarto el certificado de código abierto de Certum, porque publica la ciudad y la provincia, y Microsoft Artifact Signing, que
para personas solo está disponible en Estados Unidos y Canadá.

Como un instalador sin firmar es fácil de falsificar, cada release publica su SHA-256 y una atestación de GitHub, que lo ata al
repo y al proceso de compilación. La guía explica cada aviso, con capturas, para que nadie los salte a ciegas.

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

Un teléfono sin espacio es el peor caso, porque escribir en la base puede romperla y perderlo todo. La app lo comprueba al
abrirse, al preparar la mesa y cada 10 minutos, con una escritura aparte. Sin lugar, avisa y no deja tachar hasta que se libere;
si una escritura falla igual, la persona vuelve a la lista y la app lo dice. Nunca muestra como guardado lo que no se guardó.

El aviso urgente se guarda y se envía. Si no sale, ofrece llamar, WhatsApp y SMS, con la mesa y el tipo de problema, sin
datos de votantes.

### Elecciones de varios días

Una elección puede durar varios días, así que la jornada no es una sola fecha:

- El padrón local vence al cierre de la elección, no a una cantidad fija de horas.
- Los tachados de un día siguen valiendo los días siguientes.
- Los turnos de los fiscales son por día.
- La urna queda cerrada de noche. Al cierre de cada día se abre, se cuentan los sobres sin abrirlos y se vuelve a cerrar con
  todos adentro. La app tiene ese conteo por mesa y por día, y si no coincide con los tachados le avisa al jefe.
- El escrutinio se hace una sola vez, al final de la elección.
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
- Lo que el padrón trae pero no cambia quién puede votar va en `extra`, y no se le muestra al fiscal.
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

1. **Prueba de riesgos:** emulador de Android, OCR sobre padrones reales y medición con 1 GB.
2. **Núcleo:** diseño visual, que se aprueba antes de construir las pantallas; formato y validador, importación, mesas, login,
   vista del fiscal y permisos básicos.
3. **Jornada completa:** irregularidades, conteo diario de sobres, escrutinio con foto, panel del jefe, cronograma, varios días
   y modo práctica.
4. **Cumplimiento:** semáforo, permisos completos, auditoría, perfiles de seguridad, herramientas de la ley, purga,
   instalador, backups y guías de servidor. Es también cuando se prueba un iPhone de verdad, porque ya hay un servidor con
   HTTPS.
5. **Simulacro** con personas reales y datos falsos, incluido restaurar un backup en otro servidor.
6. **Landing:** un sitio estático, sin analíticas, formularios ni cookies, para publicitar la app y enlazar al instalador.

## Mediciones de la etapa 1

Ver [resultados-etapa-1.md](resultados-etapa-1.md).
