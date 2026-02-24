export function resolveSignalAgentLabel(signalSetups?: string[]): string

export function formatSignalDate(entryDate?: string | number | null): string

export function formatSignalPL(
  pctChange?: number | null,
): { text: string; tone: 'positive' | 'negative' | 'muted' }
