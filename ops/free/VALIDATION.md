# Comprobación

- CI del backend y la corrección CLI `54494349800c9ac0ca823ad7198f78e8c3435951` correcta: suites completas de servidor y cliente, compilaciones y auditorías de dependencias. [Ejecución](https://github.com/nachorn/Conti/actions/runs/44011095244).
- La regresión de PostgreSQL comprueba que el importador obtiene los locks antes del único SELECT de ambos namespaces y observa un commit previo, sin fijar un snapshot antiguo desde el SELECT de locks.
- Cuatro pruebas de procesos comprueban que ambas CLI se ejecutan por ruta directa y junction/symlink, rechazan argumentos desconocidos y permanecen inertes al importarse. No reciben entorno de cuentas/base de datos.
- Las pruebas de presión cubren RACE, memoria global, margen propio de 160 MiB, límites de todos los ancestros no-root, datos inválidos y caché. La prueba real en Linux permitió el cálculo con 384 MiB y lo delegó con 128 MiB.
- Ambos scripts pasan comprobación de sintaxis POSIX. Diez pruebas numéricas de `pressure-guard.sh --check-values` verifican los bordes de 300 MiB para RACE y 256 MiB disponibles, además de entradas inválidas. Una condición insegura omite Node antes de importar la aplicación.
- El worker Render pasó sus 12 pruebas locales de proxy e integración. La prueba firmada en producción verificó el resultado de scrypt y la firma de respuesta sin crear una cuenta ni enviar correo; las solicitudes sin firma reciben 401.
- Después del corte pasaron 64 comprobaciones públicas sobre Azure y el proxy Render: disponibilidad, configuración conservada, ocho orígenes autorizados, rechazos de autorización inválida y WebSocket de los tres juegos. No se crearon usuarios, sesiones, salas ni eventos de pago.
- La copia inicial y su restauración aislada conservaron todos los campos, incluidas las credenciales y suscripciones. El proceso real de restauración alcanzó 71,84 MiB bajo un límite de 192 MiB.
- Consultar `APPLIED.md` para la unidad de copia real, el timer y la observación posterior. El RPO nominal es una hora; puede aumentar tras omisiones o fallos. Render Free puede requerir despertarse.
