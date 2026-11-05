const es = {
  'test.banner': 'Versión de prueba, con personas inventadas',
  'nav.table': 'Mesa',
  'nav.urgent': 'Aviso urgente',
  'nav.check': 'Estado',
  'language': 'Idioma',
  'sync.done': 'Todo enviado',
  'sync.pending': '{count} sin enviar',
  'sync.later': 'Se envía cuando haya señal',
  'sync.sending': 'Enviando…',
  'prepare.title': 'Preparar la mesa',
  'prepare.text': 'Hacelo con señal. Después la app funciona sin internet.',
  'prepare.size': 'Cantidad de personas de la prueba',
  'prepare.button': 'Preparar mesa',
  'prepare.working': 'Preparando…',
  'prepare.failed': 'No se pudo preparar la mesa. Probá de nuevo.',
  'prepare.done': 'Listo para usar sin señal',
  'table.remaining': 'Faltan {remaining} de {total}',
  'table.search': 'Buscar por apellido o número',
  'table.showVoted': 'Ver quiénes ya votaron',
  'table.showPending': 'Ver quiénes faltan',
  'table.empty': 'No hay nadie con esa búsqueda',
  'table.marked': 'Tachaste a {name}',
  'table.undo': 'Deshacer',
  'table.reset': 'Empezar de nuevo',
  'table.resetConfirm': '¿Borrar esta mesa de prueba y todo lo marcado?',
  'urgent.title': 'Aviso urgente',
  'urgent.text': 'Avisale a tu jefe de distrito si pasa algo grave en la mesa.',
  'urgent.button': 'Avisar irregularidad',
  'urgent.sent': 'Aviso enviado',
  'urgent.notSent': 'Todavía no salió. Se enviará solo cuando haya señal. Mientras tanto, avisá por acá:',
  'urgent.call': 'Llamar',
  'urgent.whatsapp': 'Mandar WhatsApp',
  'urgent.sms': 'Mandar SMS',
  'urgent.contact': 'Teléfono del jefe de distrito (para la prueba)',
  'urgent.message': 'Irregularidad en la mesa {table}. Necesito ayuda.',
  'check.title': 'Estado de la prueba',
  'check.installed': 'Instalada en la pantalla de inicio',
  'check.persisted': 'Almacenamiento protegido',
  'check.intact': 'Datos intactos',
  'check.people': 'Personas guardadas',
  'check.first': 'Primera vez que se abrió',
  'check.previous': 'Vez anterior',
  'check.opens': 'Veces que se abrió',
  'check.gap': 'Mayor tiempo sin abrirla',
  'check.days': '{days} días',
  'check.tap': 'Respuesta al tachar (mediana / peor)',
  'check.write': 'Guardado en el teléfono (mediana / peor)',
  'check.offline': 'Conexión ahora',
  'check.online': 'con señal',
  'check.noSignal': 'sin señal',
  'check.yes': 'sí',
  'check.no': 'no',
  'check.unknown': 'sin datos',
  'check.copy': 'Copiar informe',
  'check.copied': 'Informe copiado',
  'check.note': 'El informe no sale del teléfono salvo que lo copies y lo mandes vos. No incluye datos de ninguna persona.',
  'check.install': 'Instalar la app',
  'check.installIos': 'En iPhone: tocá Compartir y después «Agregar a inicio».',
  'update.available': 'Hay una versión nueva.',
  'update.apply': 'Actualizar',
  'update.waiting': 'Hay envíos pendientes: se actualiza cuando salgan.',
} as const;

export type MessageKey = keyof typeof es;

const en: Record<MessageKey, string> = {
  'test.banner': 'Test version, with invented people',
  'nav.table': 'Table',
  'nav.urgent': 'Urgent alert',
  'nav.check': 'Status',
  'language': 'Language',
  'sync.done': 'Everything sent',
  'sync.pending': '{count} not sent',
  'sync.later': 'Will be sent when there is signal',
  'sync.sending': 'Sending…',
  'prepare.title': 'Prepare the table',
  'prepare.text': 'Do this while you have signal. After that the app works without internet.',
  'prepare.size': 'Number of people in the test',
  'prepare.button': 'Prepare table',
  'prepare.working': 'Preparing…',
  'prepare.failed': 'The table could not be prepared. Please try again.',
  'prepare.done': 'Ready to use without signal',
  'table.remaining': '{remaining} of {total} left',
  'table.search': 'Search by surname or number',
  'table.showVoted': 'See who already voted',
  'table.showPending': 'See who is left',
  'table.empty': 'Nobody matches that search',
  'table.marked': 'You crossed out {name}',
  'table.undo': 'Undo',
  'table.reset': 'Start over',
  'table.resetConfirm': 'Delete this test table and everything marked?',
  'urgent.title': 'Urgent alert',
  'urgent.text': 'Tell your district chief if something serious happens at the table.',
  'urgent.button': 'Report irregularity',
  'urgent.sent': 'Alert sent',
  'urgent.notSent': 'It has not gone out yet. It will be sent when there is signal. Meanwhile, use one of these:',
  'urgent.call': 'Call',
  'urgent.whatsapp': 'Send WhatsApp',
  'urgent.sms': 'Send SMS',
  'urgent.contact': 'District chief phone number (for the test)',
  'urgent.message': 'Irregularity at table {table}. I need help.',
  'check.title': 'Test status',
  'check.installed': 'Installed on the home screen',
  'check.persisted': 'Protected storage',
  'check.intact': 'Data intact',
  'check.people': 'People stored',
  'check.first': 'First opened',
  'check.previous': 'Previous time',
  'check.opens': 'Times opened',
  'check.gap': 'Longest time without opening it',
  'check.days': '{days} days',
  'check.tap': 'Response when crossing out (median / worst)',
  'check.write': 'Saved on the phone (median / worst)',
  'check.offline': 'Connection now',
  'check.online': 'online',
  'check.noSignal': 'no signal',
  'check.yes': 'yes',
  'check.no': 'no',
  'check.unknown': 'no data',
  'check.copy': 'Copy report',
  'check.copied': 'Report copied',
  'check.note': 'The report only leaves the phone if you copy and send it yourself. It has no data about any person.',
  'check.install': 'Install the app',
  'check.installIos': 'On iPhone: tap Share, then “Add to Home Screen”.',
  'update.available': 'A new version is available.',
  'update.apply': 'Update',
  'update.waiting': 'There are pending items: it will update once they are sent.',
};

export const LANGUAGES = { es: 'Español', en: 'English' } as const;
export type Language = keyof typeof LANGUAGES;

const STORAGE_KEY = 'urna-abierta-language';
const dictionaries: Record<Language, Record<MessageKey, string>> = { es, en };

function initial(): Language {
  const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
  // Spanish is the main language: English is chosen, never guessed.
  return saved === 'en' ? 'en' : 'es';
}

let current = $state<Language>(initial());

export const i18n = {
  get language(): Language {
    return current;
  },
  set language(value: Language) {
    current = value;
    localStorage.setItem(STORAGE_KEY, value);
    document.documentElement.lang = value;
  },
};

export function t(key: MessageKey, values: Record<string, string | number> = {}): string {
  return dictionaries[current][key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}
