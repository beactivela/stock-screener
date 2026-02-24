export interface AgentThreadMessage {
  id: string
  agentType: string
  agentName: string
  avatar: string
  title: string
  body: string
  depth: number
  replyToId: string | null
}

export interface AgentConversationTranscript {
  rounds?: Array<{
    name?: string
    outputs?: Array<Record<string, unknown>>
    output?: Record<string, unknown>
  }>
}

export function buildAgentThread(
  transcript: AgentConversationTranscript | null | undefined,
): AgentThreadMessage[]
