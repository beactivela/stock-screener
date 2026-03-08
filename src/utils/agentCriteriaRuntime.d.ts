export type CompiledCriterion = {
  metric: string
  op: 'eq' | 'gt' | 'gte' | 'lt' | 'lte'
  value: number | boolean | string
}

export function evaluateCompiledCriteria(
  signal: Record<string, unknown>,
  compiledCriteria?: CompiledCriterion[],
): boolean
