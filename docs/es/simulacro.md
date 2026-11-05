# Simulacro

[English](../en/drill.md) · [Volver al README](../../README.md)

Antes de usar Urna Abierta en una elección, hacé un simulacro con personas de verdad y datos inventados. Cada uno de estos puntos es algo
que una prueba automática no puede contestar.

Hace falta: un servidor instalado, un padrón inventado, y al menos seis personas con sus propios teléfonos, entre ellas dos que no hayan
visto nunca la app. Reservá dos horas.

## Preparar

- [ ] Instalá en un servidor nuevo, con el instalador. Anotá cuánto tardó.
- [ ] Armá el padrón inventado: `deploy/serve.sh` no sirve para esto, porque usa una base de prueba. Generá un CSV con nombres inventados
      y documentos que empiecen con 99.
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

## Terminar

- [ ] Cerrá la elección y purgala. Comprobá que no quede ningún nombre: buscá uno en **Pedidos de personas**.
- [ ] Borrá el servidor. Revisá en la consola de la nube que no quede nada cobrando.

## Lo que hay que anotar

Dónde dudó cada persona, cuánto tardó cada cosa y qué se rompió. Si una persona nueva se trabó, el problema es de la app.
