# Simulacro

[English](../en/drill.md) · [Volver al README](../../README.md)

Antes de usar Urna Abierta en una elección, hacé un simulacro con personas de verdad y datos inventados. Cada uno de estos puntos es algo
que una prueba automática no puede contestar.

Hace falta: un servidor instalado, un padrón inventado, y al menos seis personas con sus propios teléfonos, entre ellas dos que no hayan
visto nunca la app. Reservá dos horas.

## Preparar

- [ ] Instalá en un servidor nuevo, con el instalador. Anotá cuánto tardó.
- [ ] Armá el padrón inventado: `node deploy/padron-inventado.mjs 350 > padron.csv`. No uses `deploy/serve.sh`, que es una base de prueba.
- [ ] Creá la elección completa desde la app: partido, equipo, días, listas, padrón, mesas.
- [ ] Mandá las invitaciones por el medio que uses de verdad.

## Primer uso

- [ ] Dos personas que nunca la vieron abren su link **sin que nadie les explique**. ¿Llegan solas al padrón? Anotá dónde dudan.
- [ ] Prueben en sus teléfonos, y que entre ellos haya al menos un iPhone y un Android viejo.
- [ ] En iPhone: agregar a inicio, y entrar con el número.
- [ ] Prueben cambiar el tema y el idioma.

## Votación

- [ ] Todos preparan la mesa con señal, y después activan el modo avión.
- [ ] Tachen 30 personas seguidas, buscando por apellido y por número. Una persona dicta rápido, como en una fila real.
- [ ] Una persona tacha a alguien por error y lo deshace.
- [ ] Dos fiscales de la misma mesa tachan a la misma persona, sin señal. Después vuelve la señal: tiene que seguir tachada una sola vez.
- [ ] Reinicien un teléfono sin señal: tiene que seguir todo.
- [ ] Alguien manda un aviso sin señal: ¿entiende qué hacer? ¿Llama?
- [ ] Vuelve la señal. El jefe de distrito ve el aviso, y lo resuelve.
- [ ] Una mesa queda sin señal media hora: el jefe tiene que verla como «sin datos».
- [ ] Apagá el servidor 10 minutos en medio de la votación, y volvelo a prender. Nadie tendría que notarlo, salvo por lo que falta enviar.

## Cierre

- [ ] Cada fiscal cuenta los sobres. Una mesa carga un número que no coincide: ¿lo nota el fiscal? ¿Lo ve el jefe?
- [ ] Cargan el escrutinio de a una lista y sacan la foto del acta, con buena y con mala luz.
- [ ] Dos fiscales cargan números distintos en la misma mesa: el jefe tiene que elegir cuál vale.

## Recuperarse de un desastre

Lo más importante de todo el simulacro.

- [ ] Bajá una copia de seguridad desde la app.
- [ ] Borrá el servidor, de verdad.
- [ ] Instalá uno nuevo y restaurá la copia con la llave de recuperación.
- [ ] Comprobá que estén la elección, los tachados, las fotos y los permisos. Medí cuánto tardó todo: ese es tu tiempo real de
      recuperación.
- [ ] Si la dirección cambió, cada fiscal tiene que volver a preparar la mesa. Medí cuánto tarda eso con todo el equipo.

## Ley y seguridad

Cómo se usa cada herramienta está en la guía de [datos personales](datos-personales.md).

- [ ] Una persona pide sus datos. En **Pedidos de personas**, buscala, tocá «Bajar todo lo que tenemos», corregí su documento, anotá un
      consentimiento y borrá sus datos. Medí cuánto tardó cada cosa: los plazos de la ley son de 10 días corridos y 5 hábiles. ¿Lo que se
      bajó se entiende sin explicación?
- [ ] En **Registro** aparecen la búsqueda, la descarga, la corrección, el consentimiento y el borrado, con quién lo hizo.
- [ ] Creá una categoría del semáforo marcada como sensible y anotá a alguien con ella. Alguien con «Anotar quién nos vota» no la tiene
      que ver: si le pone una categoría común o se la saca, la sensible sigue ahí, sin que nada le avise que estaba. Alguien con «Ver
      las categorías sensibles» la ve, y el registro dice «Miró categorías sensibles».
- [ ] Bajá el padrón de una mesa preparándola desde un teléfono, y una copia de seguridad desde la app: el registro tiene que decir quién
      lo hizo.
- [ ] Pasá la seguridad a «Municipal o provincial». Todos menos los fiscales tienen que confirmar con un código, y el fiscal tiene que ver
      solo los últimos 3 números de cada documento. Después volvé a la de antes.
- [ ] Sacá a una persona del equipo: la próxima vez que su teléfono se conecte, tiene que decir «Este teléfono ya no tiene acceso».
- [ ] Después de cerrar la elección, un fiscal intenta tachar y volver a preparar la mesa. Anotá qué pasa: nada de lo que mande tiene que
      contar.

## Terminar

- [ ] Cerrá la elección y purgala. Comprobá que no quede ningún nombre: buscá uno en **Pedidos de personas**.
- [ ] Comprobá que no quede ningún documento en la base. Los del padrón inventado empiezan con 9900, así que esto tiene que contestar `0`:

      ```sh
      sudo runuser -u urna -- env XDG_RUNTIME_DIR=/run/user/$(id -u urna) HOME=/opt/urna-abierta \
        podman exec urna-db pg_dump -U urna urna | grep -cw '9900[0-9]\{4\}'
      ```

      Si da más, es un error de la app: anotalo y avisá como dice la [política de seguridad](../../SECURITY.md).

- [ ] Borrá las copias de seguridad anteriores a la purga, en el servidor y en tu computadora, como dice
      [Las copias de seguridad](datos-personales.md#las-copias-de-seguridad).
- [ ] Borrá el servidor. Revisá en la consola de la nube que no quede nada cobrando.

## Lo que hay que anotar

Dónde dudó cada persona, cuánto tardó cada cosa y qué se rompió. Si una persona nueva se trabó, el problema es de la app.
