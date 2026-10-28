// Relay's own menus and settings in Spanish. Exact text in, Spanish out: anything not listed stays English (the long explanations under each setting are not
// translated yet; sentences with numbers or names in them are only handled where there is a pattern below). Works in the window and in the menu bar.
(function () {
  const ES = {
    // sidebar and page titles
    Home: 'Inicio', History: 'Historial', Routines: 'Rutinas', Vocabulary: 'Vocabulario', Memory: 'Memoria', Connectors: 'Conectores', Remote: 'Remoto', General: 'General', Speech: 'Voz', Shortcuts: 'Atajos', Permissions: 'Permisos', Account: 'Cuenta',
    // home
    'Get started': 'Primeros pasos', 'Ask Relay': 'Pregúntale a Relay', 'Say what you want done. It acts, then checks that it worked.': 'Di qué quieres que haga. Actúa y luego comprueba que funcionó.', Dictate: 'Dictar', 'Talk, and the words are typed where your cursor is.': 'Habla y las palabras se escriben donde está tu cursor.',
    'Type a request': 'Escribir una petición', "For when talking isn't an option.": 'Para cuando no puedes hablar.', 'Customize your shortcuts': 'Personaliza tus atajos', 'Change the keys for any of these.': 'Cambia las teclas de cualquiera de estos.',
    Requests: 'Peticiones', 'Actions taken': 'Acciones realizadas', 'Words dictated': 'Palabras dictadas', 'Time saved': 'Tiempo ahorrado', 'All time': 'Todo el tiempo', Today: 'Hoy', 'Last 7 days': 'Últimos 7 días', Ready: 'Listo', 'Dictation unavailable': 'Dictado no disponible',
    // history
    Actions: 'Acciones', Dictation: 'Dictado', Recent: 'Recientes', Undo: 'Deshacer', 'Undoing…': 'Deshaciendo…', Undone: 'Deshecho', 'No actions yet.': 'Aún no hay acciones.',
    // buttons and small words
    Add: 'Añadir', Allow: 'Permitir', Cancel: 'Cancelar', Connect: 'Conectar', Copy: 'Copiar', Delete: 'Eliminar', Disconnect: 'Desconectar', Edit: 'Editar', Forget: 'Olvidar', 'Forget all': 'Olvidar todo', 'New Routine': 'Nueva rutina', Record: 'Grabar', 'Record it': 'Grábalo', Remove: 'Quitar', Run: 'Ejecutar',
    Save: 'Guardar', 'Sign Out': 'Cerrar sesión', Test: 'Probar', 'Test it': 'Pruébalo', 'Test voice': 'Probar la voz', 'Test connection': 'Probar la conexión', 'Try it': 'Pruébalo', 'Try saying': 'Prueba a decir', 'Turn off': 'Desactivar', Unpair: 'Desvincular', 'Use it': 'Úsalo', 'Use…': 'Usar…', 'Open Settings': 'Abrir Ajustes',
    'Check Again': 'Comprobar de nuevo', 'Check again': 'Comprobar de nuevo', 'Copy the key': 'Copiar la clave', 'Send a test': 'Enviar una prueba', 'Pair a phone': 'Vincular un teléfono', 'Paired phones': 'Teléfonos vinculados', 'Download the voice': 'Descargar la voz', 'Make the secure link': 'Crear el enlace seguro', 'Secure link on': 'Enlace seguro activado',
    'Make a Shortcut key': 'Crear una clave de Atajo', 'Save the Shortcut file': 'Guardar el archivo de Atajo', 'Save “Send to Relay” (share sheet)': 'Guardar “Enviar a Relay” (hoja de compartir)', 'Hey Siri, Relay (iPhone Shortcut)': 'Oye Siri, Relay (Atajo del iPhone)', 'Make one by voice': 'Crea uno con la voz', 'Say it in one go': 'Dilo de una vez',
    // sections and settings
    '3D models': 'Modelos 3D', 'Answer cards with pictures': 'Tarjetas de respuesta con imágenes', 'Answers in': 'Responder en', 'The language I asked in': 'El idioma en que pregunté', Language: 'Idioma', 'Menus and settings in': 'Menús y ajustes en',
    'Allow on my home Wi-Fi': 'Permitir en el Wi-Fi de mi casa', 'Away from home: Tailscale': 'Fuera de casa: Tailscale', 'Count me as away after': 'Considerarme ausente después de', 'Apps Relay works in': 'Apps donde funciona Relay', 'Only listen in these apps': 'Escuchar solo en estas apps', 'Dictation style by app': 'Estilo de dictado por app',
    'Ask before leaving my home folder': 'Preguntar antes de salir de mi carpeta personal', 'Evening recap': 'Resumen de la tarde', 'Robotics log sheet': 'Hoja de registro de robótica', 'Clipboard history': 'Historial del portapapeles', 'Morning briefing': 'Resumen de la mañana', 'Workshop mode': 'Modo taller',
    'Let Relay do things for you': 'Deja que Relay haga cosas por ti', 'Relay cursor': 'Cursor de Relay', 'Cursor buddy': 'Compañero del cursor', 'Hand control (camera)': 'Control con las manos (cámara)', 'Show hand view (top right)': 'Mostrar la vista de la mano (arriba a la derecha)', 'Show Me': 'Muéstrame', 'What your hands do': 'Qué hacen tus manos',
    'Pause music when I leave the desk': 'Pausar la música cuando me voy del escritorio', 'Lock my Mac when I leave too': 'Bloquear mi Mac también cuando me voy', 'Listen for “Hey Jarvis”': 'Escuchar “Hey Jarvis”', 'Wake phrase': 'Frase de activación', 'Keep listening after an answer': 'Seguir escuchando después de una respuesta',
    'Interrupt by talking': 'Interrumpir hablando', 'Interrupt with': 'Interrumpir con', 'Stop words only': 'Solo palabras de parada', 'Any speech': 'Cualquier voz', 'Lower the volume while I talk': 'Bajar el volumen mientras hablo', 'Play sounds': 'Reproducir sonidos', 'Speak replies': 'Leer las respuestas en voz alta', 'Spoken replies': 'Respuestas habladas',
    'Soft voice for confirmations': 'Voz suave para las confirmaciones', 'Sound like Jarvis': 'Sonar como Jarvis', 'More natural voices': 'Voces más naturales', 'Voice engine': 'Motor de voz', Voice: 'Voz', Speed: 'Velocidad', Slower: 'Más lento', Faster: 'Más rápido', Microphone: 'Micrófono', Automatic: 'Automático', Auto: 'Auto', 'Apple on-device speech': 'Voz de Apple en el dispositivo', 'On-device (beta)': 'En el dispositivo (beta)',
    'Make 3D models from real photos': 'Crear modelos 3D a partir de fotos reales', 'Holograms slowly turn': 'Los hologramas giran despacio', 'Show usage after each ask': 'Mostrar el uso después de cada petición', 'Learn my words from corrections': 'Aprender mis palabras con las correcciones', 'Keep dictation history': 'Guardar el historial de dictado',
    'Remember things about me': 'Recordar cosas sobre mí', 'Recent asks on the left edge': 'Peticiones recientes en el borde izquierdo', 'Show in Dock': 'Mostrar en el Dock', 'Open at login': 'Abrir al iniciar sesión', 'Tidy my Downloads each evening': 'Ordenar mis Descargas cada tarde', 'Send a message to my phone': 'Enviar un mensaje a mi teléfono',
    'Tell my phone when a long job finishes': 'Avisar a mi teléfono cuando termine una tarea larga', 'Send iMessages to': 'Enviar iMessages a', 'Focus mode closes these apps': 'El modo concentración cierra estas apps', 'Keep what just worked': 'Guardar lo que acaba de funcionar', 'Word fixes': 'Correcciones de palabras',
    'Name in the reactor': 'Nombre en el reactor', 'Liquid glass pill': 'Píldora de cristal líquido', 'Screen size (for real size)': 'Tamaño de pantalla (para el tamaño real)', 'No analytics': 'Sin analíticas', 'Good to know': 'Conviene saber', Look: 'Aspecto', Menu: 'Menú', Bar: 'Barra', Classic: 'Clásico', Normal: 'Normal', Casual: 'Informal', Preview: 'Vista previa',
    'Relay Remote': 'Relay Remoto', 'On this Mac': 'En este Mac', 'Claude account': 'Cuenta de Claude', 'Claude model': 'Modelo de Claude', Model: 'Modelo', 'Model service': 'Servicio de modelo', 'Anthropic API key': 'Clave de API de Anthropic', 'Hugging Face token (optional)': 'Token de Hugging Face (opcional)',
    'Gmail, Google Calendar, Drive and Sheets': 'Gmail, Google Calendar, Drive y Sheets', 'All your other apps (Composio)': 'Todas tus otras apps (Composio)', Scheduled: 'Programado', Topic: 'Tema', Ideas: 'Ideas', How: 'Cómo', Hold: 'Mantener', Tap: 'Tocar', 'Tap or hold': 'Tocar/mantener', Talking: 'Al hablar', Side: 'Lado', 'Chat (press Return)': 'Chat (pulsa Intro)',
    'Private Meeting Answers': 'Respuestas privadas en reuniones', 'Private meeting answers': 'Respuestas privadas en reuniones', 'Test the private window': 'Probar la ventana privada', 'Hide the answer window from screen sharing': 'Ocultar la ventana de respuestas al compartir pantalla', 'Only answer when my name is said': 'Responder solo cuando dicen mi nombre', 'Same as the microphone setting': 'Igual que el ajuste del micrófono',
    'Switch to Codex when Claude runs out': 'Cambiar a Codex cuando Claude se quede sin uso', 'Backup when Claude runs out': 'Respaldo cuando Claude se queda sin uso', 'Sign in with ChatGPT': 'Iniciar sesión con ChatGPT',
    'Learned about you': 'Lo que Relay notó de ti', 'Lessons from your corrections': 'Lecciones de tus correcciones', Approve: 'Aprobar', 'Smarter memory': 'Memoria más inteligente', 'in use': 'en uso',
    Plugins: 'Complementos', 'Look at it': 'Revisarlo', 'Approve and install': 'Aprobar e instalar', 'Approve update': 'Aprobar actualización', Cancel: 'Cancelar', Remove: 'Quitar', 'Check for update': 'Buscar actualización', 'Command Relay by text': 'Controlar Relay por mensaje', 'Show code': 'Mostrar código', Unpair: 'Desemparejar',
    'Ask my notes': 'Preguntar a mis notas', 'Add a folder': 'Añadir una carpeta', 'Index now': 'Indexar ahora', Update: 'Actualizar', 'Live panels': 'Paneles en vivo',
    Doctor: 'Doctor', 'Relay Doctor': 'Doctor de Relay', 'Checking…': 'Comprobando…', 'Check again': 'Comprobar de nuevo', 'Copy report': 'Copiar informe', 'Report a bug': 'Informar de un error', 'Request a feature': 'Pedir una función', 'Fixed automatically': 'Arreglado automáticamente', 'When Doctor can fix something': 'Cuando Doctor pueda arreglar algo', 'Ask first': 'Preguntar antes', 'Fix small things': 'Arreglar cosas pequeñas', 'Only tell me': 'Solo avisarme', Experimental: 'Experimental',
    'Homework helper': 'Ayudante de tareas', 'Allow whole solutions (complete the assignment)': 'Permitir soluciones completas (completar la tarea)', 'Explain what it made': 'Explicar lo que hizo', 'Save as': 'Guardar como', Word: 'Word', 'Plain text': 'Texto sin formato',
    'Keep answers on screen until I dismiss them': 'Mantener las respuestas en pantalla hasta que las cierre',
    Listening: 'Escucha', 'Shortcuts off': 'Atajos desactivados', 'to ask': 'para preguntar', Typing: 'Escritura',
    // languages
    English: 'Inglés', Spanish: 'Español', French: 'Francés', German: 'Alemán', Italian: 'Italiano', Portuguese: 'Portugués', Dutch: 'Neerlandés', Japanese: 'Japonés', Chinese: 'Chino', Korean: 'Coreano', Russian: 'Ruso', Arabic: 'Árabe', Hindi: 'Hindi', Turkish: 'Turco', Polish: 'Polaco',
    // menu bar
    'Type a Request…': 'Escribir una petición…', 'No Background Agents': 'Sin agentes en segundo plano', 'No Holograms': 'Sin hologramas', 'Hand control (camera)': 'Control con las manos (cámara)', 'Show Hand View (top right)': 'Mostrar la vista de la mano (arriba a la derecha)', 'Hand control (camera): problem, click to retry': 'Control con las manos (cámara): hay un problema, haz clic para reintentar',
    'Stop Speaking': 'Dejar de hablar', 'Copy Last Reply': 'Copiar la última respuesta', 'Last: nothing yet': 'Última: nada todavía', 'Take Meeting Notes': 'Tomar notas de la reunión', 'Model Speed': 'Velocidad del modelo', 'Fast (Haiku)': 'Rápido (Haiku)', 'Smart (Sonnet)': 'Inteligente (Sonnet)', 'Deep (Opus)': 'Profundo (Opus)',
    'Relay Remote (phone)': 'Relay Remoto (teléfono)', 'Show the cursor buddy': 'Mostrar el compañero del cursor', 'Open Relay': 'Abrir Relay', 'Settings…': 'Ajustes…', 'Welcome Guide…': 'Guía de bienvenida…', 'About Relay': 'Acerca de Relay', 'Quit Relay': 'Salir de Relay', 'Shortcuts off (see Permissions)': 'Atajos desactivados (ver Permisos)'
  };
  // Sentences with a number or a name in them.
  const PATTERNS = [
    [/^Ready · (.+) to ask$/, 'Listo · $1 para preguntar'],
    [/^Stop (\d+) Background Agents?$/, (m) => `Detener ${m[1]} ${m[1] === '1' ? 'agente' : 'agentes'} en segundo plano`],
    [/^Clear (\d+) Holograms?$/, (m) => `Quitar ${m[1]} ${m[1] === '1' ? 'holograma' : 'hologramas'}`],
    [/^Last: (.+)$/, 'Última: $1']
  ];

  function translate(text, lang) {
    if (lang !== 'es' || typeof text !== 'string') return text;
    const t = text.trim();
    if (!t) return text;
    if (Object.prototype.hasOwnProperty.call(ES, t)) return text.replace(t, ES[t]);
    for (const [re, to] of PATTERNS) { const m = t.match(re); if (m) return text.replace(t, typeof to === 'function' ? to(m) : t.replace(re, to)); }
    return text;
  }

  // The menu-bar template, translated (labels only; submenus too).
  function localizeMenu(items, lang) {
    return items.map((it) => ({ ...it, ...(it.label ? { label: translate(it.label, lang) } : {}), ...(it.submenu ? { submenu: localizeMenu(it.submenu, lang) } : {}) }));
  }

  // The window: every text node, and placeholders and titles, whose whole text is listed above.
  function translateTree(root, lang) {
    if (lang !== 'es') return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) { const v = translate(n.nodeValue, lang); if (v !== n.nodeValue) n.nodeValue = v; }
    for (const el of root.querySelectorAll('[placeholder],[title]')) for (const a of ['placeholder', 'title']) if (el.hasAttribute(a)) { const v = translate(el.getAttribute(a), lang); if (v !== el.getAttribute(a)) el.setAttribute(a, v); }
  }

  const api = { translate, localizeMenu, translateTree, ES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RelayUI = api;
})();
