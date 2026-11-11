# Hacer un tema propio

[English](../en/themes.md) · [Volver a la instalación](instalacion.md)

Un tema son datos: colores para cada modo, letras, formas y unas pocas recetas. No lleva código, y la app no carga nada de afuera. Se importa
**un solo archivo, con todo adentro:** colores, logo y letras.

1. Copiá uno de los temas de [`apps/web/src/lib/temas.js`](../../apps/web/src/lib/temas.js) a un archivo tuyo, y cambiale `id`, `nombre` y
   los colores.
2. Si tiene logo, poné en `logo` la ruta a un SVG, PNG o WebP. Para usar letras propias, declaralas (WOFF2, WOFF, TTF u OTF):

   ```js
   fuentes: { titulo: "'Mi Letra'", texto: "'Mi Letra'", boton: "'Mi Letra'", numero: "'Mi Letra'" },
   archivosFuentes: [{ familia: 'Mi Letra', peso: '400', archivo: 'mi-letra.woff2' }],
   ```

   Con letras de peso variable, poné el rango: `peso: '200 800'`. Las que el tema use de las que trae la app se incluyen solas.
3. Convertilo, con el repo instalado:

   ```sh
   node tools/tema-a-archivo.mjs mi-tema.js mi-tema.json
   ```

4. Cargalo:
   - **Al instalar:** en el paso de cómo se ve, arrastrá el archivo a la ventana o tocá **Usar un tema propio**. Lo ves en claro y en oscuro antes
     de seguir, y es el que va a ver todo tu partido al entrar.
   - **Con la app ya instalada:** entrá a **Más cosas**, **Ajustes**, **Agregar un tema propio**, y elegí ese archivo.

Los temas propios no vienen con la app ni con el instalador: viajan solo de tu computadora a tu servidor. A partir de ahí, cualquiera de tu partido lo puede elegir. Si usás el mismo `id`, reemplaza al anterior. Un partido puede tener hasta 12 temas
propios. Sin contar las letras, cada tema pesa como mucho 256 KB, logo incluido, porque va a cada teléfono cada vez que abre la app; la
`idea` es un texto de hasta 600 letras.

Cada teléfono baja las letras una vez y las guarda, así que el tema se ve igual sin señal. Si incluís letras, asegurate de que su licencia te
deje distribuirlas: van a ir a los teléfonos de tu equipo.

## Las recetas

| Receta | Valores | Qué cambia |
|---|---|---|
| `tachado` | `lapicera`, `barra`, `sello`, `linea`, `suave` | Cómo se ve un nombre tachado |
| `fondo` | `cuaderno`, `liso`, `aurora` | El fondo de la pantalla |
| `material` | `plano`, `vidrio`, `almohada`, `filete` | De qué están hechos los paneles |
| `cabecera` | `simple`, `banda` | Si el título va sobre una banda de color |

## Se tiene que poder leer

Es lo único que la app exige, porque la van a usar personas mayores, al sol y en un aula oscura. Lo comprueba al convertirlo, y otra vez el
servidor al cargarlo:

| Qué | Contraste mínimo |
|---|---|
| Texto sobre el fondo y los paneles | 7:1 |
| Texto secundario, y texto sobre los botones | 4,5:1 |
| Botones, acentos y marcas sobre el fondo | 3:1 |

Si algo no alcanza, te dice qué par de colores es. También podés revisar todos juntos con `node tools/verificar-contraste.mjs mi-tema.js`.
