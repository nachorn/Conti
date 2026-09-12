# Apoyo voluntario y futuras cuentas sin anuncios

## Primera fase: Buy Me a Coffee

El propietario ha elegido empezar con apoyo voluntario usando su enlace existente de Football Champion: https://buymeacoffee.com/footballchampion. Se verificó el destino desde la portada pública de https://footballchampion.net el 12 de septiembre de 2026.

La portada de Continental y Pocha muestra un botón de apoyo en español e inglés. Abre Buy Me a Coffee en otra pestaña y aclara que la página receptora es Football Champion. No requiere iniciar sesión en Conti, no fija el importe, no integra un widget y no interrumpe las partidas ni las invitaciones.

La aportación es voluntaria y **no concede automáticamente acceso sin anuncios**. La cuenta de Stripe existente se utiliza para este apoyo a través del flujo de Buy Me a Coffee. La preparación del pago directo con Stripe se detalla abajo y permanece separada de las aportaciones. La barra de cuenta permanece oculta mientras las cuentas estén desactivadas y no exista una sesión.

El propietario también ha pedido activar el pago único con Stripe para quitar anuncios, además del apoyo voluntario: **4,99 EUR o 4,99 USD**, con códigos enviados desde su propio Gmail. La implementación descrita a continuación permanece desactivada hasta configurar los dos precios, autorizar Gmail y validar los servicios externos y la compra de prueba. No activar cobros directos ni publicidad obligatoria al publicar los cambios visuales y las invitaciones.

### Publicado el 12 de septiembre de 2026

El botón de apoyo está publicado y verificado en https://conti-six.vercel.app, en español e inglés. Commit `780aea00c361619c7142a6174caf61d064955ace`, enviado a `main` y `codex/test-branch`. La entrega incluye únicamente `Lobby.tsx`, `SupportProject.tsx` y `SupportProject.css`, sobre la versión anterior `c81f40b`. Compilación aislada y revisión en móvil correctas; destino, nueva pestaña y textos comprobados en la web pública. El servidor de partidas no se redesplegó. Las cuentas, anuncios, invitaciones y cambios visuales pendientes siguen fuera de esta publicación.

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

## Estado actual: integración desactivada

El propietario ya tiene una cuenta de Stripe y ha elegido Gmail como remitente de los códigos. Se han creado en modo de pruebas el producto y sus dos precios de 4,99 EUR y 4,99 USD. Gmail API está habilitada en el proyecto de Google preparado para esta integración. La autorización OAuth del buzón, la configuración del servidor y la validación completa de pagos y correo, además de la aprobación específica de H5 Games Ads, siguen pendientes. No se han validado credenciales de Google con las pruebas locales. Las cuentas y anuncios permanecen desactivados por defecto (`MEMBERSHIP_ENABLED=false`, `ADS_PROVIDER=disabled`). La interfaz no ofrece un cobro directo utilizable ni simula una compra o un anuncio mientras falten estos servicios. Los juegos gratuitos siguen funcionando.

La implementación local y las pruebas no crean cuentas externas, no envían correos reales, no cobran, no muestran anuncios reales y no activan producción.

## Activación del servidor

Configurar estas variables **solo en el servidor Render**, nunca como `VITE_`, en URLs ni en Git. El archivo `server/membership.env.example` muestra nombres y marcadores sin secretos ni direcciones personales. Mantener producción desactivada hasta completar la validación externa; habilitar primero el entorno de pruebas.

1. **Cuentas y almacenamiento:** `MEMBERSHIP_ENABLED=true`, `MEMBERSHIP_AUTH_SECRET` aleatorio de al menos 32 caracteres y el `DATABASE_URL` existente. Las cuentas se guardan en `conti_membership_state`, con un bloqueo independiente del de `conti_game_state`. La caducidad de las salas no borra las compras. Sigue siendo necesario mantener un único servidor escritor. Para un volumen persistente se puede usar `MEMBERSHIP_STATE_PATH` en un archivo distinto del de las partidas. En producción no se permite una ruta temporal implícita.
2. **Correo desde Gmail:** configurar `MEMBERSHIP_EMAIL_PROVIDER=gmail`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` y `GMAIL_SENDER`, siguiendo la autorización pendiente descrita abajo. El remitente debe ser la misma cuenta que autoriza el envío, escrita como dirección simple, por ejemplo `sender@example.com`. Si falta una variable o el remitente no es válido, no se habilita el envío de códigos. El flujo envía únicamente el código solicitado por el jugador; no añade listas de marketing.
3. **Panel del propietario:** reutilizar `ADMIN_DASHBOARD_KEY`. La clave permanece en memoria del navegador mientras el panel está abierto. El email de otro jugador nunca permite reclamar una cortesía sin verificar su buzón.
4. **Precios y pago:** crear en Stripe un producto con **dos precios activos de pago único**, uno de **4,99 EUR** y otro de **4,99 USD**. Configurar sus identificadores en `STRIPE_PRICE_ID_EUR` y `STRIPE_PRICE_ID_USD`, además de `STRIPE_SECRET_KEY` y `PUBLIC_APP_URL=https://conti-six.vercel.app`. El servidor rechaza precios cuyo importe no sea 499 o cuya moneda no coincida. Checkout recibe el identificador del precio elegido y `adaptive_pricing[enabled]=false`, para conservar las cantidades fijas. Se aceptan tarjetas y los monederos compatibles con ese método. Los métodos de confirmación diferida no se ofrecen en esta primera versión. `STRIPE_PRICE_ID` solo mantiene compatibilidad con una instalación anterior cuando los dos identificadores específicos están vacíos; dejarlo vacío en esta configuración.
5. **Confirmación del pago:** registrar en Stripe `https://conti-server.onrender.com/api/membership/stripe-webhook`, con eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded` y `charge.dispute.created`; guardar su secreto en `STRIPE_WEBHOOK_SECRET`. Usar claves, precio y webhook del mismo modo (pruebas o real). La versión REST fijada es `2025-06-30.basil`.
6. **Pruebas de integración externas:** antes de habilitar cobros reales, verificar recepción de códigos ES/EN desde el Gmail autorizado y renovación del acceso, realizar compras de prueba de **4,99 EUR y 4,99 USD**, comprobar la sugerencia por país y el cambio manual de moneda, login en otro dispositivo, confirmación duplicada, reembolso completo y concesión/revocación de cortesía. No considerar `?payment=success` como comprobante de pago: el acceso aparece únicamente tras un evento firmado y validado contra la orden y la cuenta.
7. **Proxy y límites:** se limita el envío por email, dirección de conexión y globalmente; los intentos y contadores se guardan. Por defecto no se confía en cabeceras IP reenviadas. Si Render sitúa el servicio detrás de un proxy, verificar su topología y que no pueda eludirse antes de configurar `MEMBERSHIP_TRUST_PROXY_HOPS` (1–3). Un valor erróneo puede compartir límites entre usuarios o permitir falsificar la IP; no activarlo por suposición.

Un reembolso completo o una disputa retira el derecho procedente de esa compra, incluso si los eventos llegan desordenados. Una disputa resuelta a favor del propietario no restablece automáticamente la compra en esta versión; revisar el caso y usar una cortesía si procede. Los reembolsos parciales conservan el acceso.

### Autorización pendiente de Gmail

El envío está implementado mediante Gmail REST por HTTPS. Render Free bloquea las conexiones salientes en los puertos SMTP 25, 465 y 587, por lo que la configuración utiliza la API de Gmail. No requiere la contraseña del buzón ni una contraseña de aplicación. [Limitaciones de Render Free](https://render.com/docs/free).

Con Gmail API ya habilitada, queda configurar el consentimiento y un cliente OAuth propio, y autorizar **solo** `https://www.googleapis.com/auth/gmail.send` con acceso sin conexión (`access_type=offline`) para obtener un refresh token. La autorización corresponde al buzón remitente; los jugadores solo verifican su email mediante el código y no autorizan acceso a su cuenta de Google. Seguir la [guía OAuth para servidores de Google](https://developers.google.com/identity/protocols/oauth2/web-server) y guardar el identificador, secreto y refresh token únicamente en las variables privadas del servidor. Esta autorización y su validación real siguen pendientes.

Si la pantalla de consentimiento es de tipo **External** y permanece en **Testing**, Google emite refresh tokens que **caducan a los siete días** para este permiso de Gmail. No usar ese estado como configuración duradera de producción: completar la publicación y los requisitos de Google que correspondan, y validar la autorización resultante. Un token también puede dejar de funcionar si se revoca el permiso o se cambia la contraseña del Gmail. Ante ello se necesita una nueva autorización del propietario; no se envían códigos con credenciales inválidas. [Caducidad de refresh tokens de Google](https://developers.google.com/identity/protocols/oauth2#expiration).

El servidor renueva el token por HTTPS, lo reutiliza hasta un minuto antes de su caducidad y comparte una renovación si llegan varias solicitudes simultáneas. Cada petición tiene un límite de quince segundos. Los mensajes conservan los textos ES/EN y sus acentos; no se registran códigos, tokens ni destinatarios. No se reintenta automáticamente un envío cuyo resultado sea incierto para evitar duplicados. [Formato y envío de mensajes con Gmail API](https://developers.google.com/workspace/gmail/api/guides/sending).

La compatibilidad anterior con Resend se conserva si se selecciona `MEMBERSHIP_EMAIL_PROVIDER=resend` y se configuran `RESEND_API_KEY` y `MEMBERSHIP_EMAIL_FROM`. Una instalación anterior que omita el proveedor y ya tenga ambas variables también sigue funcionando. Seleccionar Gmail nunca provoca un cambio automático a Resend si faltan sus credenciales.

## Activación de anuncios

Solicitar una cuenta aprobada de AdSense y acceso específico a **H5 Games Ads**. La aprobación no está garantizada. La integración utiliza el formato **intersticial** oficial y sus transiciones, no un anuncio recompensado que condicione el acceso normal al juego.

Antes de activar, configurar en AdSense los mensajes de privacidad y consentimiento aplicables a la audiencia (incluidos EEE, Reino Unido y Suiza) mediante su CMP certificado, y las opciones para revisar esas preferencias. Validar en dispositivos reales que los mensajes publicados para el dominio aparecen y transmiten correctamente las elecciones. No activar anuncios mientras falte esta configuración. La integración no incorpora un CMP propio.

Configurar `ADS_PROVIDER=google-h5` y `ADSENSE_PUBLISHER_ID=ca-pub-...`. La ausencia de un identificador válido desactiva la publicidad. No activar anuncios automáticos adicionales que interrumpan turnos. Validar el formato con Google para el sitio aprobado antes de habilitarlo a todos los jugadores.

Texto preparado:

- ES: «Antes de empezar se mostrará un breve anuncio. La publicidad ayuda a mantener esta web activa.»
- EN: “A short ad will play before the game starts. Advertising helps keep this website running.”

Se respeta el botón de cerrar o saltar que ofrezca la red. **Completar la pausa no significa haber visto íntegramente un vídeo obligatorio de 30–60 segundos.** Google decide qué anuncio sirve y su duración; también puede servir un intersticial que no sea vídeo. Un cierre permitido por la red cuenta como pausa completada.

Si Google no tiene anuncio disponible, aplica un límite de frecuencia, falla, está bloqueado o no puede servirlo por las elecciones de privacidad, **no se registra una visualización ficticia**: esa persona queda pendiente y se ofrece reintentar. Por tanto, con la regla estricta solicitada, la mesa no podrá empezar hasta completar las pausas o contar con un miembro con acceso sin anuncios. Valorar este comportamiento durante la prueba antes de activar para todo el público. `ADS_PROVIDER=disabled` y un redespliegue permiten desactivar globalmente la publicidad.

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
