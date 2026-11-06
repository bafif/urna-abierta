# Tu primera elección

[English](../en/first-election.md) · [Volver al README](../../README.md)

Qué hacer desde que el instalador termina hasta que borrás los datos, y qué hacer si algo falla. Lo que está entre «» es lo que dice la
app, tal cual. Cómo crear y mantener el servidor está en la [guía de servidores](servidores.md), y qué pide la ley, en la de
[datos personales](datos-personales.md).

Antes de usarla en una elección de verdad, hacé un [simulacro](simulacro.md).

## 1. Entrar por primera vez

El instalador termina con «Tu Urna Abierta ya está andando», la «Dirección» y la «Llave de recuperación». Guardá la llave antes de
seguir: es lo único que abre tus copias de seguridad. «Abrir Urna Abierta» abre la app con el código de instalación ya puesto.

En «Vamos a crear tu cuenta» escribís tu nombre y tu teléfono, marcás «Entiendo que mi partido es el responsable de los datos que se
carguen acá y de cumplir la ley de datos personales» y tocás «Empezar». Esa casilla es la aceptación de la responsabilidad: la explica la
guía de [datos personales](datos-personales.md).

- **Si abriste la dirección sin ese link,** la app te pide también el «Código de instalación». Está en el servidor, en la línea
  `URNA_SETUP_CODE` de `/opt/urna-abierta/.env`.
- **Solo la primera cuenta se crea así.** Las demás personas entran con una invitación.
- **Hacelo en el navegador que vas a usar,** porque tu acceso queda en ese navegador. Si borrás sus datos o lo perdés, solo otra persona
  con la tarea «Coordinar conmigo» te puede mandar una invitación nueva. Por eso conviene sumar a una segunda persona de confianza con esa
  tarea, apenas armes el equipo.

Tu cuenta tiene las tareas de coordinación y de sistema, así que ves todo lo que sigue.

## 2. El partido, el equipo y la seguridad

La pantalla de inicio te saluda y muestra cuatro pasos: «Tu partido», «Tu equipo», «Seguridad» y «Tu primera elección». «Seguir» te lleva
al que toca. Podés cerrar y seguir otro día: queda dónde estabas.

**Tu partido.** «¿Cómo se llama tu partido o agrupación?». Se cambia después en **Más cosas**, **Tu partido**.

**Tu equipo.** En «¿Quién trabaja con vos?», tocá «Sumar a alguien», escribí su nombre y su teléfono, y elegí qué va a hacer:

| Botón | Tarea | Qué puede hacer |
|---|---|---|
| «Cuidar una mesa» | Fiscal | Ve solo el padrón de su mesa. Conviene sumarlos desde la elección, en el paso 6 |
| «Ayudar a varios fiscales» | Jefe de distrito | Ve sus mesas y recibe sus avisos. Conviene sumarlos desde «Distritos», en el paso 5 |
| «Anotar quién nos vota» | Semáforo | Anota una categoría por persona |
| «Ver los números» | Estadísticas | Ve cuántos votaron, nunca un nombre |
| «Ver más tareas», «Ver las categorías sensibles» | Semáforo sensible | Ve las categorías sensibles, y cada vez queda registrado |
| «Ver más tareas», «Coordinar conmigo» | Coordinación | Arma elecciones y equipos, y atiende pedidos de personas |
| «Ver más tareas», «Cuidar el sistema» | Sistema | Usuarios, seguridad y copias. No ve el padrón |

Al tocar «Invitar» aparece «Mandale esto a…», con un dibujo para escanear y tres formas de mandar el link: «Mandar por WhatsApp» (si
cargaste el teléfono), «Compartir» o «Copiar el link». Cada link sirve una sola vez, solo para esa persona, y vence a los 14 días.

- **Si no le llegó o ya venció,** en «Tu equipo» tocá a la persona y después «Mandar otra invitación». Quien todavía no entró dice
  «todavía no entró».
- **Para sacar a alguien,** «Sacar del equipo». Su teléfono deja de funcionar la próxima vez que se conecta.
- **Lo que puede hacer cada tarea** está en «Ver permisos», o en **Más cosas**, **Permisos**. Vienen con lo recomendado: cambialos solo si
  tenés un motivo. «Volver a lo recomendado» deshace los cambios.

**Seguridad.** «¿Qué tan delicada es tu elección?». Esto cambia cada opción:

| | «Facultad o centro de estudiantes» | «Municipal o provincial» | «Nacional» |
|---|---|---|---|
| El fiscal ve el documento | Completo | Sus últimos 3 números | Sus últimos 3 números |
| Todos menos los fiscales confirman con un código | No | Sí | Sí |
| Los fiscales pueden ver el semáforo de su mesa, si lo activás | Sí | No | No |

Con el código, la app muestra «Un paso más de seguridad»: cada persona escanea un dibujo con una app de códigos, como Google
Authenticator o Aegis, y escribe los seis números. Eso te incluye a vos. Mientras haya una elección municipal, provincial o nacional
abierta, el servidor aplica al menos su nivel y no deja bajarlo; cuando se cierra, vuelve el que elegiste. Se cambia en **Más cosas**,
**Seguridad**.

## 3. La elección

Tocá «Crear una elección».

1. **«¿Qué elección es?»** Elegí el tipo y escribí cómo la llamás.
2. **«¿Qué días se vota?»** Tocá cada día en el calendario. Si son varios, la urna se cierra cada noche y los fiscales cuentan los sobres
   al cierre de cada día.
3. **«¿Qué se vota?»** En «Qué se elige», el cargo o el órgano; en «Las listas, una por renglón», las listas. Si se vota más de una cosa,
   «Se vota algo más». En blanco, nulos y recurridos ya están.
4. **«Crear la elección».**

La elección muestra sus pasos: «Padrón», «Mesas», «Fiscales», «Votación», «Escrutinio» y «Cierre». Abajo está siempre el botón de lo que
sigue.

## 4. El padrón

Tocá «Subir el padrón», elegí el archivo y mirá lo que la app entendió antes de tocar «Cargarlo». Qué archivos sirven y cómo se lee un PDF
escaneado está en [Cargar el padrón](instalacion.md#cargar-el-padrón).

Si aparece «Hay N personas del padrón para revisar», tocalo: corregí lo que esté mal o tocá «Está bien».

Conviene subir el padrón definitivo antes de que los fiscales preparen su mesa. Si después lo corregís o lo volvés a subir, el cambio les
llega a los teléfonos que ya la prepararon la próxima vez que tengan señal, y el fiscal ve «Se actualizó el padrón de tu mesa.». Volver a
subirlo no deshace lo que corregiste ni a quien borraste a pedido.

## 5. Las mesas y los distritos

Si el padrón ya traía las mesas, este paso está hecho. Si no, la app dice «Te proponemos N mesas», por apellido: cambiá «Personas por
mesa» si hace falta y tocá «Está bien». Después, tocá cada mesa para cambiarle el «Nombre» o escribir «Dónde queda», y «Listo».

**Distritos.** Si son pocas mesas, no hacen falta. Si no, en la elección tocá «Distritos», escribí el «Nombre del distrito» y tocá «Agregar
distrito». Tocá el distrito para elegir sus mesas, y «Sumar a su jefe» para invitarlo. Cada jefe ve solo las mesas de su distrito.

## 6. Los fiscales

Tocá «Ver los fiscales». La app dice cuántas mesas faltan. Tocá una mesa sin fiscal, escribí quién va y tocá «Invitar». Si la elección
dura varios días, elegís qué días va: cada día puede ir una persona distinta.

Cuando estén todos, «Invitar a los fiscales» arma una invitación nueva para cada fiscal que todavía no entró: se mandan de a una con
«Mandar por WhatsApp», o todas juntas con «Copiar todos».

Pediles a los fiscales que, uno o dos días antes y con señal:

- abran su link y toquen «Empezar»;
- toquen «Preparar la mesa», que baja el padrón al teléfono para usarlo sin señal;
- prueben «Practicar», con personas inventadas;
- en iPhone, agreguen la app a la pantalla de inicio y entren con el número que les da **Ajustes**, «Instalar en el iPhone». Vale por 15
  minutos y una sola vez.

En «Tu equipo» ves quién «todavía no entró».

## 7. El día de la votación

Antes de empezar, bajá una copia en **Más cosas**, **Copias de seguridad**, y otra cada noche.

Tocá «Abrir la votación». Desde ahí, «Ver cómo va» muestra primero las mesas que necesitan algo:

- «aviso urgente»: un fiscal avisó que algo anda mal. Tocá la mesa, llamalo, y cuando esté resuelto tocá «Ya está resuelto». Mientras
  «Ver cómo va» está en pantalla, un aviso nuevo hace vibrar el teléfono, suena y aparece en el ícono de la app;
- «los sobres no coinciden»: al contar los sobres, el número no dio con los tachados;
- «sin datos»: la mesa no manda nada hace un rato. Puede ser falta de señal: llamá al fiscal.

Si todo anda bien, dice «Todo en orden». «Números» muestra cuántos votaron, sin nombres.

## 8. Escrutinio y cierre

Al terminar la votación, «Pasar al escrutinio». La votación ya no se puede volver a abrir. Cada fiscal carga los votos de a una lista y
saca la foto del acta.

Si dos fiscales cargan números distintos en la misma mesa, aparece «dos escrutinios distintos»: hablá con la mesa y tocá «Vale esta» en
la que corresponde.

Antes de cerrar, revisá mesa por mesa que estén el escrutinio y la foto, y que los fiscales vean «Todo llegó bien». Después tocá «Cerrar
la elección»: lo que llegue después queda aparte y no cuenta. Desde ese momento, fiscales y jefes ya no ven el padrón; cada teléfono lo
borra apenas mandó todo, y el fiscal ve «La elección terminó. Gracias».

## 9. Borrar los datos

Con la elección cerrada, «Borrar los datos personales» borra nombres, documentos, marcas del semáforo y quién votó. Quedan los totales.
No se puede deshacer. Qué queda, qué pasa con las copias de seguridad y cómo borrarlas está en
[Purgar después de la elección](datos-personales.md#purgar-después-de-la-elección).

Después, sacá del equipo a quien ya no lo necesite, y si el servidor era solo para esta elección, seguí
[Cuando termina la elección](servidores.md#cuando-termina-la-elección).

## Si algo falla

Un fiscal sin conexión sigue trabajando: todo se guarda en su teléfono y se manda solo cuando vuelve la señal. Si algo urgente no sale,
que llame: no hay que esperar a la app.

### El servidor no responde

Se nota porque nadie puede entrar, los teléfonos juntan cosas «sin enviar» y el panel muestra todas las mesas «sin datos».

1. Abrí la dirección desde una computadora con internet. Si no carga, el problema es el servidor.
2. Entrá por SSH y corré `sudo urna estado`. Cada renglón dice `bien`, `aviso`, `espera` o `FALLA`, y qué hacer. Un `aviso` no es una
   falla: vale la pena saberlo, pero todo anda.

   | Dice | Qué hacer |
   |---|---|
   | `FALLA  db`, `server` o `web: está …` | `sudo urna arrancar` |
   | `FALLA  el servidor responde: no contesta` | Mirá lo último que dijo el servidor, con el comando de abajo |
   | `FALLA  disco: quedan N MB` | Bajá la última copia desde la app y borrá copias viejas de `/opt/urna-abierta/copias` |
   | `FALLA  copias: no hay una reciente` | `sudo urna copia` |
   | `FALLA  copias en el bucket` | `sudo urna copia`, y fijate qué dice. Lo explica [Copias fuera del servidor](servidores.md#copias-fuera-del-servidor) |
   | `FALLA  hora` | `sudo timedatectl set-ntp true`. Sin la hora bien, fallan el certificado y los códigos |
   | `FALLA  certificado`, y `espera el servidor responde: sin certificado` | Abrí los puertos 80 y 443 en la nube, como dice la [guía de servidores](servidores.md#sin-darle-ninguna-clave-al-instalador). Todo sigue andando, y el certificado llega solo; si los puertos estuvieron cerrados mucho tiempo puede tardar horas, y «urna reiniciar» lo pide de nuevo enseguida |
   | `FALLA  fotos` | Lo explica [Fotos en un almacenamiento S3](servidores.md#fotos-en-un-almacenamiento-s3) |

   Para ver lo último que dijo el servidor:

   ```sh
   sudo runuser -u urna -- env XDG_RUNTIME_DIR=/run/user/$(id -u urna) HOME=/opt/urna-abierta podman logs --tail 50 urna-server
   ```

   Si `urna arrancar` o `urna reiniciar` dicen «El servidor se frena apenas arranca», muestran por qué. Casi siempre es un dato de
   `/opt/urna-abierta/.env`: corregilo y corré `sudo urna reiniciar`.
3. Si no podés entrar por SSH, mirá en la consola de la nube que la máquina esté prendida, y reiniciala desde ahí. Todo vuelve solo después
   de un reinicio. Oracle puede recuperar las máquinas gratuitas que no se usan, y la cuenta gratuita de AWS se cierra al terminar el plan.
4. Si la máquina se perdió, instalá una nueva y restaurá la última copia, como dice [Mantenerlo](servidores.md#mantenerlo). Si cambia la
   dirección, cada fiscal tiene que volver a preparar la mesa, y lo que no había enviado queda en su teléfono sin poder salir. Por eso no
   conviene mudarse de servidor durante la votación.

### Un teléfono no se sincroniza

El fiscal ve «N sin enviar. Queda guardado y se manda solo cuando haya señal.» Mientras espera, no se pierde nada.

1. **Fijate si tiene señal.** En **Ajustes**, «Estado de este teléfono», «Conexión ahora». Probá con datos móviles en vez del wifi, o al
   revés.
2. **Si los demás teléfonos mandan y este no,** puede decir «Este teléfono ya no tiene acceso»: lo sacaron del equipo o se usó su
   invitación en otro lado. Mandale otra desde «Tu equipo» y que toque «Tengo otra invitación». Lo que no había enviado sigue guardado.
3. **Si ningún teléfono manda,** es el servidor: mirá la sección de arriba.
4. **Si dice que se queda sin espacio,** que borre fotos o videos y toque «Probar de nuevo». Mientras tanto, que anote en papel.
5. **Que nunca borre la app ni los datos del navegador** con cosas sin enviar: eso sí se pierde.
6. Si la elección ya está cerrada, lo que llega después queda aparte y no cuenta.

En **Ajustes**, «Copiar informe» arma un informe técnico del teléfono, sin datos de ninguna persona, que el fiscal te puede mandar.

### Una foto no sube

La foto queda guardada en el teléfono hasta que llega, y cuenta entre lo que falta enviar. El jefe ve «Avisaron que hay una foto del acta,
pero todavía no llegó. Aparece sola cuando llegue.»

1. Que el fiscal deje la app abierta un rato con señal. Una foto pesa bastante más que un tachado, y con poca señal tarda. Si el
   teléfono dice «El servidor no aceptó la foto del acta. Sacala de nuevo.», que saque otra: lo demás sigue saliendo.
2. Si no sube la de ningún teléfono, corré `sudo urna estado` y mirá los renglones `fotos` y `disco`.
3. Mientras tanto, que saque otra foto del acta con la cámara del teléfono y se la mande a su jefe por WhatsApp. La de la app sigue
   esperando y entra sola.

### El navegador avisa que la conexión no es privada

No le digas a nadie que siga igual. Ese aviso puede ser alguien en el medio, y la app lleva nombres y documentos.

- **Recién instalado,** el certificado puede tardar unos minutos. Cuando está, `sudo urna estado` dice `certificado hasta:` y una fecha.
- **Con los puertos 80 y 443 cerrados,** el certificado no se saca ni se renueva. El de una dirección IP dura unos 6 días y se renueva
  solo, así que si alguien cierra un puerto, a los pocos días empieza a avisar.
- **Si avisa en un solo teléfono,** fijate que tenga la fecha y la hora automáticas. Si es muy viejo, puede no reconocer el certificado:
  que use otro teléfono.
- **Si avisa en todos,** corré `sudo urna estado` y mirá los renglones `hora` y `certificado`. Si cambiaste la dirección, o usás un dominio
  propio, fijate que apunte al servidor.

### Alguien no puede entrar

- **«Ese link ya se usó o venció»:** mandale otra invitación desde «Tu equipo».
- **En iPhone, la app instalada arranca vacía:** en Safari, **Ajustes**, «Instalar en el iPhone», y el número que muestra se escribe en la
  app instalada.
- **«Ese código no es»** al confirmar con la app de códigos: casi siempre es la hora del teléfono. Que la ponga automática.
- **Perdiste tu propio acceso:** otra persona con «Coordinar conmigo» te manda una invitación nueva. Si no hay nadie más con esa tarea,
  desde la app no hay forma de volver a entrar.

## Límites de esta versión

Esta lista es de noviembre de 2026. Una versión nueva puede resolver alguno: fijate en sus notas.

- Una elección no se puede editar desde la app después de crearla: revisá los días y las listas antes de «Crear la elección».
- A una persona del equipo no se le puede cambiar la tarea, ni darle una segunda: hay que sacarla y sumarla de nuevo. Por eso, «Ver las
  categorías sensibles» todavía no sirve: necesita ir junto con «Anotar quién nos vota».
- De las mesas se puede cambiar solo el nombre y dónde quedan, y solo hasta cerrar la elección.
- No hay una vista con todas las mesas a la vez para el escrutinio: se revisa mesa por mesa.
- Un aviso urgente suena y vibra solo con «Ver cómo va» en pantalla: desde otra pantalla, como el detalle de una mesa, no.
- La app no te recuerda cuándo purgar.
