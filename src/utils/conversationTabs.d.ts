export type ConversationTab = 'coach' | 'agents'

export const CONVERSATION_TABS: ConversationTab[]

export function normalizeTab(tab: string): ConversationTab

export function getTabLabel(tab: string): string
