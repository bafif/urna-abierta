<p align="center">
  <img src="docs/assets/portada.png" alt="Urna Abierta: tres pantallas de la app de fiscales, en tres temas distintos" width="100%">
</p>

<p align="center">
  <strong>La app libre para organizar a los fiscales de tu partido, en cualquier elección.</strong><br>
  Tus datos en tu servidor. Funciona sin señal. La puede usar cualquiera, desde la primera vez.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licencia-AGPL--3.0-1E5A44" alt="Licencia AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/estado-en%20desarrollo-D42F06" alt="Estado: en desarrollo">
  <img src="https://img.shields.io/badge/telemetr%C3%ADa-ninguna-14233A" alt="Sin telemetría">
  <a href="README.en.md"><img src="https://img.shields.io/badge/read%20in-English-555" alt="Read in English"></a>
</p>

---

## Por qué existe

Una elección se gana también en las mesas: alguien tiene que estar ahí, saber quién votó, avisar si algo anda mal y cuidar el
escrutinio hasta el final. Hoy, hacer eso bien exige una estructura que solo tienen los partidos grandes, y eso es una ventaja
que no debería existir.

Hago Urna Abierta para sacarles a los aparatos viejos el monopolio de la fiscalización: que a una agrupación estudiantil o a un
partido chico le alcance con una app gratuita, un servidor propio y un rato de configuración. Es un proyecto personal mío, y no
pertenece a ningún partido ni agrupación.

## Pensada para quien nunca la abrió

Sin menús: una pregunta por pantalla, un botón principal y un plan que te dice qué sigue. Cada persona ve solo
su trabajo.

| Quién | Qué hace |
|---|---|
| **Fiscal** | Entra con un link, tacha a quienes votan aunque no haya señal, cuenta los sobres cada noche y carga el escrutinio |
| **Jefe de distrito** | Ve primero las mesas que lo necesitan, y las llama con un toque |
| **Administración** | Arma una vez el partido y el equipo, y crea una elección cada vez que hace falta |
| **Semáforo y estadísticas** | Con permisos aparte: uno anota de a una persona, y el otro solo ve números, nunca nombres |

<p align="center">
  <img src="docs/assets/temas.png" alt="La misma pantalla en cinco temas: Aula, Vidrio, Feria, Tablero y Mate" width="100%">
</p>

Con temas para todos los gustos, en modo claro y oscuro: se eligen con vista previa al instalarla, y cada persona lo puede cambiar la
primera vez que la abre. También podés agregar el tuyo, con los colores de tu partido. Podés recorrer [la propuesta de diseño](design/index.html) abriéndola en tu navegador.

## Lo que la hace distinta

- **Tus datos son tuyos.** Cada partido usa su propio servidor. El proyecto no aloja nada ni recibe nada: no hay servidor central
  ni telemetría.
- **Anda sin señal.** Muchas aulas no tienen conexión. Todo se guarda primero en el teléfono y se manda solo cuando vuelve.
- **Pensada para no pagar servidor.** Apunta a los planes gratuitos: la medí con los límites de esas máquinas, 1 GB de memoria y un
  cuarto de procesador, y anduvo con 200 mesas, en una [prueba de laboratorio](docs/es/resultados-etapa-4.md).
- **Lee tus padrones.** Lee un PDF escaneado con un modelo que corre en tu computadora, sin mandarle el padrón a nadie.
- **Con la ley argentina en mente.** Trae permisos, un registro que nadie puede cambiar y herramientas para atender pedidos de personas y borrar los datos al terminar.

## Instalación

Bajás un instalador para Windows, macOS o Linux que te hace tres preguntas, crea tu servidor y deja todo configurado.

**Todavía no hay una versión publicada.** Mientras tanto se puede correr desde el código, con personas inventadas o con el instalador
mismo: **[cómo instalarla](docs/es/instalacion.md)**. Antes de usarla en una elección, hacé un [simulacro](docs/es/simulacro.md).

## Estado

La primera prueba real es una elección universitaria, en abril de 2027.

- [x] Vista del fiscal sin señal, y sincronización sin pérdidas
- [x] Lectura local de padrones escaneados
- [x] Servidor medido en una máquina chica
- [x] Propuesta de diseño y sistema de temas
- [x] Login, padrón real, mesas y permisos
- [x] Irregularidades, conteo de sobres, escrutinio y panel del jefe
- [x] Semáforo, auditoría, datos personales y copias de seguridad
- [x] Instalador, probado por SSH en Ubuntu y restaurando una copia en otro servidor
- [ ] Crear servidores en las nubes reales: se probó contra simulaciones de sus API
- [ ] Prueba en un iPhone de verdad
- [ ] Simulacro con personas reales

## Documentación

| | |
|---|---|
| [Instalación](docs/es/instalacion.md) | El instalador, y cómo probarla |
| [Crear un servidor](docs/es/servidores.md) | Oracle, AWS y Google, paso a paso, y cómo mantenerlo |
| [Simulacro](docs/es/simulacro.md) | Qué probar con personas de verdad antes de una elección |
| [Tu propio tema](docs/es/temas.md) | Los colores de tu partido, siempre que se puedan leer |
| [Plan técnico](docs/es/plan-tecnico.md) | Arquitectura, sincronización, permisos y formato de padrón |
| [Mediciones](docs/es/resultados-etapa-4.md) | Qué se probó y qué dio, con los [riesgos iniciales](docs/es/resultados-etapa-1.md) |
| [Legal](LEGAL.md) | Licencia, responsabilidades y datos personales |
| [Datos personales](docs/es/datos-personales.md) | Qué pide la ley, cómo inscribir la base y cómo atender cada pedido con la app |
| [Escáner de padrones](https://github.com/bafif/urna-abierta-padrones) | El repo que convierte padrones al formato abierto |

## Autor

Lo hago yo, **Bautista D. Fiori**. Si querés usarla en tu elección o sumarte, escribime.

[LinkedIn](https://www.linkedin.com/in/b-d-fiori/) · [GitHub](https://github.com/bafif)

## Licencia

[AGPL-3.0-or-later](LICENSE). Podés usarla, modificarla y compartirla; si ofrecés una versión modificada por red, tenés que
ofrecer también su código.
