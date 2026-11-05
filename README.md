# Urna Abierta

[English](README.en.md)

Una app de código abierto para organizar fiscales de cualquier partido, en cualquier tipo de elección. La idea es que a
una agrupación estudiantil o a un partido chico le resulte fácil fiscalizar, sin depender de una estructura enorme.

Cada partido la instala en su propio servidor. El proyecto nunca toca datos: no hay servidor central, hosting ni
telemetría.

## Estado

Está en su primera etapa, en la que pruebo lo más riesgoso antes de construir el resto. Lo que hay hoy es una versión de
prueba **sin login y con personas inventadas**. Todavía no sirve para una elección real, ni debe usarse con datos reales.

- Vista del fiscal sin señal: tachar a quien votó, deshacer y buscar sin acentos.
- Sincronización que no pierde ni duplica nada, sin depender del reloj de los teléfonos.
- Aviso urgente con plan B: llamada, WhatsApp o SMS.
- Interfaz en español e inglés.

Cómo probarla en un teléfono: [docs/es/pruebas-en-telefonos.md](docs/es/pruebas-en-telefonos.md). El plan está en
[docs/es/plan-tecnico.md](docs/es/plan-tecnico.md) y lo medido hasta ahora en
[docs/es/resultados-etapa-1.md](docs/es/resultados-etapa-1.md).

## Para desarrollar

Hace falta Node 24 y Podman.

```sh
corepack pnpm install
corepack pnpm test           # sin base de datos, las pruebas del servidor se saltean
deploy/e2e.sh                # pruebas de navegador contra los contenedores reales
```

Para correr también las pruebas del servidor, definí `TEST_DATABASE_URL` con un Postgres de prueba.

`deploy/measure.sh` mide cuánto aguanta el servidor con los límites de una máquina chica.

## El escáner de padrones

Convertir padrones en PDF escaneados al formato abierto que lee esta app es trabajo de
el repo `urna-abierta-padrones`. Cada uno se puede usar por separado.

## Licencia

[AGPL-3.0-or-later](LICENSE). Si modificás la app y otras personas la usan por red, tenés que ofrecerles el código de tu
versión.
