export const CONVERSATION_TABS = ['coach', 'agents']

export function normalizeTab(tab) {
  return tab === 'agents' ? 'agents' : 'coach'
}

export function getTabLabel(tab) {
  return tab === 'agents' ? 'Agent Conversations' : 'Minervini Coach'
}
