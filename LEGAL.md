# Información legal

[English](LEGAL.en.md) · [Volver al README](README.md)

> **Borrador.** Un abogado todavía tiene que revisarlo antes de que la app se use en una elección. No es asesoramiento legal. Si vas a
> usar Urna Abierta, consultá con un profesional sobre tu caso.

## Licencia

Urna Abierta se publica bajo la [GNU AGPL-3.0-or-later](LICENSE), cuyo texto oficial está en inglés y es el que vale. Este documento es
un aviso en castellano para ayudar a entenderla, y no la reemplaza.

**Sin garantía y sin responsabilidad.** La licencia establece que el programa se entrega «tal como está», sin garantías de ningún tipo,
y que sus autores no responden por los daños que resulten de usarlo, en la medida en que la ley aplicable lo permita. Las secciones 15 y
16 de la licencia tienen el detalle.

**Si la modificás.** Si ofrecés una versión modificada por red, tenés que ofrecerles su código a quienes la usen, incluidos tus fiscales.

## El proyecto no toca tus datos

Urna Abierta es un programa que cada partido instala en su propio servidor. El proyecto y su autor:

- no alojan datos de ningún partido;
- no tienen servidor central ni telemetría, y la app no les envía nada;
- no tienen acceso a tu servidor ni a tus padrones;
- no controlan qué carga cada partido.

Quien usa las pantallas de ejemplo de este repo ve personas inventadas. Ningún padrón real forma parte del proyecto.

## Quién es responsable

**El partido o la agrupación que instala la app es el responsable de su base de datos y de cumplir la ley.** Al instalarla, su
administrador lo acepta. Eso incluye decidir qué se carga, quién lo ve, dónde está el servidor y cuándo se borra.

## Datos personales en Argentina

Un padrón trae nombres y documentos. El semáforo, además, puede registrar a quién vota una persona. Estos puntos no son exhaustivos,
pero conviene conocerlos:

- La [Ley 25.326](https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790) trata las opiniones políticas como dato sensible
  (art. 2) y prohíbe formar archivos que las revelen (art. 7), salvo el registro de los propios miembros de una organización política.
- La guía de la AAIP para fines electorales (Resolución 86/2019) admite tratarlas con el consentimiento de su titular. Que los datos sean
  privados no cambia nada de esto.
- Las personas tienen derecho a acceder, corregir y borrar sus datos (arts. 14 a 16).
- La transferencia internacional de datos está limitada (art. 12). **Los servidores gratuitos suelen estar fuera de Argentina**, y
  Estados Unidos, Brasil y Chile no figuran en la lista de países adecuados de la Disposición 60-E/2016.
- La base de datos puede tener que inscribirse en el registro de la AAIP.

Cómo inscribirla, cómo atender cada pedido y qué guardan las copias de seguridad está en la
[guía de datos personales](docs/es/datos-personales.md).

## Herramientas para cumplir

La app trae herramientas opcionales. Usarlas es decisión de cada partido, y tenerlas no garantiza cumplir la ley:

- registrar el consentimiento de cada persona, con fecha y medio;
- marcar categorías del semáforo como sensibles, con un permiso aparte;
- buscar, exportar, corregir y borrar todo lo de una persona;
- borrar o anonimizar el padrón después de la elección;
- un registro de quién vio y cambió qué.

El semáforo arranca vacío: cada partido define sus categorías.

## Inteligencia artificial externa

El escáner de padrones lee por defecto en tu computadora, y por ahora es la única opción. Si más adelante elegís usar una IA
externa, los datos del padrón pasan por esa empresa, con tu cuenta y bajo sus términos, y algunos planes gratuitos entrenan
con lo que reciben. Ningún padrón pasa por una cuenta o un servidor del proyecto.

## Terceros

Los nombres de proveedores de nube se mencionan solo para orientar: el proyecto no tiene relación con ellos. Sus condiciones las aceptás
vos, con tu cuenta. Las fuentes tipográficas tienen licencia SIL OFL, incluida junto a cada una en
`apps/web/src/lib/fuentes/` y `landing/fuentes/`.
