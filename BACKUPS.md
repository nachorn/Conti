# Copias y recuperación de NRN Play

Las partidas y las cuentas se guardan por separado y deben recuperarse juntas. Las copias contienen emails, resultados, compras, manos privadas y hashes de credenciales: mantenerlas fuera de Git, en almacenamiento privado con acceso limitado y cifrado. No adjuntarlas a incidencias ni pegarlas en logs.

## Exportación de snapshots de PostgreSQL

La herramienta `server/scripts/backup-snapshots.ts` lee `conti_game_state` y `conti_membership_state` dentro de una transacción de solo lectura con una misma vista de la base de datos. No toma el bloqueo del escritor, no cambia tablas y no detiene las partidas. Valida las estructuras antes de exportar y crea una carpeta nueva única dentro del directorio padre indicado.

Desde `server`, con `DATABASE_URL` configurada de forma privada en el entorno y un directorio padre existente:

```powershell
node --import tsx scripts/backup-snapshots.ts --directory 'D:/PrivateBackups/NRNPlay'
```

No escribir la URL en la línea de comandos, en capturas o en documentos. La herramienta usa los ajustes TLS de la conexión sin desactivar la verificación. Los archivos se crean con permisos restrictivos; en Windows también debe comprobarse la lista de acceso de la carpeta. Un archivo `manifest.json` final acredita que se terminó la exportación y contiene hashes de los archivos. No tratar una carpeta sin manifiesto como copia completa.

Esto copia el estado de la aplicación, **no todo el esquema, roles o configuración de PostgreSQL**. Mantener además las copias y recuperación del proveedor o un `pg_dump` consistente de la base completa. Definir periodicidad y retención de acuerdo con la pérdida máxima de datos tolerable; esta entrega no crea una programación ni acredita una copia de producción realizada.

## Alternativa con ficheros persistentes

Si se usa `GAME_STATE_PATH` y `MEMBERSHIP_STATE_PATH`, detener primero el único escritor, esperar a que cierre y copiar ambos archivos del mismo momento a una carpeta privada nueva. No copiar archivos de un servicio gratuito cuyo disco sea efímero como si fueran almacenamiento duradero. No reemplazar originales para comprobar una copia.

## Validación sin tocar los originales

La herramienta offline valida los dos JSON y reconstruye el estado únicamente en memoria:

```powershell
node --import tsx scripts/snapshot-capacity.ts --game 'D:/PrivateBackups/NRNPlay/copia/game.json' --membership 'D:/PrivateBackups/NRNPlay/copia/membership.json'
```

Ejecutar desde `server` y usar los nombres reales generados por la exportación. El resultado muestra tamaños y conteos, nunca el contenido privado. Un código de salida 2 indica copia válida con advertencia de capacidad; un código 1 indica fallo. La herramienta no prueba la antigüedad de la copia, las claves del proveedor de correo o la entrega de mensajes, ni restaura el servicio.

## Prueba de recuperación y cambio real

1. Verificar el manifiesto, los hashes y la fecha; conservar los archivos fuente intactos.
2. Restaurar en una base o volumen **nuevo y aislado**, sin usar el destino de producción. Arrancar una sola instancia de prueba contra esa copia, con correo, pagos y anuncios desactivados.
3. Comprobar carga, conteos, últimas partidas, resultados y ligas. Validar la compatibilidad del formato v1, v2 o v3. Una versión de servidor antigua que no soporte el formato debe rechazarlo, nunca descartarlo.
4. Antes de un cambio real, detener el escritor anterior y conservar una copia de su último estado. Revisar el destino y mantener los secretos de autenticación seguros y compatibles.
5. Arrancar el nuevo escritor y verificar `/health`, `/ready`, reconexión y una partida. Mantener el original intacto durante la comprobación.

Las pruebas de esta entrega validan la exportación con un lector de base de datos simulado y la restauración de JSON en memoria. **La retención del proveedor y una recuperación real de producción siguen pendientes de verificar.**

## Capacidad

El panel del propietario expone tamaños y alertas sin hacer consultas a la base ni revelar su contenido. El límite de cada snapshot sigue siendo 16 MiB. Se reservan 128 KiB por sala y 256 KiB de control; con poco historial permite aproximadamente 125 salas guardadas. Al agotarse el margen se frenan nuevas admisiones y nuevos repartos, sin borrar el estado existente ni tratar ese rechazo como una caída del almacenamiento.

La reserva es una protección conservadora, no una garantía para estados heredados que ya estén llenos ni una solución al crecimiento permanente del historial. El siguiente cambio de arquitectura debe separar resultados y ligas en tablas con índices, transacciones y una migración reversible verificada. Subir el plan del servidor no elimina este límite del código.
