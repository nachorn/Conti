# Comprobación local

- Ambos scripts pasan comprobación de sintaxis POSIX con Bash, sin ejecutar sus lecturas de producción.
- Diez pruebas numéricas de `pressure-guard.sh --check-values`: por debajo/igual/encima de 300 MiB; memoria disponible igual/debajo de 256 MiB; estado holgado; valores inválidos, negativos, vacíos, excesivos y con separadores. Todas pasan; las condiciones inseguras devuelven 1 para omitir el job antes de Node.
- Las pruebas no abren PostgreSQL, no leen snapshots ni secretos y no crean un proceso Node en la VM. El harness local de prueba sólo procesa números públicos.
- `git diff --check` sin errores. Los scripts/unidades usan LF mediante atributos locales.
- Sólo se realizó una lectura de espacio `df` en la VM: 17.918.369.792 bytes disponibles, 45% ocupado. No se instalaron archivos/unidades, cambiaron permisos, habilitaron timers o reiniciaron servicios.
- La validación systemd real, compilación del candidato integrado, checkpoint manual y restauración aislada siguen siendo condiciones de aplicación. No se han ejecutado aquí CLI de migración/copia ni SQL de producción.
- El backup es best effort con RPO nominal de una hora; se amplía cuando se omiten ejecuciones o falla el destino. No existe promesa de un Render Free siempre caliente ni copia histórica ilimitada.
