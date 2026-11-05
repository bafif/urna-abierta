# Making your own theme

[Español](../es/temas.md) · [Back to installation](installation.md)

A theme is data: colors for each mode, fonts, shapes and a few recipes. It has no code, and the app loads nothing from outside. You import
**one single file, with everything inside:** colors, logo and fonts.

1. Copy one of the themes in [`apps/web/src/lib/temas.js`](../../apps/web/src/lib/temas.js) to a file of your own, and change its `id`,
   `nombre` and colors.
2. If it has a logo, put the path to an SVG, PNG or WebP in `logo`. To use your own fonts, declare them (WOFF2, WOFF, TTF or OTF):

   ```js
   fuentes: { titulo: "'My Font'", texto: "'My Font'", boton: "'My Font'", numero: "'My Font'" },
   archivosFuentes: [{ familia: 'My Font', peso: '400', archivo: 'my-font.woff2' }],
   ```

   For variable weight fonts, give the range: `peso: '200 800'`. Whichever of the app's fonts the theme uses go in by themselves.
3. Convert it, with the repository installed:

   ```sh
   node design/tema-a-archivo.mjs my-theme.js my-theme.json
   ```

4. Load it:
   - **When installing:** in the step about how it looks, drag the file onto the window or tap **Use your own theme**. You see it in light and dark
     before moving on, and it is what your whole party sees when they get in.
   - **With the app already installed:** go to **More**, **Settings**, **Add your own theme**, and choose that file.

Own themes do not come with the app or the installer: they only travel from your computer to your server. From then on, anyone in your party can choose it. With the same `id`, it replaces the previous one.

Each phone downloads the fonts once and keeps them, so the theme looks the same with no signal. If you include fonts, make sure their license lets
you distribute them: they will go to your team's phones.

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
