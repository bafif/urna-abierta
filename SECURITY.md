# Seguridad

[English](SECURITY.en.md) · [Volver al README](README.md)

## Cómo avisar de una falla

En privado, nunca en un issue público: una falla publicada antes de que esté corregida pone en riesgo los datos de los partidos que ya
usan la app.

Usá el reporte privado de GitHub: en la pestaña **Security** del repo, **Report a vulnerability**, o directo en
[github.com/bafif/urna-abierta/security/advisories/new](https://github.com/bafif/urna-abierta/security/advisories/new). Lo que escribas
ahí lo vemos solo vos y yo.

Contá qué parte es, en qué versión o commit, cómo se reproduce y qué consigue quien la aprovecha. Usá personas inventadas: nunca mandes un
padrón real, ni partes de uno.

Si esa opción no aparece, abrí un issue que diga solo que querés avisar de una falla de seguridad, sin ningún detalle, y te contesto para
seguir en privado.

## Qué pasa después

Lo hago solo, así que no hay plazos garantizados. Te confirmo que lo recibí, lo corrijo en privado y publico el aviso junto con la versión
que lo corrige, con tu nombre si querés. Te pido que no lo cuentes hasta entonces.

## Qué entra

- El servidor y la app: `apps/server`, `apps/web` y `packages/domain`.
- El instalador, `apps/installer`, y lo que deja en el servidor: `deploy/server/instalar.sh`, `deploy/server/urna`, Caddy y los
  contenedores.
- El proceso de publicación: cualquier forma de que alguien reciba un instalador o una imagen que no salió de este repo.
- Que alguien vea o cambie algo que su tarea no le permite: un fiscal que ve otra mesa, alguien que lee una categoría sensible sin el
  permiso, un registro que se puede borrar.
- Lo que queda guardado en el teléfono de un fiscal, por ejemplo si lo pierde o se lo roban.
- La landing, `landing/`.

El lector de padrones tiene su propio repo, [urna-abierta-padrones](https://github.com/bafif/urna-abierta-padrones): avisá ahí, de la
misma forma.

## Qué no entra

- **El proyecto no tiene servidores ni datos propios.** No hay servidor central, ni telemetría, ni cuentas del proyecto: no hay nada del
  proyecto para atacar. Cada servidor es de un partido, así que no pruebes contra uno que no sea tuyo. Para probar está `deploy/serve.sh`,
  con personas inventadas, o la opción «Probar en esta computadora» del instalador.
- La configuración de cada partido: su cuenta en la nube, sus claves, un `.env` cambiado a mano o una llave de recuperación que se
  filtró.
- Fallas de los proveedores de nube, de GitHub o de una dependencia que ya son públicas: avisales a ellos. Si afectan a Urna Abierta de una
  forma propia, sí avisá acá.
- Lo que ve quien tiene en la mano un teléfono desbloqueado con la app abierta: es lo mismo que ve su fiscal.
- Saturar un servidor con tráfico.
- Informes de herramientas automáticas sin un caso concreto.

## Versiones

Todavía no hay una versión publicada. Las correcciones van siempre sobre la rama `main` y sobre la última versión publicada.
