# Resultados de la etapa 1

[English](../en/stage-1-results.md)

## Sincronización y app

- Sobre las reglas de tachado: 500 historias al azar, con operaciones desordenadas y repetidas, dan siempre el mismo
  resultado.
- Contra Postgres: con 12 teléfonos escribiendo a la vez, un lector no se saltea ninguna operación.
- En navegador, con Chromium y WebKit en perfil móvil, contra los contenedores reales y con la red cortada: abre sin señal,
  conserva lo marcado al recargar, sincroniza al volver, respeta la marca de otro fiscal y ofrece el plan B del aviso
  urgente.
- La app pesa 72 KB comprimida.

WebKit en Linux no es Safari en un iPhone. Lo que un teléfono real hace con la app se prueba con
[esta guía](pruebas-en-telefonos.md).

## Servidor con 1 GB de RAM

Medido en un pod limitado con cgroups, con Postgres, servidor y Caddy adentro, y TLS real con una conexión por teléfono. En
reposo usa unos 130 MB. La columna de sincronización es lo que tarda el 95 % de las mesas en ponerse al día.

| CPU | Mesas | Situación | Respuesta (p95) | Mesa al día (p95) | Reintentos | Perdidas o duplicadas | Memoria máxima |
|---|---|---|---|---|---|---|---|
| 0,25 | 10 | Hora pico | 26 ms | | 0 | | 138 MB |
| 0,25 | 50 | Hora pico | 28 ms | | 0 | | 160 MB |
| 0,25 | 200 | Hora pico | 85 ms | | 0 | | 216 MB |
| 0,25 | 200 | Vuelve la señal, repartida en 30 s | 776 ms | 2,2 s | 0 | 0 | 228 MB |
| 0,25 | 200 | Vuelve la señal, todas a la vez | 9,4 s | 21 s | 29 | 0 | 329 MB |
| 1 | 500 | Hora pico | 22 ms | | 0 | | 278 MB |
| 1 | 500 | Vuelve la señal, repartida en 30 s | 68 ms | 0,15 s | 0 | 0 | 302 MB |
| 1 | 500 | Vuelve la señal, todas a la vez | 6,4 s | 11 s | 0 | 0 | 507 MB |

Hora pico son 120 votos por hora en cada mesa, más un jefe mirando cada 10 mesas. Cuando vuelve la señal, cada mesa manda
100 operaciones pendientes. La comprobación de pérdidas se hace sobre una muestra de 25 mesas por corrida, reenviando además
un lote para confirmar que no se duplica.

**Límites de esta medición:** corrió en una computadora de escritorio limitada a esa CPU, sin la latencia de una red real.
Hay que repetirla en un servidor gratuito de verdad antes de publicar una cifra de capacidad.

## Reconocimiento de texto

Probé sobre dos padrones reales escaneados, de 89 y 56 páginas, que comparten gente. Como son escaneos independientes, sus
errores también lo son: cruzarlos mide la calidad con solo contar, sin que nadie lea los datos. Todo corrió en un espacio sin
acceso a la red.

| Motor | Documentos que coinciden | Nombres casi iguales (≥90 %) | Legajos que coinciden |
|---|---|---|---|
| Tesseract por columnas | 90,5 % | 88 % | 84 % |
| RapidOCR en español, recortando cada celda a su tinta | **98,4 %** | **97,6 %** | **96,7 %** |

Quedó RapidOCR, con licencia Apache-2.0 y sin dependencias de sistema. Los documentos que no coinciden (1,6 %) incluyen a
quienes de verdad están en un solo padrón, así que es un techo de error para los dos archivos juntos.

- **Completitud:** se leyeron las 145 páginas. Comparando con la numeración del propio padrón no falta nadie en uno y falta
  1 persona en el otro.
- **A revisar:** el escáner marca entre 13 % y 14 % de las filas, sobre todo por legajos dudosos.
- **Lo que falta mejorar:** los nombres coinciden exactos en 88,6 %. La mayoría de las diferencias es una sola letra, entre
  letras finas como `i`, `l` y `t`.
- **Primer uso:** el modelo baja de `modelscope.cn` y pesa 47 MB. La descarga no envía datos, pero conviene distribuirlo
  junto con el escáner para que nada dependa de ese sitio.

Falta una verificación manual: esta comparación no ve un error que se repita igual en los dos escaneos.
