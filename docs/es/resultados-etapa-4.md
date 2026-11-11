# Qué se probó, y qué falta

[English](../en/stage-4-results.md) · [Riesgos iniciales](resultados-etapa-1.md) · [Volver al README](../../README.md)

Mediciones con personas inventadas. Todo se puede repetir con los comandos de cada sección.

## Lo que falta probar

Esto necesita una cuenta en la nube, una dirección pública, otro equipo o personas de verdad. Hasta que se pruebe, no está
comprobado:

| Qué | Por qué falta | Qué se hizo mientras tanto |
|---|---|---|
| Crear servidores en Oracle, AWS y Google | Hace falta una cuenta en cada una | Se probó contra simulaciones de cada API. La firma de AWS coincide con su suite oficial de pruebas |
| Certificado de Let's Encrypt para una IP | Hace falta una dirección pública | Caddy entiende la configuración. Se probó con un certificado interno |
| Un servidor gratuito de verdad | Lo mismo | Se midió con esos límites, en una computadora de escritorio |
| El instalador en Windows y macOS | Hace falta una computadora con cada sistema | En cada cambio, GitHub Actions lo arma, lo desempaca y lo arranca en Windows, Linux y las dos Mac |
| Un iPhone real | No hay emulador para Linux | Se probó con WebKit, que no reproduce ni la instalación ni el borrado por inactividad de Safari |
| Personas de verdad | Es el [simulacro](simulacro.md) | Nada lo reemplaza |

## El recorrido completo, en el navegador

`deploy/e2e.sh`, contra los contenedores reales, en Chrome de Android y en WebKit de iPhone: 46 pruebas pasan, y 2 se
saltean porque solo aplican a un navegador. La más larga es una elección entera: desde crearla hasta borrar los nombres,
con el padrón, las mesas, cada fiscal con su link, los tachados, los sobres, el escrutinio, la foto del acta y el panel de
quien coordina.

## Instalar de verdad

`node apps/installer/e2e/servidor.ts`, sobre dos máquinas Ubuntu en contenedores, con la instalación real por SSH:

| Comprobación | Resultado |
|---|---|
| Instala por SSH y arranca | Sí |
| Usa el tema elegido, y el primer administrador solo entra con el código | Sí |
| La copia de seguridad no deja leer ningún nombre, y se baja desde la app | Sí |
| Con otra llave, la copia no se abre | Sí |
| Restaurada en otro servidor, está todo, con las mismas sesiones y las categorías sensibles legibles | Sí |
| Después de reiniciar, vuelve sola | Sí |

`deploy/e2e-instalador.sh` recorre las pantallas del instalador en un navegador, desde la primera hasta el primer
administrador en la app: 7 de 7, en unos 25 segundos.

## Un teléfono Android

`apps/web/e2e-android/check.mjs`, en Chrome de un emulador de Android: 14 de 14.

| Comprobación | Resultado |
|---|---|
| Abre sin señal, desde cero | Sí |
| Sobrevive al reinicio y a adelantar el reloj 9 días | Sí, con los datos intactos |
| Sin espacio, avisa y no deja tachar. Al liberar, sigue todo | Sí |
| Al volver la señal, llega todo al servidor | 26 de 26 operaciones |
| Tachar con 350 personas y la CPU 6 veces más lenta (mediana / peor) | 26 ms / 84 ms |
| Tachar con 5.000 personas y la CPU 6 veces más lenta (mediana / peor) | 35 ms / 77 ms |

## El servidor con 1 GB

`deploy/measure.sh`, en un pod limitado a 1 GB de memoria y un cuarto de procesador, con Postgres, servidor y Caddy
adentro, TLS real y una conexión por teléfono. Cada mesa tiene 350 personas. Hora pico son 120 votos por hora en cada mesa
y un jefe cada 10 mesas, que mira su panel cada 20 segundos. Cuando vuelve la señal, cada mesa manda 100 operaciones
pendientes.

| Mesas | Situación | Respuesta (p95) | Mesa al día (p95) | Reintentos | Perdidas o duplicadas | Memoria máxima |
|---|---|---|---|---|---|---|
| 100 | Hora pico | 116 ms | | 0 | | 292 MB |
| 100 | Vuelve la señal, repartida en 30 s | 194 ms | 0,5 s | 0 | 0 | 325 MB |
| 100 | Vuelve la señal, todas a la vez | 9,1 s | 16 s | 9 | 0 | 372 MB |
| 200 | Hora pico | 107 ms | | 0 | | 453 MB |
| 200 | Vuelve la señal, repartida en 30 s | 1,2 s | 2,6 s | 0 | 0 | 461 MB |
| 200 | Vuelve la señal, todas a la vez | 9,9 s | 35 s | 164 | 0 | 463 MB |

En reposo usa 185 MB. En ninguna corrida se quedó sin memoria. Comparado con la
[etapa 1](resultados-etapa-1.md#servidor-con-1-gb-de-ram), que no tenía login, la hora pico sigue igual; cuando 200 mesas
vuelven en el mismo instante tarda más: 35 s contra 21 s. Es el peor caso posible, porque los teléfonos reales reparten su
espera al azar.

**Límites de esta medición:** corrió en una computadora de escritorio limitada a esa CPU, sin la latencia de una red real.
Hay que repetirla en un servidor gratuito de verdad antes de publicar una cifra de capacidad.

## Decisiones que salieron de estas pruebas

- **La foto del acta se guarda en el teléfono como bytes,** no como `Blob`: WebKit no deja guardar un `Blob` en la base del
  navegador.
- **El servidor recuerda las sesiones y el estado de la elección.** Sin eso, con login y 200 mesas en hora pico, el p95
  pasaba de 85 ms a 2,2 s; con eso, queda en 107 ms.
- **Una mesa callada se avisa solo mientras se vota y si no cerró su día.** Si no, de noche todas las mesas parecerían sin
  datos.
- **El ejecutable único se arma con el binario oficial de Node, en GitHub Actions.** Con el Node que empaquetan algunas
  distribuciones de Linux da fallo de segmento.
