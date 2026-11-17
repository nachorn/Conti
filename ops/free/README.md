# NRN Play: despliegue gratuito

**Activo en Azure.** Backend `e65052ff36ca8e4b9cf85765f5914a33f5120d75`, CLI corregidos en `54494349800c9ac0ca823ad7198f78e8c3435951`, sobre la base `bb279b4a970f85dcdee37a900ab6cf134e6fb8b7`. No hay recursos ni planes nuevos de pago. Las propuestas pagadas/híbridas anteriores permanecen aisladas y no se usan. Consultar [APPLIED.md](APPLIED.md) para la comprobación de la copia y el estado del timer.

## Datos primarios y acceso

Azure sigue ejecutando el backend combinado. Los datos principales pasan al disco persistente que ya tiene la VM:

- `NRN_STORAGE_MODE=file`
- `GAME_STATE_PATH=/var/lib/nrnplay/games.json`
- `MEMBERSHIP_STATE_PATH=/var/lib/nrnplay/memberships.json`

La clave principal, contraseñas, sesiones, recovery tokens, salas, ligas, resultados, Plus/BMC, cosméticos y anuncios se conservan completos. En modo file la aplicación **no abre conexiones PostgreSQL**, aunque el entorno privado conserve DATABASE_URL para la copia. Debe conservarse esa variable también en el entorno principal: la validación actual de Plus/BMC usa su presencia como indicador de persistencia. Esto no abre una conexión ni depende de que Neon esté activo. No se instala un proceso PostgreSQL local.

Lectura ligera del disco existente: 32.162.967.552 bytes de tamaño, 17.918.369.792 bytes disponibles (aprox. 16,7 GiB), 45% ocupado. Los snapshots actuales son pequeños frente a ese espacio. Las futuras copias no deben acumularse sin límite en el disco del servidor.

El directorio primario pertenece a `nrn`, modo 0700; ambos JSON y los archivos de entorno son 0600. El arranque falla si falta un JSON, es un enlace, no pertenece al usuario o sus permisos son incorrectos. No se permite arrancar vacío tras una migración incompleta.

## Copia externa horaria

Neon Free sale de la ruta de acceso y juego: sólo recibe checkpoints de respaldo. El timer activo ejecuta a los minutos **:20 de cada hora UTC**, sin catch-up al arrancar. Normalmente deja margen antes del trabajo RACE 18:40–19:05 UTC; si éste se alarga, la guarda sigue teniendo prioridad.

Dos condiciones de shell se ejecutan **antes de importar Node**: privacidad de archivos y presión de memoria. Se omite la copia si RACE alcanza 300 MiB, MemAvailable baja de 256 MiB o no se puede verificar la presión. No se reinicia RACE ni se alteran sus tareas.

La copia usa `nrn`, Nice 10, CPUWeight 10, MemoryHigh 128 MiB, MemoryMax 192 MiB, swap máximo 128 MiB y OOMScoreAdjust 800. App, configuración y datos primarios quedan de sólo lectura en su namespace. No hay reintento automático para mantener Neon despierto; el siguiente intento es el próximo horario.

El CLI valida una pareja estable de archivos antes de conectarse. Los archivos se guardan individualmente por rename atómico; la pareja no tiene un rename atómico conjunto. El checkpoint vuelve a leer cuentas para detectar cambios durante la lectura. En Neon se escriben ambos snapshots dentro de **una sola transacción**, con try-locks de los namespaces 1/2: si reaparece un escritor PostgreSQL antiguo, se omite la escritura. La conexión se cierra al terminar.

Estimación: 24 × 31 × 5 minutos × 0,25 CU ≈ **15,5 CU-h/mes**, suponiendo operaciones breves y el tamaño mínimo de Neon. Es una estimación, no una garantía del proveedor: hay que vigilar la cuota gratuita de 100 CU-h y el almacenamiento. No se añade ningún complemento pagado ni SQL de keepalive.

**RPO nominal: una hora desde la última copia correcta.** Si se omiten ejecuciones por RACE, baja RAM, caída de red, cuota o error de Neon, puede ser mayor. La copia externa es un checkpoint actual; no promete retención histórica ilimitada. Una copia inicial y una restauración aislada comprobada son obligatorias antes de habilitar el timer.

## Render Free y contraseñas

La web y los orígenes API permanecen como ahora. El Render existente conserva su proxy y ejecuta un worker privado para el KDF, usado sólo por solicitudes reales cuando haya presión. El endpoint es `POST /internal/password/derive`; su semilla se deriva de la clave existente con el contexto `nrnplay:password-worker:v1`, sin una nueva clave persistente.

Render Free puede dormir tras 15 minutos y tardar alrededor de un minuto en arrancar. El worker no se mantiene caliente con cron ni health polling. Si falla su intento acotado de 4 segundos, sólo se calcula localmente si la memoria lo permite; con RACE bajo presión se solicita reintento. La guarda exige además al menos 160 MiB de margen dentro del cgroup de NRN y cada ancestro con límite finito. Los valores ausentes o inválidos impiden el cálculo local. No se promete disponibilidad caliente constante ni se acumula una cola ilimitada de contraseñas reales.

## Protección que se conserva

RACE mantiene CPUWeight 1000, MemoryLow 640 MiB en unidad y ancestro system.slice, y OOMScoreAdjust -250 efectivo. NRN mantiene CPUWeight 200, Nice 5, máximo 384 MiB y OOMScoreAdjust 500. El resto de aplicaciones queda por debajo, con CPUWeight 10 y OOMScoreAdjust 800. No se añaden límites duros a RACE ni MemoryLow a NRN que resten su protección.

No cambian Caddy, NSG, DNS ni dominios. Se conserva la eliminación de cabeceras en registros y la prohibición de `--environ`. El recurso Managed Run Command temporal cuya limpieza fue bloqueada se deja inactivo; no se reintenta eliminarlo.

Consultar `MIGRATION.md` antes de cualquier cambio, `VALIDATION.md` para las comprobaciones y `APPLIED.md` para el despliegue realizado. Las unidades son referencias: en producción se conservó la unidad principal existente y se añadió un drop-in para los archivos locales.
