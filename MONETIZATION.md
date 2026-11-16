# Apoyo voluntario y futuras cuentas sin anuncios

## Estado comprobado el 15 de noviembre de 2026

NRN Play usa cuentas activas con contraseña y correo transaccional Resend; Zoho recibe el correo de contacto. Los pagos directos y los anuncios siguen desactivados. Las secciones de Gmail y Stripe del 12 de septiembre son registros de pruebas históricas, no la configuración actual del correo.

La nueva revisión AdSense para `nrnplay.com` está solicitada y pendiente. Esta entrega local mejora la integración, pero no activa publicidad: exige `ADS_CONSENT_READY=true` en servidor, las opciones correspondientes del cliente y una señal válida del CMP externo real. Estos ajustes no instalan un CMP ni conceden aprobación. Ver [configuración y prueba de anuncios](client/ADVERTISING.md).

## Primera fase: Buy Me a Coffee

El apoyo voluntario se tramita en la página de NRN Play: https://buymeacoffee.com/nrnplay. La cuenta existente de Football Champion se ha actualizado para representar a NRN Play y sus juegos.

La portada de Continental y Pocha muestra un botón de apoyo en español e inglés. Abre Buy Me a Coffee en otra pestaña y aclara que la página receptora es NRN Play. No requiere iniciar sesión en Conti, no fija el importe, no integra un widget y no interrumpe las partidas ni las invitaciones.

La aportación es voluntaria y **no concede automáticamente acceso sin anuncios**. La cuenta de Stripe existente se utiliza para este apoyo a través del flujo de Buy Me a Coffee. La preparación del pago directo con Stripe se detalla abajo y permanece separada de las aportaciones. La barra de cuenta permanece oculta mientras las cuentas estén desactivadas y no exista una sesión.

El propietario también ha pedido activar el pago único con Stripe para quitar anuncios, además del apoyo voluntario: **4,99 EUR o 4,99 USD**, con códigos enviados desde su propio Gmail. La implementación descrita a continuación permanece desactivada hasta configurar los dos precios, autorizar Gmail y validar los servicios externos y la compra de prueba. No activar cobros directos ni publicidad obligatoria al publicar los cambios visuales y las invitaciones.

### Publicación conjunta del 12 de septiembre de 2026

La entrega conjunta está publicada en https://conti-six.vercel.app. El commit `b72268ecd605220f1debd37de300823454c984eb` está en `main` y `codex/test-branch` e incluye el apoyo voluntario, las invitaciones, los cambios visuales de Continental y la preparación de cuentas, Gmail, precios EUR/USD y anuncios. Las cuentas, el cobro directo y la publicidad permanecen desactivados.

Vercel completó el despliegue de producción `6413700766`. Render completó `dep-daiqol942hec73fhd9j0` después de limpiar la sobrescritura de Docker Command. Se aprobaron **155 pruebas del servidor y 60 del cliente**, además de ambas compilaciones. La comprobación en producción pasó para ambos juegos, las invitaciones y la reconexión autenticada; las salas propias de prueba se eliminaron. `/health` y `/ready` respondieron correctamente y se recuperaron las once salas guardadas que estaban sin jugadores conectados.

El producto, los dos precios y el webhook de Stripe existen solo en modo de pruebas; sus claves aún no están configuradas en Render. Gmail ya está autorizado con el permiso exclusivo de envío y se han validado la renovación del token y dos códigos reales, uno en español y otro en inglés, enviados al propio propietario. Esta publicación no activó cuentas públicas, compras ni anuncios. Los datos personales y secretos quedan fuera de este documento y de Git.

## Comportamiento preparado

- Los invitados siguen entrando con nombre y código de sala. Solo necesitan cuenta quienes compren, recuperen una compra o usen un acceso de cortesía.
- El acceso usa email verificado con un código de seis cifras de un solo uso, válido durante diez minutos. La sesión dura treinta días. En otro dispositivo se solicita otro código para el mismo email.
- La compra es de **pago único: 4,99 EUR o 4,99 USD**. Se usan dos precios separados de Stripe, activos y de 499 unidades menores. El servidor valida la cantidad y moneda configuradas antes de mostrarlas o crear un pago; no hace conversiones entre ambas.
- El país aproximado aportado por Vercel sugiere EUR para la zona euro y USD en los demás casos. Solo se devuelve la moneda sugerida; esta función no guarda ni devuelve el país. Si la consulta falla se usa la región del navegador como preferencia orientativa. El jugador puede elegir EUR o USD antes de pagar, y su elección se conserva en ese navegador. El idioma de la interfaz sigue siendo independiente.
- **Cualquier jugador conectado** con acceso comprado o concedido elimina los anuncios para toda su mesa. No tiene que ser el anfitrión. Los derechos se comprueban en el servidor, también al iniciar una partida.
- El panel privado `/dashboard` permite conceder acceso por email, permanente o con fecha de caducidad, y retirar la cortesía. Se puede conceder antes del registro. No se envía un email al concederlo. Retirar una cortesía no cancela una compra.
- Con publicidad activada y sin ningún jugador con acceso, el servidor bloquea el inicio y las revanchas hasta que **todos los sitios de la mesa estén conectados y hayan completado su pausa publicitaria**. Las rondas de una partida no vuelven a mostrar anuncios.
- Los anuncios se muestran en paralelo. Al terminar, el anfitrión vuelve a iniciar la partida. Un invitado nuevo tiene su propia pausa pendiente. Reconectar conserva una pausa completada; una reproducción interrumpida se puede volver a intentar.
- La interfaz de cuenta, correo de acceso, gestión de cortesías y aviso de anuncios están en español e inglés.

## Estado histórico del 12 de septiembre de 2026

El propietario ya tiene una cuenta de Stripe y ha elegido Gmail como remitente de los códigos. Se han creado en modo de pruebas el producto, sus dos precios de 4,99 EUR y 4,99 USD y el webhook; sus claves siguen sin configurar en Render. Gmail API está habilitada y el buzón ha autorizado únicamente `gmail.send`. La renovación del token y el envío de códigos ES/EN se han validado realmente en un servicio aislado. La aplicación OAuth sigue en Testing: falta publicar las páginas informativas y completar los requisitos de Google para obtener una autorización duradera. También quedan la configuración de producción de Stripe y Render y la aprobación específica de H5 Games Ads. Las cuentas, el cobro directo y los anuncios permanecen desactivados en producción (`MEMBERSHIP_ENABLED=false`, `ADS_PROVIDER=disabled`). Los juegos gratuitos siguen funcionando.

Las pruebas unitarias usan servicios simulados. Las comprobaciones externas descritas abajo sí enviaron dos códigos al propietario y crearon pagos exclusivamente en el modo de pruebas de Stripe, sin dinero real. No se han mostrado anuncios ni activado las cuentas públicas.

### Comprobación externa de Stripe del 12 de septiembre de 2026

Un servicio de cuentas aislado, con almacenamiento solo en memoria y correo simulado, creó dos sesiones de Checkout usando el código real del servidor y los precios configurados de 499 EUR/USD. Se completó cada pantalla de Stripe Sandbox con su tarjeta ficticia. Ambas compras activaron el acceso mediante eventos firmados recibidos con Stripe CLI. Se verificaron la recuperación de las compras en una nueva instancia y sesión, y la recepción repetida de las mismas confirmaciones sin duplicar accesos.

Se reembolsaron completamente ambos pagos ficticios. Los eventos de Stripe retiraron ambos accesos. El receptor local aceptó seis entregas y rechazó cero: dos pagos, dos repeticiones de confirmación y dos reembolsos. Esta prueba no utilizó el almacenamiento de producción ni dinero real. La clave de pruebas se conserva únicamente en un archivo local ignorado con permisos restringidos. El receptor local se detuvo y el destino de webhook de pruebas registrado para Render se desactivó al terminar. La prueba de disputas sigue cubierta por simulación local, no por una disputa externa real.

El Checkout de la cuenta existente muestra **Football Champion** como comercio y el nombre específico de Continental y Pocha en el producto. Antes de ofrecer ventas, completar la configuración real y la información de compra correspondiente. La autorización para publicar el nombre y contacto del propietario en las páginas informativas está pendiente; esos cambios locales no forman parte de la versión pública actual.

## Activación del servidor

Configurar estas variables **solo en el servidor Render**, nunca como `VITE_`, en URLs ni en Git. El archivo `server/membership.env.example` muestra nombres y marcadores sin secretos ni direcciones personales. Mantener producción desactivada hasta completar la validación externa; habilitar primero el entorno de pruebas.

1. **Cuentas y almacenamiento:** `MEMBERSHIP_ENABLED=true`, `MEMBERSHIP_AUTH_SECRET` aleatorio de al menos 32 caracteres y el `DATABASE_URL` existente. Las cuentas se guardan en `conti_membership_state`, con un bloqueo independiente del de `conti_game_state`. La caducidad de las salas no borra las compras. Sigue siendo necesario mantener un único servidor escritor. Para un volumen persistente se puede usar `MEMBERSHIP_STATE_PATH` en un archivo distinto del de las partidas. En producción no se permite una ruta temporal implícita.
2. **Correo transaccional:** la configuración actual usa Resend desde el dominio verificado NRN Play, según `server/membership.env.example`. Zoho recibe el correo de contacto. Gmail es una alternativa opcional: requiere `MEMBERSHIP_EMAIL_PROVIDER=gmail`, sus credenciales OAuth y una autorización duradera; sus pruebas históricas se describen abajo. No cambiar de proveedor ni renovar secretos al publicar otras mejoras. Solo se envía el código solicitado por el jugador, sin listas de marketing.
3. **Panel del propietario:** reutilizar `ADMIN_DASHBOARD_KEY`. La clave permanece en memoria del navegador mientras el panel está abierto. El email de otro jugador nunca permite reclamar una cortesía sin verificar su buzón.
4. **Precios y pago:** crear en Stripe un producto con **dos precios activos de pago único**, uno de **4,99 EUR** y otro de **4,99 USD**. Configurar sus identificadores en `STRIPE_PRICE_ID_EUR` y `STRIPE_PRICE_ID_USD`, además de `STRIPE_SECRET_KEY` y `PUBLIC_APP_URL=https://nrnplay.com`. El servidor rechaza precios cuyo importe no sea 499 o cuya moneda no coincida. Checkout recibe el identificador del precio elegido y `adaptive_pricing[enabled]=false`, para conservar las cantidades fijas. Se aceptan tarjetas y los monederos compatibles con ese método. Los métodos de confirmación diferida no se ofrecen en esta primera versión. `STRIPE_PRICE_ID` solo mantiene compatibilidad con una instalación anterior cuando los dos identificadores específicos están vacíos; dejarlo vacío en esta configuración.
5. **Confirmación del pago:** registrar en Stripe `https://conti-server.onrender.com/api/membership/stripe-webhook`, con eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded` y `charge.dispute.created`; guardar su secreto en `STRIPE_WEBHOOK_SECRET`. Usar claves, precio y webhook del mismo modo (pruebas o real). La versión REST fijada es `2025-06-30.basil`.
6. **Pruebas de integración externas:** antes de habilitar cobros reales, verificar recepción de códigos ES/EN desde el Gmail autorizado y renovación del acceso, realizar compras de prueba de **4,99 EUR y 4,99 USD**, comprobar la sugerencia por país y el cambio manual de moneda, login en otro dispositivo, confirmación duplicada, reembolso completo y concesión/revocación de cortesía. No considerar `?payment=success` como comprobante de pago: el acceso aparece únicamente tras un evento firmado y validado contra la orden y la cuenta.
7. **Proxy y límites:** se limita el envío por email, dirección de conexión y globalmente; los intentos y contadores se guardan. Por defecto no se confía en cabeceras IP reenviadas. Si Render sitúa el servicio detrás de un proxy, verificar su topología y que no pueda eludirse antes de configurar `MEMBERSHIP_TRUST_PROXY_HOPS` (1–3). Un valor erróneo puede compartir límites entre usuarios o permitir falsificar la IP; no activarlo por suposición.

Un reembolso completo o una disputa retira el derecho procedente de esa compra, incluso si los eventos llegan desordenados. Una disputa resuelta a favor del propietario no restablece automáticamente la compra en esta versión; revisar el caso y usar una cortesía si procede. Los reembolsos parciales conservan el acceso.

### Autorización de Gmail: pruebas completadas, producción pendiente

El envío está implementado mediante Gmail REST por HTTPS. Render Free bloquea las conexiones salientes en los puertos SMTP 25, 465 y 587, por lo que la configuración utiliza la API de Gmail. No requiere la contraseña del buzón ni una contraseña de aplicación. [Limitaciones de Render Free](https://render.com/docs/free).

Gmail API está habilitada y el propietario ha completado la autorización de **solo** `https://www.googleapis.com/auth/gmail.send` con acceso sin conexión (`access_type=offline`). Se ha verificado la renovación del refresh token y Gmail ha aceptado exactamente dos códigos de prueba, ES y EN, destinados al propio propietario. Un servicio aislado verificó ambos códigos, rechazó su reutilización y recuperó la misma cuenta con una nueva sesión. La aceptación por Gmail no equivale por sí sola a comprobar la visualización en la bandeja de entrada. La autorización corresponde al buzón remitente; los jugadores no autorizan acceso a su cuenta de Google. Los secretos están en un archivo local ignorado con permisos restringidos al propietario, pendientes de configurar en Render tras resolver la limitación de Testing. [Guía OAuth para servidores de Google](https://developers.google.com/identity/protocols/oauth2/web-server).

Si la pantalla de consentimiento es de tipo **External** y permanece en **Testing**, Google emite refresh tokens que **caducan a los siete días** para este permiso de Gmail. No usar ese estado como configuración duradera de producción: completar la publicación y los requisitos de Google que correspondan, y validar la autorización resultante. Un token también puede dejar de funcionar si se revoca el permiso o se cambia la contraseña del Gmail. Ante ello se necesita una nueva autorización del propietario; no se envían códigos con credenciales inválidas. [Caducidad de refresh tokens de Google](https://developers.google.com/identity/protocols/oauth2#expiration).

El servidor renueva el token por HTTPS, lo reutiliza hasta un minuto antes de su caducidad y comparte una renovación si llegan varias solicitudes simultáneas. Cada petición tiene un límite de quince segundos. Los mensajes conservan los textos ES/EN y sus acentos; no se registran códigos, tokens ni destinatarios. No se reintenta automáticamente un envío cuyo resultado sea incierto para evitar duplicados. [Formato y envío de mensajes con Gmail API](https://developers.google.com/workspace/gmail/api/guides/sending).

La compatibilidad anterior con Resend se conserva si se selecciona `MEMBERSHIP_EMAIL_PROVIDER=resend` y se configuran `RESEND_API_KEY` y `MEMBERSHIP_EMAIL_FROM`. Una instalación anterior que omita el proveedor y ya tenga ambas variables también sigue funcionando. Seleccionar Gmail nunca provoca un cambio automático a Resend si faltan sus credenciales.

## Activación de anuncios

Solicitar una cuenta aprobada de AdSense y acceso específico a **H5 Games Ads**. La aprobación no está garantizada. La integración utiliza el formato **intersticial** oficial y sus transiciones, no un anuncio recompensado que condicione el acceso normal al juego.

Antes de activar, configurar en AdSense los mensajes de privacidad y consentimiento aplicables a la audiencia (incluidos EEE, Reino Unido y Suiza) mediante su CMP certificado, y las opciones para revisar esas preferencias. Validar en dispositivos reales que los mensajes publicados para el dominio aparecen y transmiten correctamente las elecciones. No activar anuncios mientras falte esta configuración. La integración no incorpora un CMP propio.

Configurar `ADS_PROVIDER=google-h5`, `ADSENSE_PUBLISHER_ID=ca-pub-...` y `ADS_CONSENT_READY=true` solo después de los requisitos anteriores. Un identificador inválido o la falta de esta confirmación mantienen desactivada la pausa. El cliente requiere además su configuración CMP y consentimiento válido antes de cargar el SDK. No activar anuncios automáticos adicionales que interrumpan turnos. Validar el formato con Google para el sitio aprobado antes de habilitarlo a todos los jugadores.

Texto preparado:

- ES: «Antes de empezar se mostrará un breve anuncio. La publicidad ayuda a mantener esta web activa.»
- EN: “A short ad will play before the game starts. Advertising helps keep this website running.”

Se respeta el botón de cerrar o saltar que ofrezca la red. **Completar la pausa no significa haber visto íntegramente un vídeo obligatorio de 30–60 segundos.** Google decide qué anuncio sirve y su duración; también puede servir un intersticial que no sea vídeo. Un cierre permitido por la red cuenta como pausa completada.

Si Google no tiene anuncio disponible, aplica un límite de frecuencia, falla, está bloqueado o no puede servirlo por las elecciones de privacidad, **no se registra una visualización ficticia**: el intento válido de esa plaza y ciclo se consume con estado `skipped`, que permite continuar. Este cambio de disponibilidad sustituye la regla estricta anterior. La pausa de un anuncio servido y una omisión siguen siendo estados distintos. `ADS_PROVIDER=disabled` y un redespliegue permiten desactivar globalmente la publicidad.

Los intentos tienen identificador privado de un solo uso, ligado a sala, jugador y partida, y caducan. Google H5 informa desde el navegador: **no ofrece aquí un comprobante firmado de reproducción**. Esto impide reutilizar intentos ajenos o caducados, pero no demuestra criptográficamente que un navegador manipulado haya visto el anuncio. No presentar el mecanismo como protección antifraude infalible. El servidor mantiene sus propias comprobaciones de cuenta y de preparación; la información local de `adFree` nunca da privilegios.

## Operación y privacidad

- Sesiones y códigos se guardan solo como hashes; los códigos además usan HMAC con el secreto del servidor y una sal aleatoria. Nunca se registran en logs.
- Los emails y compras se guardan en el almacenamiento privado de cuentas; no se publican en las salas ni en las invitaciones.
- El navegador conserva únicamente una credencial aleatoria y su caducidad. La compra permanece en el servidor al borrar los datos del navegador.
- Una pérdida del almacenamiento de cuentas falla de forma cerrada y activa el reinicio del servidor para recuperar el último estado duradero. Hacer copias de seguridad del almacenamiento de cuentas junto con el de partidas.
- Se comprueba la firma Stripe sobre el cuerpo original, la antigüedad, el modo, la orden, la cuenta, el importe y la moneda. Los eventos repetidos no conceden accesos duplicados.
- El almacén de cuentas usa snapshots completos y tiene un límite de 16 MB. Es adecuado para el tamaño actual; si crece significativamente, migrar a tablas normalizadas antes de acercarse al límite.

## Verificación local

Desde `server`: `node node_modules/tsx/dist/cli.mjs --test test/*.test.ts` y `node node_modules/typescript/bin/tsc --noEmit`.

Desde `client`: `node --experimental-strip-types --test test/*.test.ts`, `node node_modules/typescript/bin/tsc --noEmit` y `node node_modules/vite/bin/vite.js build`.

Las pruebas de cuentas inyectan correo y Stripe simulados; los identificadores y los importes de prueba nunca se ofrecen en producción. Las pruebas de anuncios verifican bloqueo en ambos juegos, exención, intentos de otros jugadores, repetición, errores, reconexión, nuevas incorporaciones y revanchas.

Las pruebas de Gmail simulan el intercambio OAuth, la caché y renovación simultánea del token, mensajes MIME ES/EN, cabeceras inválidas, permisos incorrectos, límites de espera y errores sin reintentos. Las pruebas de Stripe comprueban los dos precios fijos, el rechazo de monedas e importes incorrectos y que la confirmación firmada coincida con la moneda elegida. Ninguna de estas pruebas llama a Google o Stripe.

También se revisó la interfaz en escritorio y móvil (390 × 844), en inglés y español: entrada con código, rechazo de código incorrecto, recuperación del acceso en otro navegador con almacenamiento independiente, cierre de sesión, concesión y retirada inmediata de cortesías, y creación de una sala como invitado con anuncios desactivados. Estas comprobaciones usaron un servidor aislado y correo simulado. Las compilaciones del cliente y del servidor terminaron correctamente.

## Referencias

- [Stripe: Checkout y confirmación duradera](https://docs.stripe.com/checkout/fulfillment)
- [Stripe: asociar Checkout a una cuenta](https://docs.stripe.com/api/checkout/sessions/create)
- [Stripe: Adaptive Pricing](https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing)
- [Google: enviar mensajes con Gmail API](https://developers.google.com/workspace/gmail/api/guides/sending)
- [Google: OAuth para aplicaciones de servidor](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google: caducidad de refresh tokens](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Render: limitaciones del plan Free](https://render.com/docs/free)
- [Resend: envío de correo](https://resend.com/docs/api-reference/emails/send-email)
- [Google: solicitar H5 Games Ads](https://support.google.com/adsense/answer/1705831)
- [Google: uso de la API de anuncios](https://developers.google.com/ad-placement/apis)
- [Google: mensajes europeos de privacidad](https://support.google.com/adsense/answer/10961068)

### Google H5 Games Ads application — 2026-09-12

The Conti application was filled and reviewed in Edge; the owner confirmed submitting it. Google's confirmation page displayed "Thanks for your application" and stated that its team would review it and contact the applicant with next steps. No duplicate application was sent. Approval is still pending; this is an application receipt, not permission to serve ads. The production ads provider remains disabled. The private application draft and contact information are kept only in ignored local handoff files.

### AdSense Sites registration and review — 2026-09-12

Conti was also added separately under AdSense Sites as conti-six.vercel.app. Published only client/public/ads.txt with the Google-provided publisher entry, then Google confirmed "Your site is verified". The site review was requested successfully; its status is "Getting ready" and the panel says "Review requested". The H5 application and the site review are separate pending approvals. No advertising JavaScript or provider activation was added. Verification-file release b87369d was pushed atomically to main and codex/test-branch, and Vercel reported a successful deployment; Google's ownership verification confirms the published file was reachable by Google. Render configuration was unchanged.

### Public content fix and new review — 2026-11-04

Published908b296 to main and codex/test-branch: original bilingual Continental/Pocha rules with worked examples, public help/about/contact, useful homepage content and links, prerendered homepage HTML, sitemap and indexing directives for private screens. Existing correct ads.txt is publicly reachable with HTTP200/text/plain and checked during build. No ads were enabled; no ad placement or backend configuration change was needed.

Validation: build and84client tests passed; targeted ad-provider/gate tests passed;11publicHTMLpages/164local links checked;15production URLs returned200 with the expected types; live ads config remains disabled. Independently reviewed rules match the game implementation. Vercel deployment succeeded. After release verification, a new AdSense review was successfully requested in Edge; Google now shows Getting ready / Review requested. This is pending review, not approval. The separate H5 application remains pending. Evidence: review-evidence/conti-public-content-2026-11-04.jpg and review-evidence/conti-adsense-resubmitted-2026-11-04.jpg.
