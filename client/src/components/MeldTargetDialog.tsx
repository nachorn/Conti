import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Lang } from '../i18n'
import { replaceAndMoveJokerToStraightEnd, replaceJokerInStraight } from '../lib/meld'
import { assessMeldTarget, orderMeldCardsForDisplay, type MeldFitReason } from '../lib/meldTargeting'
import type { Card as CardType, Meld, Player } from '../types'
import { Card } from './Card'
import './MeldTargetDialog.css'

type SubmitResult = { ok: boolean; error?: string }
type TargetAction = 'add' | 'swap'

export interface MeldTargetDialogProps {
  open: boolean
  lang: Lang
  players: Player[]
  melds: Meld[]
  selectedCards: CardType[]
  playerHasContract: boolean
  outstandingJokerId: string | null
  canReclaimJoker?: (joker: CardType) => boolean
  returnFocusRef?: RefObject<HTMLElement>
  isConnected: boolean
  onClose: () => void
  onAdd: (meldId: string, cards: CardType[]) => Promise<SubmitResult>
  onSwap: (meldId: string, cardId: string, jokerCardId: string) => Promise<SubmitResult>
  onSuccess: (kind: TargetAction, meld: Meld) => void
}

const copy = {
  en: {
    titleAfterContract: 'Add cards to a meld',
    titleBeforeContract: 'Reclaim a Joker for your contract',
    close: 'Close',
    cancel: 'Cancel',
    selectedOne: '1 selected card',
    selectedMany: (count: number) => `${count} selected cards`,
    ownerFilter: 'Filter by player',
    allPlayers: 'All players',
    chooseTarget: 'Choose an exposed meld',
    compatible: 'Compatible',
    incompatible: 'Does not fit',
    addOnly: 'These cards can be added',
    swapOnlyBeforeContract: 'Take this Joker, then play your full contract this turn',
    swapOnlyAfterContract: 'This card replaces the gap; the Joker stays at an open end',
    addOrSwap: 'Add the card or move this straight\'s Joker',
    swapBlocked: 'Play the Joker you already took before replacing another one',
    reclaimBlocked: 'This Joker would not complete your full contract this turn',
    jokerObligation: 'You reclaimed this Joker. Use it in your full contract before discarding.',
    noMelds: 'There are no exposed melds yet.',
    noFilteredMelds: 'This player has no exposed melds.',
    unknownPlayer: 'Unknown player',
    trio: 'Trio',
    straight: 'Straight',
    before: 'Before',
    after: 'After',
    actionLegend: 'Choose what to do',
    addChoice: 'Add to meld',
    swapChoice: 'Replace Joker',
    chooseJoker: 'Choose the exact Joker to replace',
    jokerNumber: (number: number) => `Joker ${number}`,
    receiveJoker: 'You receive the replaced Joker',
    keepJoker: 'The Joker stays in this straight at an open end.',
    chooseMeld: 'Choose a compatible meld to continue.',
    chooseAction: 'Choose Add or Replace Joker to continue.',
    chooseExactJoker: 'Choose which Joker to replace.',
    addOne: 'Add 1 card',
    addMany: (count: number) => `Add ${count} cards`,
    replaceJokerBeforeContract: 'Take Joker',
    replaceJokerAfterContract: 'Add card & move Joker',
    adding: 'Adding…',
    swapping: 'Replacing…',
    offline: 'Reconnect to add these cards.',
    targetChanged: 'That meld changed and must be selected again.',
    submitFailed: 'The cards could not be added. Try again.',
  },
  es: {
    titleAfterContract: 'Añadir cartas a una bajada',
    titleBeforeContract: 'Recuperar un comodín para tu contrato',
    close: 'Cerrar',
    cancel: 'Cancelar',
    selectedOne: '1 carta seleccionada',
    selectedMany: (count: number) => `${count} cartas seleccionadas`,
    ownerFilter: 'Filtrar por jugador',
    allPlayers: 'Todos los jugadores',
    chooseTarget: 'Elige una bajada expuesta',
    compatible: 'Compatible',
    incompatible: 'No encaja',
    addOnly: 'Estas cartas se pueden añadir',
    swapOnlyBeforeContract: 'Recoge este comodín y baja tu contrato completo este turno',
    swapOnlyAfterContract: 'Esta carta ocupa el hueco y el comodín queda en un extremo',
    addOrSwap: 'Añade la carta o mueve el comodín de esta escala',
    swapBlocked: 'Coloca primero el comodín que ya recogiste antes de sustituir otro',
    reclaimBlocked: 'Este comodín no te permite bajar el contrato completo este turno',
    jokerObligation: 'Recogiste este comodín. Úsalo en tu contrato completo antes de descartar.',
    noMelds: 'Todavía no hay bajadas expuestas.',
    noFilteredMelds: 'Este jugador no tiene bajadas expuestas.',
    unknownPlayer: 'Jugador desconocido',
    trio: 'Trío',
    straight: 'Escala',
    before: 'Antes',
    after: 'Después',
    actionLegend: 'Elige qué hacer',
    addChoice: 'Añadir a la bajada',
    swapChoice: 'Sustituir comodín',
    chooseJoker: 'Elige el comodín exacto que quieres sustituir',
    jokerNumber: (number: number) => `Comodín ${number}`,
    receiveJoker: 'Recibes el comodín sustituido',
    keepJoker: 'El comodín permanece en esta escala, en uno de sus extremos.',
    chooseMeld: 'Elige una bajada compatible para continuar.',
    chooseAction: 'Elige Añadir o Sustituir comodín para continuar.',
    chooseExactJoker: 'Elige qué comodín quieres sustituir.',
    addOne: 'Añadir 1 carta',
    addMany: (count: number) => `Añadir ${count} cartas`,
    replaceJokerBeforeContract: 'Recoger comodín',
    replaceJokerAfterContract: 'Añadir carta y mover comodín',
    adding: 'Añadiendo…',
    swapping: 'Sustituyendo…',
    offline: 'Vuelve a conectarte para añadir estas cartas.',
    targetChanged: 'Esa bajada cambió y debes volver a elegirla.',
    submitFailed: 'No se pudieron añadir las cartas. Inténtalo de nuevo.',
  },
} as const

const reasonCopy: Record<Lang, Record<MeldFitReason, string>> = {
  en: {
    fits: 'Fits this meld',
    'no-cards': 'No cards selected',
    'wrong-rank': 'The rank does not match',
    'wrong-suit': 'The suit does not match',
    'duplicate-rank': 'That rank is already in the straight',
    'not-consecutive': 'The straight would not be consecutive',
    'too-many-jokers': 'The meld would contain too many Jokers',
    invalid: 'The resulting meld would not be valid',
  },
  es: {
    fits: 'Encaja en esta bajada',
    'no-cards': 'No hay cartas seleccionadas',
    'wrong-rank': 'El número no coincide',
    'wrong-suit': 'El palo no coincide',
    'duplicate-rank': 'Ese número ya está en la escala',
    'not-consecutive': 'La escala dejaría de ser consecutiva',
    'too-many-jokers': 'La bajada tendría demasiados comodines',
    invalid: 'La bajada resultante no sería válida',
  },
}

const rankLabels: Record<number, string> = {
  0: 'Joker',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
}

const suitLabels: Record<Lang, Record<CardType['suit'], string>> = {
  en: {
    hearts: 'hearts',
    diamonds: 'diamonds',
    clubs: 'clubs',
    spades: 'spades',
    joker: 'Joker',
  },
  es: {
    hearts: 'corazones',
    diamonds: 'diamantes',
    clubs: 'tréboles',
    spades: 'picas',
    joker: 'comodín',
  },
}

function cardLabel(card: CardType, lang: Lang): string {
  if (card.suit === 'joker' || card.rank === 0) return lang === 'es' ? 'Comodín' : 'Joker'
  const rank = rankLabels[card.rank] ?? String(card.rank)
  return lang === 'es'
    ? `${rank} de ${suitLabels.es[card.suit]}`
    : `${rank} of ${suitLabels.en[card.suit]}`
}

interface TargetModel {
  meld: Meld
  ownerName: string
  ownerOrder: number
  ordinal: number
  assessment: ReturnType<typeof assessMeldTarget>
  unavailableSwapReason: 'outstanding' | 'no-destination' | null
  compatible: boolean
}

interface OwnerGroup {
  ownerId: string
  ownerName: string
  ownerOrder: number
  targets: TargetModel[]
  compatibleSection: boolean
}

export function MeldTargetDialog({
  open,
  lang,
  players,
  melds,
  selectedCards,
  playerHasContract,
  outstandingJokerId,
  canReclaimJoker,
  returnFocusRef,
  isConnected,
  onClose,
  onAdd,
  onSwap,
  onSuccess,
}: MeldTargetDialogProps) {
  const text = copy[lang]
  const titleId = useId()
  const summaryId = useId()
  const errorId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const selectedTargetRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const pendingRef = useRef(false)
  const canDismissRef = useRef(true)
  const wasOpenRef = useRef(false)
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [selectedMeldId, setSelectedMeldId] = useState<string | null>(null)
  const [action, setAction] = useState<TargetAction | null>(null)
  const [selectedJokerId, setSelectedJokerId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  onCloseRef.current = onClose
  const canDismiss = !pending || !isConnected
  canDismissRef.current = canDismiss

  const playerById = useMemo(
    () => new Map(players.map((player, index) => [player.id, { player, index }])),
    [players]
  )

  const targets = useMemo<TargetModel[]>(() => {
    const typeCounts = new Map<string, number>()
    return melds.map((meld, index) => {
      const key = `${meld.ownerId}:${meld.type}`
      const ordinal = (typeCounts.get(key) ?? 0) + 1
      typeCounts.set(key, ordinal)
      const owner = playerById.get(meld.ownerId)
      const jokerSwapMode = playerHasContract ? 'relocate' : 'reclaim'
      const structuralAssessment = assessMeldTarget(meld, selectedCards, {
        allowAdd: playerHasContract,
        jokerSwapMode,
      })
      const assessment = assessMeldTarget(meld, selectedCards, {
        allowAdd: playerHasContract,
        jokerSwapMode: outstandingJokerId === null ? jokerSwapMode : false,
        canReclaimJoker,
      })
      const unavailableSwapReason = structuralAssessment.replaceableJokerIds.length === 0
        ? null
        : outstandingJokerId !== null
          ? 'outstanding'
          : !playerHasContract && assessment.replaceableJokerIds.length === 0
            ? 'no-destination'
            : null
      return {
        meld,
        ownerName: owner?.player.name ?? text.unknownPlayer,
        ownerOrder: owner?.index ?? players.length + index,
        ordinal,
        assessment,
        unavailableSwapReason,
        compatible: assessment.canAdd || assessment.replaceableJokerIds.length > 0,
      }
    })
  }, [canReclaimJoker, melds, outstandingJokerId, playerById, playerHasContract, players.length, selectedCards, text.unknownPlayer])

  const ownerOptions = useMemo(() => {
    const seen = new Set<string>()
    return [...targets]
      .sort((a, b) => a.ownerOrder - b.ownerOrder)
      .filter((target) => {
        if (seen.has(target.meld.ownerId)) return false
        seen.add(target.meld.ownerId)
        return true
      })
      .map((target) => ({ id: target.meld.ownerId, name: target.ownerName }))
  }, [targets])

  const groups = useMemo<OwnerGroup[]>(() => {
    const byOwner = new Map<string, OwnerGroup>()
    for (const target of targets) {
      if (ownerFilter !== 'all' && target.meld.ownerId !== ownerFilter) continue
      const existing = byOwner.get(target.meld.ownerId)
      if (existing) {
        existing.targets.push(target)
      } else {
        byOwner.set(target.meld.ownerId, {
          ownerId: target.meld.ownerId,
          ownerName: target.ownerName,
          ownerOrder: target.ownerOrder,
          targets: [target],
          compatibleSection: target.compatible,
        })
      }
    }
    const ownerGroups = [...byOwner.values()].sort((a, b) => a.ownerOrder - b.ownerOrder)
    return [true, false].flatMap((compatibleSection) =>
      ownerGroups.flatMap((group) => {
        const sectionTargets = group.targets
          .filter((target) => target.compatible === compatibleSection)
          .sort((a, b) => a.ordinal - b.ordinal)
        return sectionTargets.length > 0
          ? [{ ...group, targets: sectionTargets, compatibleSection }]
          : []
      })
    )
  }, [ownerFilter, targets])

  const selectedTarget = targets.find((target) => target.meld.id === selectedMeldId) ?? null
  const replaceableJokerIds = selectedTarget?.assessment.replaceableJokerIds ?? []
  const replaceableJokerKey = replaceableJokerIds.join(',')
  const selectedCardsKey = selectedCards.map((card) => card.id).join(',')

  const previewMeld = useMemo<Meld | null>(() => {
    if (!selectedTarget || !action) return null
    if (action === 'add') {
      if (!selectedTarget.assessment.canAdd) return null
      return {
        ...selectedTarget.meld,
        cards: [...selectedTarget.meld.cards, ...selectedCards],
      }
    }
    const replacement = selectedCards[0]
    if (!replacement || !selectedJokerId || !replaceableJokerIds.includes(selectedJokerId)) return null
    if (playerHasContract) {
      const relocatedCards = replaceAndMoveJokerToStraightEnd(
        selectedTarget.meld.cards,
        selectedJokerId,
        replacement
      )
      if (!relocatedCards) return null
      return {
        ...selectedTarget.meld,
        cards: relocatedCards,
      }
    }
    const reclaimed = replaceJokerInStraight(
      selectedTarget.meld.cards,
      selectedJokerId,
      replacement
    )
    if (!reclaimed) return null
    return {
      ...selectedTarget.meld,
      cards: reclaimed.cards,
    }
  }, [action, playerHasContract, replaceableJokerIds, selectedCards, selectedJokerId, selectedTarget])

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setOwnerFilter('all')
      setSelectedMeldId(null)
      setAction(null)
      setSelectedJokerId(null)
      setError(null)
    }
    wasOpenRef.current = open
  }, [open])

  useEffect(() => {
    if (!open || pendingRef.current) return
    setError(null)
    setSelectedMeldId(null)
    setAction(null)
    setSelectedJokerId(null)
  }, [open, selectedCardsKey])

  useEffect(() => {
    if (ownerFilter === 'all' || ownerOptions.some((owner) => owner.id === ownerFilter)) return
    setOwnerFilter('all')
  }, [ownerFilter, ownerOptions])

  useEffect(() => {
    if (!selectedTarget || pendingRef.current) {
      if (selectedMeldId && !selectedTarget) {
        setSelectedMeldId(null)
        setAction(null)
        setSelectedJokerId(null)
        setError(text.targetChanged)
      }
      return
    }

    if (!selectedTarget.compatible) {
      setSelectedMeldId(null)
      setAction(null)
      setSelectedJokerId(null)
      setError(text.targetChanged)
      return
    }

    const { canAdd } = selectedTarget.assessment
    if (action === 'add' && !canAdd) setAction(replaceableJokerIds.length > 0 ? 'swap' : null)
    if (action === 'swap' && replaceableJokerIds.length === 0) setAction(canAdd ? 'add' : null)
    if (selectedJokerId && !replaceableJokerIds.includes(selectedJokerId)) setSelectedJokerId(null)
    if (action === 'swap' && replaceableJokerIds.length === 1 && !selectedJokerId) {
      setSelectedJokerId(replaceableJokerIds[0] ?? null)
    }
  }, [action, replaceableJokerIds, replaceableJokerKey, selectedJokerId, selectedMeldId, selectedTarget, text.targetChanged])

  useEffect(() => {
    if (!open || !selectedMeldId) return
    const frame = window.requestAnimationFrame(() => {
      selectedTargetRef.current?.scrollIntoView({ block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, selectedMeldId])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    const appRoot = document.getElementById('root')
    const wasInert = appRoot?.inert ?? false
    if (appRoot) appRoot.inert = true
    document.body.style.overflow = 'hidden'

    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (canDismissRef.current) {
          event.preventDefault()
          onCloseRef.current()
        }
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )
      const first = focusable?.[0]
      const last = focusable?.[focusable.length - 1]
      if (!first || !last) {
        event.preventDefault()
        dialogRef.current?.focus()
      } else if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault()
        const focusTarget = event.shiftKey ? last : first
        focusTarget.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      if (appRoot) appRoot.inert = wasInert
      document.body.style.overflow = previousOverflow
      const returnTarget = previousFocus?.isConnected
        ? previousFocus
        : returnFocusRef?.current
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true })
    }
  }, [open, returnFocusRef])

  const close = () => {
    if (canDismissRef.current) onClose()
  }

  const chooseTarget = (target: TargetModel) => {
    if (!target.compatible || pendingRef.current) return
    setSelectedMeldId(target.meld.id)
    setError(null)
    setSelectedJokerId(null)
    if (target.assessment.canAdd && target.assessment.replaceableJokerIds.length > 0) {
      setAction(null)
    } else if (target.assessment.canAdd) {
      setAction('add')
    } else {
      setAction('swap')
      if (target.assessment.replaceableJokerIds.length === 1) {
        setSelectedJokerId(target.assessment.replaceableJokerIds[0] ?? null)
      }
    }
  }

  const chooseAction = (nextAction: TargetAction) => {
    if (pendingRef.current) return
    setAction(nextAction)
    setError(null)
    if (nextAction === 'add') {
      setSelectedJokerId(null)
    } else if (replaceableJokerIds.length === 1) {
      setSelectedJokerId(replaceableJokerIds[0] ?? null)
    }
  }

  const submit = async () => {
    if (
      pendingRef.current ||
      !isConnected ||
      !selectedTarget ||
      !previewMeld ||
      !action
    ) return

    pendingRef.current = true
    setPending(true)
    setError(null)

    let result: SubmitResult
    try {
      if (action === 'add') {
        result = await onAdd(selectedTarget.meld.id, selectedCards)
      } else {
        const card = selectedCards[0]
        if (!card || !selectedJokerId) {
          result = { ok: false, error: text.chooseExactJoker }
        } else {
          result = await onSwap(selectedTarget.meld.id, card.id, selectedJokerId)
        }
      }
    } catch (caught) {
      result = {
        ok: false,
        error: caught instanceof Error && caught.message ? caught.message : text.submitFailed,
      }
    }

    pendingRef.current = false
    setPending(false)
    if (!result.ok) {
      setError(result.error || text.submitFailed)
      return
    }

    onSuccess(action, previewMeld)
    onClose()
  }

  if (!open || typeof document === 'undefined') return null

  const selectedCountLabel = selectedCards.length === 1
    ? text.selectedOne
    : text.selectedMany(selectedCards.length)
  const canConfirm = Boolean(isConnected && selectedTarget && previewMeld && action && !pending)
  const confirmLabel = pending
    ? action === 'swap' ? text.swapping : text.adding
    : action === 'swap'
      ? playerHasContract ? text.replaceJokerAfterContract : text.replaceJokerBeforeContract
      : selectedCards.length === 1
        ? text.addOne
        : text.addMany(selectedCards.length)
  const footerHint = !isConnected
    ? text.offline
    : !selectedTarget
      ? text.chooseMeld
      : !action
        ? text.chooseAction
        : action === 'swap' && !selectedJokerId
          ? text.chooseExactJoker
          : null

  return createPortal(
    <div
      className="meld-target-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section
        ref={dialogRef}
        className="meld-target-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        aria-busy={pending}
        tabIndex={-1}
      >
        <header className="meld-target-header">
          <div>
            <h2 id={titleId}>{playerHasContract ? text.titleAfterContract : text.titleBeforeContract}</h2>
            <p id={summaryId}>{selectedCountLabel}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="meld-target-close"
            onClick={close}
            disabled={!canDismiss}
            aria-label={text.close}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="meld-target-body">
          <section className="meld-target-selection" aria-label={selectedCountLabel}>
            <CardStrip cards={selectedCards} lang={lang} />
          </section>

          {outstandingJokerId && (
            <p className="meld-target-obligation" role="status">
              <span aria-hidden="true">★</span>
              {text.jokerObligation}
            </p>
          )}

          <label className="meld-target-owner-filter">
            <span>{text.ownerFilter}</span>
            <select
              value={ownerFilter}
              onChange={(event) => {
                setOwnerFilter(event.target.value)
                setSelectedMeldId(null)
                setAction(null)
                setSelectedJokerId(null)
                setError(null)
              }}
              disabled={pending}
            >
              <option value="all">{text.allPlayers}</option>
              {ownerOptions.map((owner) => (
                <option key={owner.id} value={owner.id}>{owner.name}</option>
              ))}
            </select>
          </label>

          <div className="meld-target-list-heading">
            <h3>{text.chooseTarget}</h3>
          </div>

          {melds.length === 0 ? (
            <p className="meld-target-empty">{text.noMelds}</p>
          ) : groups.length === 0 ? (
            <p className="meld-target-empty">{text.noFilteredMelds}</p>
          ) : (
            <div className="meld-target-groups">
              {groups.map((group, groupIndex) => {
                const headingId = `${titleId}-owner-${groupIndex}`
                return (
                  <section key={`${group.ownerId}-${group.compatibleSection ? 'compatible' : 'incompatible'}`} className="meld-target-owner-group" aria-labelledby={headingId}>
                    <h3 id={headingId}>{group.ownerName}</h3>
                    <div className="meld-target-options">
                      {group.targets.map((target) => {
                        const selected = target.meld.id === selectedMeldId
                        const hasAdd = target.assessment.canAdd
                        const hasSwap = target.assessment.replaceableJokerIds.length > 0
                        const fitText = hasAdd && hasSwap
                          ? text.addOrSwap
                          : hasAdd
                            ? text.addOnly
                            : hasSwap
                              ? playerHasContract ? text.swapOnlyAfterContract : text.swapOnlyBeforeContract
                              : target.unavailableSwapReason === 'outstanding'
                                ? text.swapBlocked
                                : target.unavailableSwapReason === 'no-destination'
                                  ? text.reclaimBlocked
                                : reasonCopy[lang][target.assessment.reason]
                        const typeLabel = target.meld.type === 'trio' ? text.trio : text.straight
                        return (
                          <article
                            key={target.meld.id}
                            ref={selected ? selectedTargetRef : undefined}
                            className={`meld-target-option ${selected ? 'is-selected' : ''} ${target.compatible ? 'is-compatible' : 'is-incompatible'}`}
                          >
                            <button
                              type="button"
                              className="meld-target-option-button"
                              onClick={() => chooseTarget(target)}
                              disabled={!target.compatible || pending}
                              aria-pressed={selected}
                            >
                              <span className="meld-target-option-meta">
                                <strong>{typeLabel} {target.ordinal}</strong>
                                <span className={`meld-target-fit ${target.compatible ? 'fits' : 'does-not-fit'}`}>
                                  {target.compatible ? text.compatible : text.incompatible}
                                </span>
                              </span>
                              <CardStrip cards={orderMeldCardsForDisplay(target.meld)} lang={lang} compact />
                              <span className="meld-target-fit-reason">{fitText}</span>
                            </button>

                            {selected && (
                              <TargetPreview
                                lang={lang}
                                target={target}
                                selectedCards={selectedCards}
                                action={action}
                                selectedJokerId={selectedJokerId}
                                previewMeld={previewMeld}
                                playerHasContract={playerHasContract}
                                pending={pending}
                                onChooseAction={chooseAction}
                                onChooseJoker={(jokerId) => {
                                  setSelectedJokerId(jokerId)
                                  setError(null)
                                }}
                              />
                            )}
                          </article>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
          )}

        </div>

        <footer className="meld-target-footer">
          {error ? (
            <div id={errorId} className="meld-target-footer-message is-error" role="alert" aria-live="assertive">
              {error}
            </div>
          ) : (
            <div className="meld-target-footer-message" aria-live="polite">
              {footerHint}
            </div>
          )}
          <div className="meld-target-footer-actions">
            <button type="button" className="meld-target-cancel" onClick={close} disabled={!canDismiss}>
              {text.cancel}
            </button>
            <button
              type="button"
              className="meld-target-confirm"
              onClick={() => { void submit() }}
              disabled={!canConfirm}
              aria-describedby={error ? errorId : undefined}
            >
              {confirmLabel}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body
  )
}

function TargetPreview({
  lang,
  target,
  selectedCards,
  action,
  selectedJokerId,
  previewMeld,
  playerHasContract,
  pending,
  onChooseAction,
  onChooseJoker,
}: {
  lang: Lang
  target: TargetModel
  selectedCards: CardType[]
  action: TargetAction | null
  selectedJokerId: string | null
  previewMeld: Meld | null
  playerHasContract: boolean
  pending: boolean
  onChooseAction: (action: TargetAction) => void
  onChooseJoker: (jokerId: string) => void
}) {
  const text = copy[lang]
  const canAdd = target.assessment.canAdd
  const jokerIds = target.assessment.replaceableJokerIds
  const showActionChoice = canAdd && jokerIds.length > 0
  const proposedIds = new Set(selectedCards.map((card) => card.id))
  const selectedJoker = target.meld.cards.find((card) => card.id === selectedJokerId)

  return (
    <div className="meld-target-preview">
      {showActionChoice && (
        <fieldset className="meld-target-action-choice" disabled={pending}>
          <legend>{text.actionLegend}</legend>
          <button
            type="button"
            className={action === 'add' ? 'is-active' : ''}
            aria-pressed={action === 'add'}
            onClick={() => onChooseAction('add')}
          >
            {text.addChoice}
          </button>
          <button
            type="button"
            className={action === 'swap' ? 'is-active' : ''}
            aria-pressed={action === 'swap'}
            onClick={() => onChooseAction('swap')}
          >
            {text.swapChoice}
          </button>
        </fieldset>
      )}

      {action === 'swap' && jokerIds.length > 1 && (
        <fieldset className="meld-target-joker-choice" disabled={pending}>
          <legend>{text.chooseJoker}</legend>
          <div className="meld-target-joker-options">
            {jokerIds.map((jokerId) => {
              const card = target.meld.cards.find((candidate) => candidate.id === jokerId)
              if (!card) return null
              const jokerNumber = target.meld.cards
                .filter((candidate) => candidate.suit === 'joker' || candidate.rank === 0)
                .findIndex((candidate) => candidate.id === jokerId) + 1
              return (
                <button
                  key={jokerId}
                  type="button"
                  className={selectedJokerId === jokerId ? 'is-active' : ''}
                  aria-pressed={selectedJokerId === jokerId}
                  aria-label={text.jokerNumber(jokerNumber)}
                  onClick={() => onChooseJoker(jokerId)}
                >
                  <Card card={card} size="small" />
                  <span>{text.jokerNumber(jokerNumber)}</span>
                </button>
              )
            })}
          </div>
        </fieldset>
      )}

      <div className="meld-target-comparison">
        <div>
          <span className="meld-target-preview-label">{text.before}</span>
          <CardStrip cards={orderMeldCardsForDisplay(target.meld)} lang={lang} compact />
        </div>
        <span className="meld-target-preview-arrow" aria-hidden="true">→</span>
        <div>
          <span className="meld-target-preview-label">{text.after}</span>
          {previewMeld ? (
            <CardStrip
              cards={action === 'swap' && playerHasContract
                ? previewMeld.cards
                : orderMeldCardsForDisplay(previewMeld)}
              lang={lang}
              compact
              emphasizedIds={proposedIds}
            />
          ) : (
            <div className="meld-target-preview-placeholder">—</div>
          )}
        </div>
      </div>

      {action === 'swap' && selectedJoker && (
        <div className="meld-target-received-joker">
          <span>{playerHasContract ? text.keepJoker : text.receiveJoker}</span>
          {!playerHasContract && <CardStrip cards={[selectedJoker]} lang={lang} compact />}
        </div>
      )}
    </div>
  )
}

function CardStrip({
  cards,
  lang,
  compact = false,
  emphasizedIds,
}: {
  cards: CardType[]
  lang: Lang
  compact?: boolean
  emphasizedIds?: Set<string>
}) {
  return (
    <div className={`meld-target-card-strip ${compact ? 'is-compact' : ''}`}>
      {cards.map((card) => (
        <div
          key={card.id}
          className={`meld-target-card-item ${emphasizedIds?.has(card.id) ? 'is-proposed' : ''}`}
          role="img"
          aria-label={cardLabel(card, lang)}
        >
          <Card card={card} size="small" />
        </div>
      ))}
    </div>
  )
}
