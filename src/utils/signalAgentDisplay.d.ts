export function resolveSignalAgentLabel(signalSetups?: string[], preferredAgentId?: string | null): string

export function formatSignalDate(entryDate?: string | number | null): string

export function formatSignalPL(
  pctChange?: number | null,
): { text: string; tone: 'positive' | 'negative' | 'muted' }

export const SIGNAL_AGENT_CRITERIA: Record<
  string,
  { label: string; criteria: string[] }
>
