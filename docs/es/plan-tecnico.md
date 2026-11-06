# Plan técnico

[English](../en/technical-plan.md)

## Stack

| Pieza | Elección |
|---|---|
| Cliente | Una sola PWA con Svelte 5 y SvelteKit, sin renderizado en el servidor |
| Datos en el teléfono | IndexedDB con Dexie |
| Servidor | TypeScript en Node, con Fastify |
| Base de datos | Postgres, con esquema SQL versionado |
| Fotos de actas | Disco del servidor, o un almacenamiento compatible con S3, adonde llegan cifradas (ver [servidores](servidores.md)) |
| Instalación | Un pod de Podman sin root con app, Postgres y Caddy (TLS automático), que un script deja andando en un Ubuntu o Debian |
| Instalador | Un solo ejecutable para Windows, macOS y Linux, publicado en GitHub Releases. Es Node con sus archivos adentro: abre sus pantallas en el navegador, comparte los temas con la app, y se pudo probar de punta a punta |
| Escáner | Lector de padrones en Python para los PDF escaneados, que corre en la computadora con reconocimiento de texto local |

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

El instalador pide todo lo técnico una sola vez, para que la app arranque directamente con el partido:

1. **Dónde va a vivir.** Cuatro opciones, y todas tienen que funcionar:

   | Opción | Qué hace | Para quién |
   |---|---|---|
   | Crear un servidor nuevo | Con una credencial de Oracle, AWS o Google, que se usa una vez y no se guarda | La mayoría |
   | Ya tengo un servidor | Entra por SSH a una dirección y una llave | Quien ya tiene uno, en cualquier proveedor |
   | Pegar un texto | Da un bloque para pegar en el campo de inicio al crear el servidor | Quien no quiere darle una credencial al instalador |
   | Probar en esta computadora | Levanta todo localmente | Quien quiere mirarla antes de decidir |

2. **Cómo leer los padrones.** En esa computadora, que es lo recomendado; con su propia IA, pegando su clave; o después.
3. **Cómo se ve.** Todos los temas, con vista previa en claro y en oscuro.
4. **Instalar.** Termina con la dirección, una llave de recuperación para las copias de seguridad, y abriendo la app.

### Firma

Mi nombre puede figurar en una firma. Lo que no puede salir es mi dirección ni nada de mis máquinas.

- **Todo se compila y se firma en GitHub Actions**, con sus máquinas y nunca con la mía. Así el instalador no arrastra rutas ni
  nombres de equipo, y el servicio de sello de tiempo nunca ve mi IP.
- **Una firma no envía nada:** es un sello dentro del archivo. Lo único que puede revelar es lo que diga el certificado.

| Sistema | Qué se publica | Qué ve quien instala |
|---|---|---|
| Windows | Sin firmar. Cuando haya un release, se pide la firma gratuita de SignPath Foundation, cuyo certificado va a nombre de la fundación y no lleva datos míos | SmartScreen avisa hasta que haya firma: «Más información» y «Ejecutar de todas formas» |
| macOS | Firma ad-hoc, que no identifica a nadie. Si hace falta evitar el aviso: Developer ID y notarización, por USD 99 al año | macOS lo bloquea la primera vez: Ajustes, Privacidad y seguridad, «Abrir igual» |
| Linux | Un ejecutable | Sin aviso |

Descarto el certificado de código abierto de Certum, porque publica la ciudad y la provincia, y Microsoft Artifact Signing, que
para personas solo está disponible en Estados Unidos y Canadá.

Como un instalador sin firmar es fácil de falsificar, cada release publica su SHA-256 y una atestación de GitHub, que lo ata al
repo y al proceso de compilación. La guía explica cada aviso, con capturas, para que nadie los salte a ciegas.

## Diseño

La guía es que la use, sola y por primera vez, una persona que casi no usa el teléfono. La propuesta se puede ver en
`design/index.html`.

- **Una pantalla, una pregunta, un botón principal.** No hay menús.
- **Un plan por defecto.** La pantalla de inicio es una línea de estaciones: qué pasó, dónde estás y qué sigue. Cada rol tiene
  la suya, y el paso actual explica qué hacer.
- **Primero el partido, después cada elección.** Quien administra arma una vez el partido, el equipo y la seguridad. Después
  crea una elección cada vez que hace falta, porque un mismo partido usa la app varias veces al año.
- **Roles en palabras.** Se elige «cuidar una mesa», no una tabla de permisos, que igual se puede ajustar.

### Temas

Un tema es un archivo de datos, y un partido puede crear el suyo: colores para el modo claro y el oscuro, letras, formas, y unas
pocas recetas, como la forma de tachar o el material de los paneles. `design/verificar-contraste.mjs` rechaza lo que no se lee:
el texto tiene que llegar a 7:1, pensando en la vista de la gente grande.

| Tema | Idea |
|---|---|
| Aula | El tema por defecto: cuaderno rayado de día y pizarrón de noche, con letra hecha para quien ve poco |
| Vidrio | Paneles translúcidos sobre celeste y blanco; el que más le pide a un teléfono barato |
| Feria | Un color por tarea, para poder explicar por teléfono «tocá el verde» |
| Tablero | Sin adornos: el número manda, como un tablero de resultados |
| Mate | El más tranquilo: formas redondas, y quien ya votó se aparta con un tilde |

Todos los temas vienen incluidos, con Aula preseleccionado. Se eligen con vista previa en dos momentos: en el instalador, el que va a ver todo el partido al
entrar; y la primera vez que alguien abre la app, en el celular o en la computadora, donde puede cambiarlo para sí con un toque.

Las fuentes viajan con la app, porque tiene que funcionar sin señal, y todas tienen licencia OFL.

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
secuencia global un lector puede pasar por alto filas que confirman fuera de orden. Lo que llega después del cierre queda en
cuarentena para revisarlo, sin descartarse. Un teléfono revocado deja de enviar, y lo suyo sigue guardado en él.

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
- Cada persona entra con una invitación de un solo uso, que se convierte en una credencial de ese dispositivo. Los perfiles municipal
  y nacional piden además un código TOTP en cada dispositivo, salvo al fiscal, que solo ve su mesa.
- En iPhone, la app instalada arranca con su propio almacenamiento vacío: entra con un número de 8 cifras, de un solo uso y 15 minutos.

## Formato de padrón

Un archivo `.padron` es un ZIP con `manifest.json`, `units.jsonl` (la jerarquía) y `electors.jsonl` (una persona por línea).
La especificación se publica en el repo del escáner, con licencia CC0.

- Solo `id` y `full_name` son obligatorios, y `table` es opcional: los padrones reales llegan sin mesas asignadas.
- Lo que el padrón trae pero no cambia quién puede votar va en `extra`, y no se le muestra al fiscal.
- No hay campo para datos políticos: el semáforo vive solo en la app.
- Las filas dudosas se importan marcadas para revisar; nunca se descartan en silencio.
- La app también carga una planilla de Excel (`.xlsx`) o CSV: la convierte en `.padron` en el navegador, con las mismas reglas, y
  no lee las columnas que no conoce. Un PDF escaneado pasa antes por el lector de padrones, en la computadora.
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
   instalador con sus cuatro opciones, backups y guías de servidor. Es también cuando se prueba un iPhone de verdad, porque ya hay
   un servidor con HTTPS.
5. **Simulacro** con personas reales y datos falsos, incluido restaurar un backup en otro servidor.
6. **Landing:** un sitio estático, sin analíticas, formularios ni cookies, para publicitar la app y enlazar al instalador.

## Mediciones

Ver [resultados-etapa-1.md](resultados-etapa-1.md) y [resultados-etapa-4.md](resultados-etapa-4.md), que también lista lo que falta probar.
