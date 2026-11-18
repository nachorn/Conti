import type { CatalogGameId } from '../lib/gameCatalog'

/** Small, resolution-independent cover illustrations, with no network assets. */
export function GameArtwork({ game }: { game: CatalogGameId }) {
  if (game === 'football') return <svg className="nrn-artwork" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
    <path d="M-20 220 120 35l300 80-140 185Z" fill="#244a3e" />
    <path d="m15 220 113-155 252 66-113 155Z" stroke="#a6c48e" strokeWidth="1.5" />
    <path d="m69 235 113-155m-55 170 113-155m-54 170 113-155" stroke="#2d5845" strokeWidth="38" />
    <path d="m15 220 113-155 252 66-113 155ZM197 83 84 238" stroke="#a6c48e" strokeWidth="1.5" />
    <ellipse cx="197" cy="182" rx="43" ry="29" transform="rotate(-28 197 182)" stroke="#a6c48e" strokeWidth="1.5" />
    <path d="m30 201 36 10 36-49-36-10m260 33-36-10 36-49 36 10" stroke="#a6c48e" strokeWidth="1.5" />
    <ellipse cx="218" cy="208" rx="63" ry="13" fill="#0e3026" opacity=".4" />
    <circle cx="227" cy="135" r="61" fill="#f1f3de" stroke="#cbd6ba" strokeWidth="2" />
    <path d="m221 111 26 10-2 28-29 7-17-24Z" fill="#192f2a" />
    <path d="m221 111-2-35m28 45 32-13m-34 41 23 26m-52-19-12 36m-5-60-31-11" stroke="#192f2a" strokeWidth="2" />
    <path d="m219 76 16 1 13 8-15 8-14-2Zm60 32 8 25-2 14-14-12 1-16Zm-11 67-23 16-14 4 3-19 18-9Zm-64 17-23-17-9-13 20-3 14 15Zm-36-71 4-23 14-12 5 17-10 20Z" fill="#192f2a" />
    <path d="m315 51 3-10 3 10 10 3-10 3-3 10-3-10-10-3Z" fill="#d5f578" />
    <circle cx="85" cy="64" r="4" fill="#d5f578" opacity=".65" />
  </svg>

  if (game === 'conti') return <svg className="nrn-artwork" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
    <circle cx="204" cy="130" r="93" stroke="#b18598" strokeOpacity=".25" />
    <circle cx="204" cy="130" r="115" stroke="#b18598" strokeOpacity=".15" />
    <ellipse cx="205" cy="223" rx="100" ry="11" fill="#5b344f" opacity=".12" />
    <g transform="translate(99 48) rotate(-17 56 83)">
      <rect x="4" y="5" width="108" height="159" rx="11" fill="#603e63" opacity=".15" />
      <rect width="108" height="159" rx="11" fill="#64436a" stroke="#805c85" />
      <rect x="8" y="8" width="92" height="143" rx="6" stroke="#c6a5c2" strokeWidth="1.5" />
      <path d="m54 39 28 40-28 41-28-41Z" stroke="#d7b9cc" strokeWidth="1.5" /><path d="m54 51 20 28-20 29-20-29Z" fill="#d7b9cc" opacity=".3" />
    </g>
    <g transform="translate(177 32) rotate(13 56 83)">
      <rect x="4" y="6" width="108" height="159" rx="11" fill="#603e63" opacity=".14" />
      <rect width="108" height="159" rx="11" fill="#fffaf1" stroke="#e2cdbf" />
      <text x="12" y="28" fill="#9e3e4c" fontSize="23" fontFamily="Georgia, serif">A</text>
      <path d="M16 35c-6-8-13 2 0 10 13-8 6-18 0-10Z" fill="#9e3e4c" />
      <path d="M54 66c-25-30-49 9 0 40 49-31 25-70 0-40Z" fill="#ad4e5d" />
      <g transform="rotate(180 54 79.5)"><text x="12" y="28" fill="#9e3e4c" fontSize="23" fontFamily="Georgia, serif">A</text><path d="M16 35c-6-8-13 2 0 10 13-8 6-18 0-10Z" fill="#9e3e4c" /></g>
    </g>
    <path d="m316 99 3-9 3 9 9 3-9 3-3 9-3-9-9-3Z" fill="#88617d" />
    <circle cx="85" cy="172" r="3.5" fill="#88617d" opacity=".6" />
  </svg>

  if (game !== 'pocha') return <svg className="nrn-artwork" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
    <circle cx="200" cy="125" r="80" fill="#d5f578" />
    <path d="m182 88 55 37-55 37Z" fill="#182c2b" />
  </svg>

  return <svg className="nrn-artwork" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
    <circle cx="202" cy="130" r="101" stroke="#a77d36" strokeOpacity=".18" strokeDasharray="3 6" />
    <ellipse cx="204" cy="224" rx="100" ry="11" fill="#634c26" opacity=".12" />
    <g transform="translate(100 47) rotate(-15 56 83)">
      <rect x="4" y="5" width="108" height="159" rx="11" fill="#634c26" opacity=".1" />
      <rect width="108" height="159" rx="11" fill="#234e58" stroke="#3c666a" />
      <rect x="8" y="8" width="92" height="143" rx="6" stroke="#91b0a0" />
      <path d="m54 36 31 43-31 43-31-43Z" stroke="#91b0a0" /><circle cx="54" cy="79" r="17" stroke="#91b0a0" /><path d="m43 79 11-11 11 11-11 11Z" fill="#91b0a0" />
    </g>
    <g transform="translate(177 32) rotate(13 56 83)">
      <rect x="4" y="6" width="108" height="159" rx="11" fill="#634c26" opacity=".12" />
      <rect width="108" height="159" rx="11" fill="#fffaf0" stroke="#ddcda6" />
      <text x="13" y="29" fill="#234e58" fontSize="23" fontFamily="Georgia, serif">1</text>
      <circle cx="18" cy="43" r="7" fill="#e1ae45" stroke="#b68429" />
      <path d="M31 61h46l-5 27c-2 12-11 19-18 19s-16-7-18-19Z" fill="#d6a03c" stroke="#af7e28" strokeWidth="1.5" />
      <path d="M31 68H21v9c0 12 9 19 17 18m39-27h10v9c0 12-9 19-17 18M54 107v18m-16 6h32l-8-6H46Z" stroke="#af7e28" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M38 67h32M40 77h28" stroke="#f8d67b" strokeWidth="2" />
      <text x="83" y="148" fill="#234e58" fontSize="23" fontFamily="Georgia, serif" transform="rotate(180 89 140)">1</text>
    </g>
    <path d="m321 72 3-9 3 9 9 3-9 3-3 9-3-9-9-3Z" fill="#b98c38" />
    <circle cx="80" cy="161" r="3.5" fill="#b98c38" opacity=".65" />
  </svg>
}
