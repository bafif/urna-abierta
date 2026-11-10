# Datos personales

[English](../en/personal-data.md) · [Volver al README](../../README.md)

> **Borrador.** Un abogado tiene que revisarlo antes de que te apoyes en él. No es asesoramiento legal: resume la ley y explica qué
> hace la app, para que llegues a esa consulta con las preguntas claras.

Esta guía es para quien administra Urna Abierta en un partido. Dice qué pide la Ley 25.326, qué herramienta de la app sirve para cada
cosa y hasta dónde llega cada una.

**El responsable es tu partido.** El proyecto no aloja datos ni tiene acceso a tu servidor. Quien instala la app lo acepta en la primera
pantalla, con la casilla «Entiendo que mi partido es el responsable de los datos que se carguen acá y de cumplir la ley de datos
personales». Qué se carga, quién lo ve, dónde está el servidor y cuándo se borra lo decide el partido. La
[información legal](../../LEGAL.md) tiene el resto.

## Qué datos guarda la app

| Qué | De dónde sale | Quién lo ve |
|---|---|---|
| Padrón: nombre, documento, legajo, número de orden, mesa y domicilio, si el archivo los trae | El archivo que subís | Coordinación ve todo. El fiscal ve solo su mesa hasta que se cierra la elección y, según la seguridad, el documento completo o sus últimos 3 números. Su teléfono conoce a cada persona por un identificador al azar, nunca por su documento |
| Quién votó y a qué hora | Los teléfonos de los fiscales | El fiscal de esa mesa, y coordinación al atender un pedido. Los demás ven solo cuántos |
| Semáforo: una categoría por persona | Quien anota en el semáforo | Quien tiene esa tarea. Las categorías sensibles, solo quien tiene el permiso aparte |
| Consentimiento: fecha y cómo se dio | Lo anotás vos | Coordinación |
| Equipo: nombre y teléfono de cada persona, y sus dispositivos | Lo cargás al sumar a alguien | Coordinación y sistema |
| Registro: quién hizo qué y cuándo | El servidor, solo | Coordinación y sistema |
| Fotos de las actas | Los fiscales | El jefe de esa mesa y coordinación |
| Copias de seguridad: todo lo anterior | El servidor, cada 6 horas. Si configuraste un almacenamiento S3, también van ahí | Quien tenga la llave de recuperación |

El servidor controla cada pedido y entrega solo lo que esa persona puede ver. Lo que puede hacer cada tarea está en **Más cosas**,
**Permisos**.

## Lo que pide la ley

- **Datos sensibles.** Las opiniones políticas y la afiliación son datos sensibles (art. 2). Nadie está obligado a darlos, y la ley
  prohíbe formar archivos que los revelen, salvo el registro de los propios miembros de una organización política (art. 7). Un semáforo
  que anota a quién vota una persona registra una opinión política.
- **Consentimiento.** Tiene que ser libre, expreso e informado, por escrito o por un medio equivalente (art. 5). No hace falta para un
  listado que se limita a nombre, documento, identificación tributaria o previsional, ocupación, fecha de nacimiento y domicilio (art. 5,
  inc. 2, c). La [guía de la AAIP para fines electorales](https://www.boletinoficial.gob.ar/detalleAviso/primera/208934/20190605)
  (Resolución 86/2019) admite tratar opiniones políticas con el consentimiento de su titular.
- **Informar al pedir un dato.** Para qué se usa, quién es el responsable, si la persona puede negarse y cómo ejerce sus derechos
  (art. 6).
- **Derechos de la persona.** Acceder a lo que se tiene de ella (art. 14), en forma clara y sin códigos (art. 15), y pedir que se corrija
  o se borre (art. 16). Es gratis (art. 19).
- **Plazos.** Para el acceso, 10 días corridos desde que la persona lo pidió de forma fehaciente (art. 14). Para corregir o borrar, 5 días
  hábiles desde que llegó el pedido (art. 16).
- **Seguridad y confidencialidad.** El responsable tiene que proteger los datos (art. 9), y quien los ve tiene que guardar secreto
  (art. 10). La AAIP publicó medidas de seguridad recomendadas en la Resolución 47/2018.
- **Borrar lo que ya no hace falta.** Los datos se destruyen cuando dejan de ser necesarios para lo que se juntaron (art. 4, inc. 7).
- **Servidores en otro país.** La transferencia internacional está limitada (art. 12). Los servidores gratuitos suelen estar fuera de
  Argentina: lo explica la [información legal](../../LEGAL.md#datos-personales-en-argentina).
- **Inscribir la base.** Un archivo de datos es lícito cuando está inscripto en el registro (arts. 3 y 21).

El texto completo está en la [Ley 25.326](https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790). La AAIP explica los
derechos de las personas en [su página](https://www.argentina.gob.ar/aaip/datospersonales/derechos).

## Inscribir la base en la AAIP

Se hace en línea, en Trámites a Distancia (TAD), en dos pasos: primero se inscribe el responsable, y después la base.

1. **El responsable.** [Inscribir un responsable de bases de datos personales privadas](https://www.argentina.gob.ar/servicio/inscribir-un-responsable-de-bases-de-datos-personales-privadas).
   Al terminar te dan un código de responsable: guardalo, porque lo vas a necesitar en cualquier trámite posterior.
2. **La base.** [Registrar bases de datos personales privadas](https://www.argentina.gob.ar/registrar-bases-de-datos-personales-privadas).

Todos los trámites del registro, incluidos modificar y dar de baja, están en
[Trámites ante el Registro Nacional de Bases de Datos Personales](https://www.argentina.gob.ar/aaip/datospersonales/tramites).
Esa página pide clave fiscal para inscribir a una persona jurídica. Los formularios, la documentación que se adjunta y si hay algún costo
pueden cambiar: confirmalos ahí antes de empezar. Esta guía no los copia para no quedar desactualizada.

Antes de empezar, conviene tener escrito:

- para qué se usa la base (organizar a los fiscales de una elección, y el semáforo si lo usás);
- qué datos tiene, con la tabla de arriba;
- dónde está el servidor: el proveedor y el país;
- quién accede: las tareas de la app y cuántas personas tiene cada una;
- qué medidas de seguridad tiene: las de [Seguridad de la instalación](#seguridad-de-la-instalación);
- cuándo se borra: la fecha en que vas a purgar.

Preguntas para el abogado:

- Si el partido o la agrupación no tiene personería, como muchas agrupaciones estudiantiles, ¿quién se inscribe como responsable?
- ¿La base es privada, o pública no estatal?
- Si el mismo servidor se usa para varias elecciones, ¿es una base o una por elección?

## Atender el pedido de una persona

Está en **Más cosas**, **Pedidos de personas**, y lo ve quien tiene la tarea «Coordinar conmigo». Cada búsqueda, descarga, corrección o borrado queda en el **Registro**, con quién lo hizo y cuándo.

1. **Comprobá quién pide.** La app no lo hace: pedile el documento en persona o por un medio en el que confíes. Darle los datos de alguien
   a otra persona es peor que no contestar.
2. **Buscala.** Escribí al menos tres letras del apellido, o el documento, y tocá «Buscar». Busca en todas las elecciones que no se
   purgaron, y muestra hasta 25 personas, cada una con su elección. Si aparece en varias elecciones, atendé cada una.
3. **Si pide ver sus datos.** Tocá «Bajar todo lo que tenemos». Se baja una página, en el idioma de la pantalla, para mandársela o
   imprimirla: sus datos del padrón, dónde vota, si votó, su categoría del semáforo, su consentimiento y sus derechos. Plazo: 10 días
   corridos.
4. **Si pide corregirlos.** En «Corregir sus datos», cambiá el nombre o el documento y tocá «Guardar la corrección». Plazo: 5 días hábiles.
5. **Si pide borrarlos.** Tocá «Borrar sus datos» y confirmá. Se borran su nombre, documento, legajo, domicilio, consentimiento y su marca
   del semáforo. La fila queda anónima, como «Borrado a pedido», para que los totales de la mesa sigan dando. Plazo: 5 días hábiles.
6. **Contestale por escrito,** con la fecha. El registro de la app guarda que se hizo, pero no qué le contestaste.

Tres cosas para tener en cuenta:

- **La página cubre una sola elección.** Si el mismo documento está en otros padrones, la página los nombra: atendé cada uno. Una
  categoría sensible aparece solo si quien baja la página tiene la tarea «Ver las categorías sensibles»; si no, la página dice que hay
  una y que la prepare alguien con ese permiso.
- **Una corrección o un borrado llega a los teléfonos que ya prepararon la mesa** la próxima vez que tengan señal: cada uno revisa cada
  5 minutos si cambió el padrón de su mesa y lo vuelve a bajar. Volver a subir el padrón no deshace ni lo corregido ni lo borrado.
- **Cada teléfono borra su padrón cuando se cierra la elección,** apenas se entera y ya envió todo. Un teléfono que no se entera, por
  falta de señal, lo borra pasadas las 6 de la mañana del día siguiente al último día de votación, más las horas que permite la
  seguridad: 12 en una elección de facultad, 6 en una municipal o provincial, ninguna en una nacional.
- **La ley prevé casos en que no corresponde borrar** (art. 16, inc. 5). Si alguien pide salir del padrón durante la votación,
  consultalo antes de tocar nada.

## El consentimiento

En la misma pantalla de la persona, en «Consentimiento», cargás la «Fecha» y «Cómo lo dio», y tocás «Guardar». Queda en el registro como
«Anotó un consentimiento».

- **Cuándo hace falta.** Para el semáforo, si anota opiniones políticas. Un padrón con solo nombre, documento y domicilio entra en la
  excepción del art. 5; si trae legajo u otros datos, preguntale al abogado.
- **Qué poner en «Cómo lo dio».** Dónde está la prueba, por ejemplo «formulario firmado, en la sede» o «mensaje del 3/4 al teléfono del
  partido». La app guarda solo la fecha y el medio: la prueba se guarda aparte.
- **Qué decirle al pedírselo.** Para qué se usa, que el responsable es el partido, que puede negarse, y cómo pedir ver, corregir o borrar
  sus datos.
- **Si lo retira.** Que alguien con la tarea del semáforo le saque la categoría con «Sacarle la categoría», o usá «Borrar sus datos», que
  también borra la marca.

## El semáforo y las categorías sensibles

El semáforo arranca vacío: cada partido define sus categorías en **Más cosas**, **Semáforo**. Al crear una, la casilla «Es sensible: dice
algo de sus ideas o de su afiliación…» hace que:

- solo la vea quien tiene la tarea «Ver las categorías sensibles»;
- cada vez que alguien la mira, el registro anote «Miró categorías sensibles»;
- solo quien tiene esa tarea pueda cambiarla o sacarla;
- se guarde cifrada en la base, con una clave que no está en la base.

Lo más seguro es no anotar opiniones políticas de nadie que no lo haya consentido. Si usás categorías sensibles, cargá el consentimiento
de cada persona antes de anotarla.

La casilla «Que cada fiscal vea estas categorías en el padrón de su mesa» solo se puede usar con la seguridad de facultad, y nunca
incluye las sensibles.

## Purgar después de la elección

Cuando la elección terminó, «Cerrar la elección» y después «Borrar los datos personales». La app pregunta «¿Borrar nombres, documentos y
marcas para siempre? Quedan solo los totales. No se puede deshacer.» La elección pasa a «Terminó, sin datos personales».

| Se borra | Queda |
|---|---|
| Nombres, documentos, legajos y domicilios del padrón, y los identificadores y números de orden de cada persona | Los totales de cada mesa: sobres y escrutinio |
| Las marcas del semáforo y los consentimientos | Las fotos de las actas |
| Quién votó y a qué hora | El equipo: nombre y teléfono de cada persona |
| | El registro, que nombra a cada persona por una referencia que ya no lleva a nadie |
| | Las copias de seguridad hechas antes, hasta que se renuevan |

- **Decidí la fecha antes de la elección,** con el abogado: por ejemplo, cuando ya no quede ningún reclamo posible sobre el resultado. La
  app no te lo recuerda, así que anotala en tu calendario.
- **El equipo no se borra al purgar.** Cuando ya no lo necesites, sacá a cada persona con «Sacar del equipo». Eso corta su acceso, pero su
  nombre y su teléfono quedan en la base hasta que borres el servidor.
- **Si el servidor era solo para esta elección,** borrarlo es lo más completo: lo explica la
  [guía de servidores](servidores.md#cuando-termina-la-elección).

## Las copias de seguridad

El servidor hace una copia cada 6 horas, cifrada con la llave de recuperación, y guarda las últimas 28: una semana. Están en el mismo
servidor, en `/opt/urna-abierta/copias`, y la app no las puede borrar. Si configuraste un almacenamiento S3, cada copia va también a la
carpeta `backups/` del bucket, que guarda las 28 más nuevas (lo explica la [guía de servidores](servidores.md#copias-fuera-del-servidor)).
Cada copia lleva toda la base, las fotos del disco y la clave que abre las categorías sensibles.

**Purgar o borrar a una persona no toca las copias.** Sus datos siguen ahí hasta que esas copias se renuevan, una semana después, y en
cada copia que bajaste a una computadora, para siempre.

Para no esperar esa semana, después de purgar y de comprobar que no vas a necesitar volver atrás:

1. Entrá por SSH al servidor y listá las copias: `sudo ls -l /opt/urna-abierta/copias`. La hora del nombre está en UTC: tres horas más
   que en Argentina.
2. Borrá las anteriores a la purga, una por una: `sudo rm /opt/urna-abierta/copias/urna-AAAAMMDD-HHMMSS.tar.gpg`. Si las copias van a un
   bucket, borralas también ahí, desde la página del proveedor.
3. Hacé una copia nueva, ya sin datos personales: `sudo urna copia`.
4. Borrá las copias que bajaste desde la app, de tu computadora y de cualquier nube o papelera donde las hayas puesto.

La contracara: sin esas copias no podés volver al estado de antes de purgar. Cuántas copias se guardan se cambia con la línea
`URNA_BACKUPS_KEPT` de `/opt/urna-abierta/.env`.

Si restaurás una copia anterior al borrado de una persona, esa persona vuelve: borrala de nuevo, con la constancia del pedido que ya
tenías.

## Seguridad de la instalación

- **Cada persona entra con un link propio, de un solo uso,** que vence a los 14 días. No hay contraseñas que se puedan adivinar o
  compartir.
- **Un teléfono o una computadora que nadie usó en 90 días deja de entrar,** y hace falta otra invitación. Quien usó una computadora
  compartida sale con **Ajustes**, **Salir en este dispositivo**: desde ese momento, ese acceso no sirve aunque alguien lo haya copiado.
- **El nivel de seguridad** se elige en **Más cosas**, **Seguridad**. En una elección municipal, provincial o nacional, todos menos los
  fiscales confirman con un código de una app como Google Authenticator o Aegis, y el fiscal ve solo los últimos 3 números de cada
  documento. Mientras una elección de ese tipo esté abierta, el servidor aplica al menos ese nivel y no deja bajarlo. Cada código sirve
  una sola vez: para confirmar otro dispositivo, esperá el siguiente.
- **El registro no se puede cambiar desde la app,** y la base rechaza editarlo, borrarlo o vaciarlo. Anota descargas del padrón, de datos
  de personas y de copias de seguridad, y quién buscó o miró a quién, por una referencia al azar, sin nombres ni documentos.
- **Las copias salen cifradas,** y sin la llave de recuperación no se abren.
- **Contales a fiscales y jefes que lo que ven es confidencial** (art. 10), y sacá del equipo a quien ya no lo necesite.

## Límites de esta versión

Esta lista es de noviembre de 2026. Una versión nueva puede resolver alguno: fijate en sus notas.

- Hasta la purga, el identificador interno de una persona borrada sale de su documento con la clave de campos, para reconocerla si se
  vuelve a subir el padrón. Quien tenga esa clave, que viaja en las copias de seguridad, puede probar todos los documentos hasta dar con
  el suyo. La fila borrada sigue en su mesa y con su número de orden, sin nombre ni documento, hasta la purga.
- Corregir el documento de una persona no cambia su identificador interno, que suele llevar el documento que traía el archivo: el viejo
  queda ahí hasta que se la borra o se purga.
- El cifrado de las categorías sensibles protege una copia de la base sacada sin el archivo `.env`. No protege una copia del disco entero
  ni una copia de seguridad abierta con la llave, porque la clave viaja con ellas.
- Las copias de seguridad salen del servidor solas solo si configuraste un almacenamiento S3, y una de más de 5 GB no entra. Si no, para
  tener una afuera, bajala desde la app.
