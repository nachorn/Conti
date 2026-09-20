# Chat de sala y aviso de turno

Implementado localmente el 20 de septiembre de 2026. Pendiente de despliegue de cliente y servidor.

## Comportamiento

- Pocha y Continental comparten un botón de sonido y un chat plegable en la barra superior, incluidos lobby y partidas guardadas en pausa.
- Ping breve de dos notas, volumen bajo, al llegar una decisión propia. Pocha incluye predicción, subasta, elección de triunfo y jugar carta; espera a que acabe la revisión de la baza. Continental incluye tomar/pasar un descarte, respetando la espera configurada. Las actualizaciones dentro del mismo turno y las reconexiones no repiten un aviso ya emitido.
- Sonido activado inicialmente, preferencia de silencio guardada en el navegador. Activarlo reproduce una muestra. Se crea/reanuda AudioContext durante un gesto del usuario, conforme a [MDN](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay). No requiere archivos externos ni permisos de notificaciones. No garantiza sonido si el sistema/navegador suspende el audio o silencia la pestaña.
- Chat con texto, seis emojis rápidos, contador de mensajes sin leer, Enter para enviar, Shift+Enter para nueva línea y Escape para cerrar. En móvil se abre sobre la mesa y se puede cerrar para jugar.
- Hasta 280 caracteres por mensaje, últimos 50 mensajes conservados con la partida. Mensajes solo para asientos autenticados de esa sala; el servidor fija autor, nombre e identificador. No se incluyen en estado público, invitaciones, dashboard o informes de errores.
- Máximo cinco mensajes por jugador cada diez segundos. Reintentos con el mismo identificador no duplican mensajes. Solo se confirma y publica después de persistir. Un envío fallido conserva el borrador. El chat no altera las cartas, la pausa, el turno ni los eventos de animación.

## Validación

- Servidor: 166 pruebas aprobadas; cliente: 67 pruebas aprobadas. Ambos compiladores TypeScript y build Vite correctos.
- Pruebas nuevas: aislamiento entre salas, identidad canónica, reintentos, límites, validación de snapshots, persistencia/reinicio en ambos juegos, chat en pausa, fallo de almacenamiento sin publicación, selección de decisiones y programación/limpieza de audio.
- Navegador local con dos jugadores de prueba y dos bots en Pocha: envío y recepción, emoji, contador sin leer, Escape, representación literal de etiquetas HTML, historial al recargar y preferencia de silencio al recargar. Continental probado durante una partida con tres jugadores.
- Revisión visual a 320×740, 390×844, 820×1180, 1366×900 y 844×390. Panel y formulario dentro de la pantalla; ajustado el espacio entre emojis para pantallas estrechas. Sin errores ni avisos de consola en los recorridos revisados.
- El audio se validó mediante pruebas de programación Web Audio y sus controles de interfaz; no mediante escucha física en un móvil/iPad.

Los cambios previos de documentos, privacidad/condiciones y enlaces de Lobby pertenecen a otras tareas y no forman parte de este cambio.
