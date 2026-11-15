import { gameHref, gameSubdomainsEnabled } from './platform'

/** Add a game here to give it a place on the NRN Play home page. */
export const gameCatalog = [
  {
    id: 'football', name: 'FootballChampion', href: gameHref('football'), external: true,
    category: { es: 'FÚTBOL · CARRERA', en: 'FOOTBALL · CAREER' },
    description: { es: 'Tu futbolista. Tus decisiones. Tu camino a la gloria.', en: 'Your player. Your decisions. Your road to glory.' },
    detail: { es: 'Un jugador', en: 'Single player' },
  },
  {
    id: 'conti', name: 'Conti', href: gameHref('conti'), external: gameSubdomainsEnabled,
    category: { es: 'CARTAS · ESTRATEGIA', en: 'CARDS · STRATEGY' },
    description: { es: 'Tríos, escalas y una buena excusa para reunirnos.', en: 'Sets, runs and a good reason to get together.' },
    detail: { es: '2–10 jugadores', en: '2–10 players' },
  },
  {
    id: 'pocha', name: 'La Pocha', href: gameHref('pocha'), external: gameSubdomainsEnabled,
    category: { es: 'CARTAS · BAZAS', en: 'CARDS · TRICKS' },
    description: { es: 'Apuesta tus bazas. Juega tus cartas. Clava la predicción.', en: 'Call your tricks. Play your cards. Nail your prediction.' },
    detail: { es: 'Con amigos', en: 'With friends' },
  },
] as const

export type CatalogGameId = typeof gameCatalog[number]['id']
