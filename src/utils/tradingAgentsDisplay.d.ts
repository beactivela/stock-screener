export type StreamTone = 'muted' | 'info' | 'heartbeat' | 'success' | 'error'

export function formatEventTime(at: string | undefined): string

export function streamEventToRow(ev: Record<string, unknown>): {
  tone: StreamTone
  headline: string
  body: string
  sub?: string
  time: string
}

export function firstDisplaySentence(text: string): string

export function streamEventToThinkingLine(ev: Record<string, unknown>): string

export const DECISION_SECTION_DEFS: readonly { key: string; label: string }[]

export type DecisionSection = { key: string; label: string; text: string }

export function parseTradingAgentsDecision(decision: unknown): {
  rating: string | null
  company: string | null
  tradeDate: string | null
  sections: DecisionSection[]
}

export function ratingVisualToken(rating: string | null): 'buy' | 'sell' | 'hold' | 'neutral'
