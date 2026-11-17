# Despliegue gratuito: 17 de noviembre de 2026 UTC

## Estado

Azure ejecuta el servidor principal y guarda los datos en su disco persistente. El backend no abre PostgreSQL ni necesita despertar Neon para leer cuentas, sesiones o partidas. Se conservan los recursos y planes existentes; no se añadió ningún coste.

- Fuente Azure: `e65052ff36ca8e4b9cf85765f5914a33f5120d75`.
- Artefacto e650: SHA-256 `cfd38057c10f2435098118237cc156f569fec5f534651118af2d9353eef22b4b`.
- `current` y los próximos arranques usan `54494349800c9ac0ca823ad7198f78e8c3435951`, con las dos CLI corregidas y 35 archivos runtime de aplicación idénticos a e650.
- Unidad activa desde `2026-11-17T03:25:02Z`, PID inicial `689200`, sin reinicios tras el corte.
- Archivos: `/var/lib/nrnplay/games.json` y `/var/lib/nrnplay/memberships.json`.
- Se mantuvo la unidad principal con todo su endurecimiento; el cambio local usa `/etc/systemd/system/nrnplay.service.d/95-local-persistence.conf`.
- Ambos directorios privados son 0700; snapshots y entornos son 0600. Los dos locks de archivo estaban presentes y no quedó un escritor PostgreSQL activo.

El corte final tardó diez segundos. La primera tentativa volvió al backend anterior antes de ejecutar el importador: su cierre por pérdida previa de conexión Neon había dejado la unidad en `failed`, sin proceso. Se corrigió la comprobación para admitir `inactive` o `failed` únicamente con MainPID cero y cgroup vacío. Después se ejecutaron los try-locks de ambos namespaces. No se forzó una migración sobre un escritor activo ni se borraron archivos o locks para reintentar.

## Datos y restauración

La comparación completa entre PostgreSQL y los archivos importados conservó todos los campos: 50 salas, dos ligas, tres cuentas, 15 sesiones y dos suscripciones BMC. La clave de cuentas y el texto original del entorno se conservaron. No se crearon usuarios ni se enviaron correos o pagos de prueba.

El checkpoint inicial y la restauración aislada finalizaron correctamente a las `03:26:21.404Z`. Se comprobó igualdad completa mediante JSON canónico y comparación profunda, no sólo conteos. La restauración escribió en `/var/lib/nrnplay-restore/validation-1iWUi3`, sin tocar los originales. Pico medido: 75.333.632 bytes (71,84 MiB), bajo un límite de 192 MiB y swap máximo de 128 MiB.

La observación de reposo pasó a las `03:35:18Z`, 537 segundos después del último SQL real: health/ready 200, cero sockets PostgreSQL del proceso principal y el mismo PID, arranque y cero reinicios. RSS 73,58 MiB y pico 74,63 MiB, sin eventos OOM. No se consultó SQL para mantener Neon despierto durante esa ventana.

La prueba de la unidad real detectó antes de habilitar el timer que los guards de entrada no reconocían la ruta `current` como el mismo archivo ESM y devolvían cero sin ejecutar el CLI. Se corrigieron ambas CLI en `54494349800c9ac0ca823ad7198f78e8c3435951` y se añadieron pruebas de procesos por ruta directa y junction/symlink. La compilación de 35 archivos runtime de la aplicación es idéntica a e650; sólo difieren las dos CLI. Esto permite instalar la corrección sin reiniciar el escritor principal ni repetir la importación.

La unidad real `nrnplay-checkpoint.service` pasó a las `03:36:43Z`: el CLI invocado por `current` emitió `mode=apply/status=written`, Result=success, ExecMainStatus=0 y ConditionResult=yes. MemoryPeak fue 71.630.848 bytes (68,31 MiB), con los límites de 192 MiB/swap 128 MiB, CPUWeight 10, Nice 10 y OOMScoreAdjust 800. El observador temporal se retiró tras medir; no modifica el job permanente.

La última lectura PostgreSQL terminó y cerró conexión a las `03:36:49.490Z`, con cero locks de escritor. El proceso principal seguía sin sockets PostgreSQL. Después de verificar el recibo se habilitó `nrnplay-checkpoint.timer`: activo/waiting, calendario a los minutos :20 UTC, `Persistent=false` y próxima ejecución `04:20 UTC`. No se ejecutó otra copia manual ni se añadieron consultas para mantener Neon despierto.

El cierre pasivo de las `03:38:51Z` confirmó health/ready 200, cero sockets PostgreSQL, PID principal y RACE sin cambios y prioridades efectivas conservadas. Las otras cuatro aplicaciones no tenían procesos activos y mantienen CPUWeight 10/OOMScoreAdjust 800 para su siguiente arranque. Los puertos públicos siguen siendo 80/443; 3001 y 2019 permanecen en loopback.

## Render Free

El servicio existente `srv-daco4a6k1f9s73d11qmg` sigue en Free, una instancia y sin despliegue automático. Conserva el proxy para clientes antiguos. El worker sólo calcula derivaciones de contraseñas autenticadas; su código no lee cuentas o sesiones ni abre PostgreSQL.

- Rama: `codex/nrn-azure-migration-ops`.
- Fuente: `e67a6e63c8e9223ebd78bce34b443a9bc608eeb0`.
- Despliegue activo: `dep-dbtsbbek1f9s739k86b0`.
- La prueba firmada verificó una derivación sintética idéntica a scrypt local y su firma de respuesta en 3.032 ms. Una petición sin firma devolvió 401.

El acceso normal calcula localmente cuando hay memoria suficiente. Se delega si RACE usa al menos 300 MiB, quedan menos de 256 MiB disponibles, faltan mediciones o el cgroup NRN/algún padre tiene menos de 160 MiB de margen. Sólo hay un trabajo activo y ocho en espera. Render Free puede dormir; el intento remoto dura como máximo cuatro segundos. Si sigue habiendo presión se devuelve reintento, sin iniciar un cálculo local que ponga en riesgo RACE.

Render no es una réplica activa de las partidas ni un reemplazo automático de Azure. La copia externa permite una recuperación supervisada. Su RPO nominal es una hora y aumenta si se aplazan copias por RACE, memoria, red o cuota.

## RACE y comprobaciones

RACE mantuvo PID `636248`, arranque del 13 de noviembre, cero reinicios, CPUWeight 1000, MemoryLow 640 MiB y OOMScoreAdjust −250. NRN conserva CPUWeight 200, Nice 5, MemoryMax 384 MiB, swap 256 MiB y OOMScoreAdjust 500. Las otras aplicaciones mantienen prioridad inferior. No se ejecutó una reserva RACE como prueba.

La compilación y las suites completas de CI pasaron para e650 y para la corrección 5449434. Después del corte pasaron 64 comprobaciones públicas en la API y su proxy: configuración, CORS, rechazos de credenciales inválidas y conexiones WebSocket de los tres juegos. Véase `VALIDATION.md`.

Los recibos de operación están en `.cache/azure-nrn-stage/` y el informe público en `output/nrn-free-availability/public-after-free.json` del workspace de operación. Los snapshots y las claves no se incluyen en Git. Para recuperar desde Neon, seguir `MIGRATION.md`: detener el escritor, importar en destinos vacíos, preservar la clave y comparar todos los datos antes de arrancar.

NRN Plus ya estaba publicado desde `bb279b4a970f85dcdee37a900ab6cf134e6fb8b7`: opciones y acción principal arriba, detalles plegados y sin la dirección de ejemplo. No cambiaron DNS, dominios, Caddy, NSG ni FootballChampion en este corte.
