import { gameHref, gameSubdomainsEnabled } from './platform'

/** Add a game here to give it a place on the NRN Play home page. */
export const gameCatalog = [
  {
    id: 'football', name: 'FootballChampion', href: gameHref('football'), external: true,
    category: { es: 'FÚTBOL · CARRERA', en: 'FOOTBALL · CAREER' },
    description: { es: 'Simulador de carrera de futbolista.', en: 'Football career simulator.' },
    detail: { es: 'Un jugador', en: 'Single player' },
  },
  {
    id: 'conti', name: 'Conti', href: gameHref('conti'), external: gameSubdomainsEnabled,
    category: { es: 'CARTAS', en: 'CARDS' },
    description: { es: 'Juego de cartas de tríos y escalas.', en: 'Card game with sets and runs.' },
    detail: { es: '2–10 jugadores', en: '2–10 players' },
  },
  {
    id: 'pocha', name: 'La Pocha', href: gameHref('pocha'), external: gameSubdomainsEnabled,
    category: { es: 'CARTAS · BAZAS', en: 'CARDS · TRICKS' },
    description: { es: 'Juego de bazas con baraja española.', en: 'Trick-taking game with a Spanish deck.' },
    detail: { es: '2–10 jugadores', en: '2–10 players' },
  },
] as const

export type CatalogGameId = typeof gameCatalog[number]['id']
