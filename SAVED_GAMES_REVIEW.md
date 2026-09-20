# Partidas guardadas sin cuentas

Implementado y verificado localmente el 19 de septiembre de 2026. Pendiente de despliegue.

## Comportamiento

- Pocha y Continental guardan automáticamente las jugadas en el almacenamiento existente del servidor.
- «Mis partidas» conserva en este navegador las credenciales privadas de cada asiento y un resumen (juego, sala, nombre, jugadores, ronda y última conexión). No almacena manos ni el estado privado del juego en el navegador.
- El anfitrión puede «Guardar y salir»: conserva todos los asientos y pausa los turnos. Los invitados reciben la pantalla de partida guardada.
- Un invitado puede guardar y salir conservando su sitio; solo el anfitrión pausa a todos. El diálogo lo explica antes de salir.
- Volver a la sala conserva la pausa. Solo el anfitrión puede continuar y debe esperar a que todos los jugadores estén conectados.
- El servidor conserva las salas durante 30 días de inactividad. Los registros antiguos siguen siendo compatibles.
- «Abandonar definitivamente» sigue siendo una acción distinta, con confirmación. Invalida el acceso al asiento. En Pocha reinicia la mesa, como antes.
- «Olvidar» elimina solamente el acceso guardado en este navegador, con confirmación.
- No requiere cuentas. Cada jugador vuelve con el mismo navegador y dispositivo. Borrar los datos del navegador elimina ese acceso; no se ha añadido transferencia entre dispositivos.

## Protección y compatibilidad

La pausa manual se persiste por separado de la pausa automática de desconexión. Reconectar o reiniciar el servidor no la levanta. Todas las jugadas quedan bloqueadas en el servidor mientras está activa. Las confirmaciones se envían después de guardar de forma duradera; ante un fallo no se anuncia éxito ni se retira el asiento.

El acceso activo sigue aislado por pestaña. El catálogo usa una clave local independiente por asiento para que distintas pestañas no sobrescriban otras partidas. Una sala no disponible solo se elimina del catálogo tras rechazo autorizado del servidor o una acción explícita; los errores de red conservan el acceso.

## Verificación

- 160 pruebas de servidor aprobadas, incluyendo Pocha y Continental: guardar en ronda, bloquear jugadas, reiniciar, recuperar manos/turno/puntos, no filtrar cartas rivales, exigir anfitrión y todos los jugadores, continuar, salida de invitados, revocar al abandonar, fallo de almacenamiento, compatibilidad antigua y caducidad.
- 63 pruebas de cliente aprobadas, incluyendo catálogo de varias salas/asientos, datos dañados, almacenamiento bloqueado, actualización de resúmenes y ausencia de cartas en el catálogo.
- Compilaciones TypeScript del servidor y cliente y build Vite correctos.
- Revisión real en navegador: dos invitados simulados por sala; guardar Pocha, cerrar pestaña, abrir una nueva, recuperar y continuar con la misma carta y triunfo; guardar Conti con temporizador, recuperar las siete cartas y continuar; mantener ambas salas en el catálogo.
- Revisión visual a 390×844, 820×1180 y 1280×800. Conti móvil sin desbordamiento horizontal ni crecimiento del documento fuera de la pantalla de juego. Sin errores de consola observados.

## Publicación

Requiere cliente y servidor de esta versión. Usar el procedimiento existente de mantenimiento/despliegue con un único escritor de la base de datos. No se ha desplegado ni modificado la configuración de cuentas, anuncios o pagos en esta tarea. Se han conservado los cambios previos ajenos de este directorio.
