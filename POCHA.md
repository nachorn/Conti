# La Pocha

## Configuración

El administrador elige Normal o Subastada. La baraja es de 40 o 48 cartas. Puede ajustar el máximo de cartas y las repeticiones de las rondas de 1 carta y del máximo, entre 1 y el número de jugadores. La pirámide sube y baja de una en una. Si el máximo es 1, se juega un solo bloque de rondas de 1 carta.

El modo Subastada solo activa subastas cuando el reparto consume toda la baraja; las demás rondas se juegan con triunfo por carta levantada. La vista previa muestra cuántas rondas tendrán subasta.

## Reglas implementadas

- Acierto exacto: 5 + 2 por baza ganada, incluido +5 al acertar cero.
- Fallo: −2 por cada baza de diferencia absoluta.
- El último en pedir no puede hacer coincidir la suma con las bazas disponibles.
- Reparto de una carta en una carta, desde la mano hacia la derecha. El primer jugador de la lista comienza como mano y el último como postre. La mano original avanza una posición por ronda.
- Normal: la carta siguiente al reparto fija triunfo. Si no sobran cartas, se muestra la última repartida y permanece en la mano del postre.
- Seguir el palo de salida; si no se tiene, jugar triunfo. Dentro de esa obligación, superar al ganador si es posible. Si no se puede superar, cualquier carta del palo obligatorio es válida. Sin ninguno de esos palos, descarte libre.
- Gana el mayor triunfo; sin triunfos, la mayor carta del palo de salida. El ganador sale en la siguiente baza.
- Cada baza terminada se muestra durante al menos 4 segundos: todas las cartas, ganador, carta ganadora y recuento. El servidor impide anticipar la siguiente jugada o ronda. Después de la pausa, las cartas y el ganador siguen visibles hasta que se juegue la siguiente carta; la última baza también queda disponible en el panel de consulta.
- Orden: as, 3, rey, caballo, sota, 9, 8, 7, 6, 5, 4, 2. La baraja de 40 omite 8 y 9.
- Subasta de una vuelta. La mano abre con una cantidad (puede ser cero); cada jugador posterior supera la mejor oferta o pasa. No se repite turno ni se iguala.
- El ganador fija su predicción, elige triunfo y abre la primera baza. Los demás predicen desde su derecha; el último de ese orden no puede cuadrar el total.
- La siguiente ronda conserva la rotación original.
- Al final gana la mayor puntuación; si empatan, se muestran todos los ganadores.

## Salas y recuperación

Socket.IO valida cada acción en el servidor, confirma después de guardar y envía a cada persona únicamente su mano. Se conserva el código de sala, la identidad y la partida al recargar o reconectar, incluso tras reiniciar el servidor.

Cerrar la pestaña mantiene el sitio. Abandonar explícitamente vuelve a todos los participantes a la sala y reinicia la partida; el botón explica este efecto antes de ejecutarlo. El administrador inicia y avanza rondas. Al terminar puede volver a configurar otra partida.

## Código y verificación

Los tipos y reglas puras viven en shared/pochaTypes.ts y shared/pochaRules.ts. El script de compilación sincroniza ambas fuentes con el servidor, que contiene las fases, el reparto, las acciones y la validación de partidas guardadas.

La interfaz incluye configuración con recorrido, turno, triunfo destacado en el centro del tapete, predicciones, selección y confirmación de carta, cartas legales, última baza, resultados y clasificación. Los controles aparecen antes de los paneles de consulta en pantallas táctiles.

Pruebas:
- npm test: reglas, 28 partidas completas (ambas barajas/modalidades, 2–10 jugadores), restauración tras cada acción y pruebas reales de sockets/reinicio.
- npm run test --prefix client: utilidades del cliente.
- npm run build: compilación de servidor y cliente.

La comprobación visual cubre 320×740, 390×844, 820×1180 y 1440×1000, durante configuración, predicciones, juego, subasta, elección de triunfo y resultados.
