# Making your own theme

[Español](../es/temas.md) · [Back to installation](installation.md)

A theme is data: colors for each mode, fonts, shapes and a few recipes. It has no code, and the app loads nothing from outside.

1. Copy one of the themes in [`apps/web/src/lib/temas.js`](../../apps/web/src/lib/temas.js) to a file of your own, and change its `id`,
   `nombre` and colors. Fonts have to be among those that come with the app.
2. If it has a logo, put the path to an SVG, PNG or WebP in `logo`.
3. Convert it, with the repository installed:

   ```sh
   node design/tema-a-archivo.mjs my-theme.js my-theme.json
   ```

4. In the app, go to **More**, **Settings**, **Add your own theme**, and choose that file.

From then on, anyone in your party can choose it. With the same `id`, it replaces the previous one.

## The recipes

| Recipe | Values | What it changes |
|---|---|---|
| `tachado` | `lapicera`, `barra`, `sello`, `linea`, `suave` | How a crossed-out name looks |
| `fondo` | `cuaderno`, `liso`, `aurora` | The background of the screen |
| `material` | `plano`, `vidrio`, `almohada`, `filete` | What the panels are made of |
| `cabecera` | `simple`, `banda` | Whether the title sits on a color band |

## It has to be readable

That is the only thing the app demands, because older people will use it, in the sun and in dark classrooms. It checks when converting, and
the server checks again when loading it:

| What | Minimum contrast |
|---|---|
| Text on the background and panels | 7:1 |
| Secondary text, and text on buttons | 4.5:1 |
| Buttons, accents and marks on the background | 3:1 |

If something falls short, it tells you which pair of colors. You can also check them all with `node design/verificar-contraste.mjs my-theme.js`,
and see them in `design/index.html`.
