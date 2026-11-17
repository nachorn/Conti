# Cambio gratuito: migración y recuperación

El primer corte al almacenamiento local ya se realizó; consultar `APPLIED.md` para sus evidencias y las copias. Este procedimiento se conserva para operaciones futuras. Nunca ejecutar el importador contra un escritor activo ni sobrescribir los archivos principales para repetir una migración.

## Preparación y prueba inicial

1. Compilar el candidato desde el código aprobado, incluidos `server/dist/cli/migrate-to-local.js` y `server/dist/cli/checkpoint-local-to-postgres.js` en el build normal. El artefacto Azure debe incluir también `ops/free/*.sh` y `ops/free/backup/pressure-guard.sh` con LF. No necesita tsx ni paquetes de desarrollo en producción.
2. Conservar todos los secretos existentes en canales protegidos. Preparar el directorio `nrn:nrn` 0700 y entornos 0600 sólo cuando root autorice el staging. El backup.env contiene únicamente las claves necesarias y los paths; no copia claves de correo/pagos que el job no necesita.
3. Detener el escritor PostgreSQL anterior y verificar liberación de ambos namespaces. Capturar un baseline fresco de los dos snapshots con SHA-256, versiones y conteos; no reemplazarlo por conteos históricos. Conservar una copia privada recuperable fuera del servidor.
4. Ejecutar el migrador compilado como `nrn`. Es plan por defecto; `--apply` requiere `--confirm-writer-stopped`, `--expected-game-sha256 <hash>` y `--expected-membership-sha256 <hash>`. DATABASE_URL, auth y paths proceden del entorno privado, nunca de argumentos ni logs.
5. La instalación crea ambos archivos regulares distintos de forma exclusiva, sin sobrescribir datos existentes. Cada fichero es atómico; no existe un rename atómico de la pareja. Un código de salida no cero o la ausencia de cualquier fichero impiden arrancar. No eliminar/reescribir un archivo parcial a ciegas para forzar el arranque.
6. Configurar explícitamente modo file, paths absolutos y URL pública del worker. Mantener la misma clave de cuentas y todos los campos de ambos snapshots. El código debe ignorar DATABASE_URL en el backend file y no abrir PostgreSQL.
7. Arrancar el candidato. Comprobar health/ready, ambos locks de archivo, permisos, huellas/conteos idénticos y ausencia de locks PostgreSQL del backend. Confirmar que RACE conserva PID, arranque y prioridades. No crear usuarios, correos, compras o salas de producción como prueba.

## Habilitar copias sólo después de restaurar una

- Ejecutar **un checkpoint manual** del par validado con el CLI compilado `checkpoint-local-to-postgres.js --apply`, con las mismas guardas de memoria y privacidad del servicio. La operación debe escribir ambos snapshots en una transacción, cerrar la conexión y no habilitar pools/heartbeats.
- Leer ese checkpoint en una carpeta privada **aislada**, sin sobrescribir los datos principales. Validar los dos snapshots restaurados con los validadores de dominio y comparar SHA-256, versiones y conteos, incluidos sesiones, recovery tokens y Plus/BMC. La restauración no envía correos ni crea cuentas.
- Sólo después instalar/habilitar el timer propuesto a :20 UTC. Los ExecCondition van antes de Node: permisos primero, presión después. La unidad sólo lee los archivos principales; no obtiene sus locks exclusivos ni cambia sus permisos.
- Verificar un éxito, una omisión deliberada por presión con datos sintéticos/locales y que no haya ejecución continua que mantenga Neon despierto. Revisar periódicamente última copia correcta y cuotas; RPO puede superar una hora tras omisiones o fallos.

## Recuperación y reversión

Un fallo de Neon sólo debe afectar al respaldo, no a login ni a partidas primarias. Un fallo de la VM/disco requiere restaurar el último checkpoint **verificado**; se admite la pérdida de cambios posterior a esa copia según el RPO. No prometer cero pérdida por tener un servidor de respaldo.

Para volver de archivos al backend PostgreSQL, detener primero el escritor de archivos y tomar una copia coherente actual. Restaurar esa pareja actual bajo locks en PostgreSQL y conservar la clave de autenticación. **No arrancar con el viejo snapshot de Neon si ya hubo cambios locales más recientes.** Verificar huellas, sesiones, salas y exclusión del escritor anterior antes de cambiar el modo de nuevo.

Los snapshots locales/Neon no incluyen por sí solos la clave principal ni toda la configuración privada. Conservar una copia externa cifrada de la configuración necesaria para recuperación, bajo control del usuario y sin valores en Git, capturas, argumentos o registros. No borrar las únicas copias para completar una limpieza.

Este diseño no instala Postgres en la VM, no crea recursos de pago, no toca DNS/Caddy/NSG y no reintenta eliminar el recurso Managed Run Command bloqueado.
