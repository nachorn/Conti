export type ManualPlusAction = 'gift_granted' | 'gift_revoked' | 'subscription_revoked' | 'giveaway_imported'
export type ManualPlusReason = 'refund' | 'dispute' | 'provider_correction' | 'provider_delivery_recovery'

export interface PlusAccessState {
  active: boolean
  expiresAt: number | null
}

export interface ManualPlusAudit {
  id: string
  at: number
  action: ManualPlusAction
  actorEmail: string | null
  email: string
  subscriptionId: string | null
  reason: ManualPlusReason | null
  before: PlusAccessState | null
  after: PlusAccessState
}
