// The everyday instant commands in other languages ("pausa", "baisse le volume", "stell einen Timer auf 5 Minuten"), so they answer at once with no model, in the
// same language they were asked in. Each is turned into the English command the quick parser already understands. Anything not here still works: it goes to the
// model, which understands and answers in any language. Spanish, French, German, Italian and Portuguese. Pure.

const strip = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[.!?¡¿,]+/g, ' ').replace(/\s+/g, ' ').trim();

// Each rule: [pattern on the stripped text, the English command; $1, $2 are the captures].
const RULES = {
  es: [
    [/^(?:pausa|pausar|pon pausa|para|detener|deten|para la musica|deten la musica|pausa la musica|pausa la cancion)$/, 'pause'],
    [/^(?:reproduce|reproducir|continua|sigue|pon|pon musica|pon la musica|dale al play|play|reanuda|reanudar)$/, 'play'],
    [/^(?:siguiente|siguiente cancion|cancion siguiente|salta|salta la cancion|pasa|pasa la cancion|proxima cancion)$/, 'next song'],
    [/^(?:anterior|cancion anterior|la anterior|vuelve atras|vuelve)$/, 'previous song'],
    [/^(?:sube|subir|sube el volumen|subir volumen|mas volumen|aumenta el volumen)$/, 'volume up'],
    [/^(?:baja|bajar|baja el volumen|bajar volumen|menos volumen|reduce el volumen)$/, 'volume down'],
    [/^(?:silencia|silenciar|silencio|silencia el sonido|mute)$/, 'mute'],
    [/^(?:quita el silencio|activa el sonido|reactiva el sonido)$/, 'unmute'],
    [/^(?:bloquea|bloquear)(?: la pantalla| el mac| la computadora| el ordenador)?$/, 'lock'],
    [/^(?:que hora es|dime la hora|la hora)$/, 'what time is it'],
    [/^(?:que dia es hoy|que dia es|que fecha es hoy|que fecha es)$/, 'what is the date'],
    [/^(?:pon |ponme |crea )?(?:un |una )?(?:temporizador|cronometro|alarma) de (\d+) (\w+)$/, 'set a timer for $1 $2'],
    [/^(?:abre|abrir|abra)(?: la app| la aplicacion| el| la| los| las)?\s+(.+)$/, 'open $1']
  ],
  fr: [
    [/^(?:pause|mets en pause|mets pause|arrete|arrete la musique|mets la musique en pause|stop)$/, 'pause'],
    [/^(?:joue|lecture|reprends|reprendre|continue|mets la musique|mets de la musique|play|relance)$/, 'play'],
    [/^(?:suivant|chanson suivante|morceau suivant|passe|passe la chanson|prochaine chanson|piste suivante)$/, 'next song'],
    [/^(?:precedent|chanson precedente|morceau precedent|piste precedente|reviens|reviens en arriere)$/, 'previous song'],
    [/^(?:monte le volume|augmente le volume|plus fort|plus de volume|monte le son)$/, 'volume up'],
    [/^(?:baisse le volume|diminue le volume|moins fort|moins de volume|baisse le son)$/, 'volume down'],
    [/^(?:coupe le son|silence|muet|mets en sourdine|mute)$/, 'mute'],
    [/^(?:remets le son|reactive le son|retablis le son)$/, 'unmute'],
    [/^(?:verrouille|verrouiller)(?: l ecran| le mac| l ordinateur| mon mac)?$/, 'lock'],
    [/^(?:quelle heure est il|quelle heure est-il|dis moi l heure|l heure)$/, 'what time is it'],
    [/^(?:quel jour sommes nous|quel jour est on|quelle est la date|on est quel jour|quelle date sommes nous)$/, 'what is the date'],
    [/^(?:mets |lance |programme |cree )?(?:un |une )?(?:minuteur|chronometre|alarme|timer) de (\d+) (\w+)$/, 'set a timer for $1 $2'],
    [/^(?:ouvre|ouvrir)(?: l app| l application| le| la| l)?\s+(.+)$/, 'open $1']
  ],
  de: [
    [/^(?:pause|pausiere|pausiere die musik|musik pausieren|halt an|stopp|stopp die musik|halte die musik an)$/, 'pause'],
    [/^(?:spiel|spiele|abspielen|weiter|fortsetzen|play|musik an|spiel musik|spiele musik|musik abspielen)$/, 'play'],
    [/^(?:nachster|nachstes lied|nachster titel|nachster song|weiter zum nachsten|ubernachster|skip|ueberspringen|uberspringen)$/, 'next song'],
    [/^(?:vorheriger|vorheriges lied|vorheriger titel|vorheriger song|zuruck|ein lied zuruck)$/, 'previous song'],
    [/^(?:lauter|mach lauter|lautstarke erhohen|erhohe die lautstarke|mehr lautstarke)$/, 'volume up'],
    [/^(?:leiser|mach leiser|lautstarke verringern|verringere die lautstarke|weniger lautstarke)$/, 'volume down'],
    [/^(?:stumm|stummschalten|schalte stumm|ton aus|mute)$/, 'mute'],
    [/^(?:ton an|stummschaltung aufheben|schalte den ton ein)$/, 'unmute'],
    [/^(?:sperre|sperren|bildschirm sperren|sperre den bildschirm|sperre den mac|mac sperren)$/, 'lock'],
    [/^(?:wie spat ist es|wieviel uhr ist es|wie viel uhr ist es|sag mir die uhrzeit|uhrzeit)$/, 'what time is it'],
    [/^(?:welcher tag ist heute|welches datum haben wir|welches datum ist heute|den wievielten haben wir)$/, 'what is the date'],
    [/^(?:stell |stelle |starte |setze )?(?:einen |ein )?(?:timer|wecker|stoppuhr) (?:auf|fur) (\d+) (\w+)$/, 'set a timer for $1 $2'],
    [/^(?:offne|offnen|mach|starte)\s+(.+?)(?: auf| an)?$/, 'open $1']
  ],
  it: [
    [/^(?:pausa|metti in pausa|metti pausa|fermati|ferma la musica|ferma|metti la musica in pausa)$/, 'pause'],
    [/^(?:riproduci|riproduzione|continua|riprendi|metti la musica|metti musica|play|fai partire la musica)$/, 'play'],
    [/^(?:prossima|prossima canzone|canzone successiva|brano successivo|salta|salta la canzone|avanti)$/, 'next song'],
    [/^(?:precedente|canzone precedente|brano precedente|indietro|torna indietro)$/, 'previous song'],
    [/^(?:alza il volume|aumenta il volume|piu forte|piu volume|volume su)$/, 'volume up'],
    [/^(?:abbassa il volume|diminuisci il volume|piu piano|meno volume|volume giu)$/, 'volume down'],
    [/^(?:silenzia|muto|silenzio|togli l audio|mute)$/, 'mute'],
    [/^(?:riattiva l audio|rimetti l audio|togli il muto)$/, 'unmute'],
    [/^(?:blocca|bloccare)(?: lo schermo| il mac| il computer)?$/, 'lock'],
    [/^(?:che ore sono|che ora e|dimmi l ora|l ora)$/, 'what time is it'],
    [/^(?:che giorno e oggi|che giorno e|qual e la data|che data e oggi|che data e)$/, 'what is the date'],
    [/^(?:imposta |metti |avvia |crea )?(?:un |una )?(?:timer|sveglia|cronometro) (?:di|da) (\d+) (\w+)$/, 'set a timer for $1 $2'],
    [/^(?:apri|aprire)(?: l app| l applicazione| il| lo| la| l)?\s+(.+)$/, 'open $1']
  ],
  pt: [
    [/^(?:pausa|pausar|pare|para|pare a musica|pausa a musica|pausar a musica)$/, 'pause'],
    [/^(?:toca|tocar|reproduzir|continua|continue|retomar|retoma|coloca musica|toca musica|play|toca a musica)$/, 'play'],
    [/^(?:proxima|proxima musica|musica seguinte|seguinte|pula|pular|pula a musica|avancar)$/, 'next song'],
    [/^(?:anterior|musica anterior|volta|voltar|volta a musica)$/, 'previous song'],
    [/^(?:aumenta o volume|aumentar o volume|mais volume|sobe o volume|mais alto)$/, 'volume up'],
    [/^(?:diminui o volume|diminuir o volume|menos volume|abaixa o volume|mais baixo)$/, 'volume down'],
    [/^(?:silencia|silenciar|mudo|silencio|mute|tira o som)$/, 'mute'],
    [/^(?:ativa o som|ativar o som|volta o som|desativar mudo)$/, 'unmute'],
    [/^(?:bloqueia|bloquear)(?: a tela| o mac| o computador)?$/, 'lock'],
    [/^(?:que horas sao|que horas e|diga as horas|me diz as horas|as horas)$/, 'what time is it'],
    [/^(?:que dia e hoje|que dia e|qual e a data|que data e hoje|que data e)$/, 'what is the date'],
    [/^(?:coloca |programa |cria |bota )?(?:um |uma )?(?:temporizador|cronometro|alarme|timer) de (\d+) (\w+)$/, 'set a timer for $1 $2'],
    [/^(?:abre|abrir|abra)(?: o aplicativo| o app| o| a| os| as)?\s+(.+)$/, 'open $1']
  ]
};

const UNIT = (w) => (/^(?:sec|seg|sek)/.test(w) ? 'seconds' : /^(?:min)/.test(w) ? 'minutes' : /^(?:h|ora$|ore$|stund|uhr)/.test(w) ? 'hours' : null);

// Returns { lang, english } when this is one of the instant commands in that language, else null. lang: the language it was said in ('es', 'fr', …).
function translateCommand(text, lang) {
  const rules = RULES[lang];
  if (!rules) return null;
  const t = strip(text).replace(/^(?:por favor|s il te plait|s il vous plait|bitte|per favore|por favor) /, '').replace(/ (?:por favor|s il te plait|s il vous plait|bitte|per favore)$/, '');
  for (const [re, en] of rules) {
    const m = t.match(re);
    if (!m) continue;
    let out = en;
    if (/\$2/.test(en) && /^set a timer/.test(en)) { const u = UNIT(m[2]); if (!u) continue; out = `set a timer for ${m[1]} ${u}`; }
    else out = en.replace(/\$(\d)/g, (_, i) => m[+i] || '');
    return { lang, english: out };
  }
  return null;
}

// The reply in the language it was asked in, for the commands above. type/op come from the parsed English command; english is Relay's English reply (kept when
// there is nothing better, and for anything with a name in it).
const R = {
  es: { pause: 'Pausado.', play: 'Reproduciendo.', next: 'Siguiente canción.', previous: 'Canción anterior.', up: 'Volumen subido.', down: 'Volumen bajado.', mute: 'Silenciado.', unmute: 'Sonido activado.', lock: 'Bloqueado.', time: (t) => `Son las ${t}.`, date: (d) => `Hoy es ${d}.`, timer: (n, u) => `Temporizador de ${n} ${u}.`, none: 'No hay nada reproduciéndose.', open: (a) => `Abrí ${a}.`, units: { seconds: 'segundos', minutes: 'minutos', hours: 'horas' } },
  fr: { pause: 'En pause.', play: 'Lecture.', next: 'Morceau suivant.', previous: 'Morceau précédent.', up: 'Volume augmenté.', down: 'Volume baissé.', mute: 'Son coupé.', unmute: 'Son rétabli.', lock: 'Verrouillé.', time: (t) => `Il est ${t}.`, date: (d) => `Nous sommes le ${d}.`, timer: (n, u) => `Minuteur de ${n} ${u}.`, none: 'Rien n’est en cours de lecture.', open: (a) => `${a} ouvert.`, units: { seconds: 'secondes', minutes: 'minutes', hours: 'heures' } },
  de: { pause: 'Pausiert.', play: 'Wiedergabe.', next: 'Nächster Titel.', previous: 'Vorheriger Titel.', up: 'Lauter.', down: 'Leiser.', mute: 'Stummgeschaltet.', unmute: 'Ton ist wieder an.', lock: 'Gesperrt.', time: (t) => `Es ist ${t}.`, date: (d) => `Heute ist ${d}.`, timer: (n, u) => `Timer auf ${n} ${u} gestellt.`, none: 'Es läuft gerade nichts.', open: (a) => `${a} geöffnet.`, units: { seconds: 'Sekunden', minutes: 'Minuten', hours: 'Stunden' } },
  it: { pause: 'In pausa.', play: 'Riproduzione.', next: 'Brano successivo.', previous: 'Brano precedente.', up: 'Volume alzato.', down: 'Volume abbassato.', mute: 'Audio disattivato.', unmute: 'Audio riattivato.', lock: 'Bloccato.', time: (t) => `Sono le ${t}.`, date: (d) => `Oggi è ${d}.`, timer: (n, u) => `Timer di ${n} ${u}.`, none: 'Non sta suonando niente.', open: (a) => `Ho aperto ${a}.`, units: { seconds: 'secondi', minutes: 'minuti', hours: 'ore' } },
  pt: { pause: 'Pausado.', play: 'Tocando.', next: 'Próxima música.', previous: 'Música anterior.', up: 'Volume aumentado.', down: 'Volume diminuído.', mute: 'Sem som.', unmute: 'Som ativado.', lock: 'Bloqueado.', time: (t) => `São ${t}.`, date: (d) => `Hoje é ${d}.`, timer: (n, u) => `Temporizador de ${n} ${u}.`, none: 'Nada está tocando.', open: (a) => `${a} aberto.`, units: { seconds: 'segundos', minutes: 'minutos', hours: 'horas' } }
};
const LOCALES = { es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-BR' };

// cmd: the parsed English quick command; reply: the English reply it produced; now: a Date. Returns the reply in `lang`.
function localizeReply(lang, cmd, reply, now = new Date()) {
  const r = R[lang];
  if (!r || !cmd) return reply;
  if (cmd.type === 'media') {
    if (/^Nothing is playing/.test(reply)) return r.none;
    return { pause: r.pause, play: r.play, next: r.next, previous: r.previous }[cmd.op] || reply;
  }
  if (cmd.type === 'volume') return { up: r.up, down: r.down, mute: r.mute, unmute: r.unmute, set: reply }[cmd.op] || reply;
  if (cmd.type === 'lock') return r.lock;
  if (cmd.type === 'info' && cmd.what === 'time') return r.time(now.toLocaleTimeString(LOCALES[lang], { hour: 'numeric', minute: '2-digit' }));
  if (cmd.type === 'info' && cmd.what === 'date') return r.date(now.toLocaleDateString(LOCALES[lang], { weekday: 'long', day: 'numeric', month: 'long' }));
  if (cmd.type === 'timer') { const s = cmd.seconds; const [n, u] = s % 3600 === 0 ? [s / 3600, 'hours'] : s % 60 === 0 ? [s / 60, 'minutes'] : [s, 'seconds']; return r.timer(n, r.units[u]); }
  if (cmd.type === 'open-app') return r.open(cmd.name);
  return reply;
}

module.exports = { translateCommand, localizeReply, RULES };
