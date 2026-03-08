function resolveMetricValue(signal, metric) {
  if (!signal || typeof signal !== 'object') return undefined;

  if (metric === 'turtleBreakout20or55') {
    return !!signal.turtleBreakout20 || !!signal.turtleBreakout55;
  }

  return signal[metric];
}

function compareValues(actual, op, expected) {
  if (actual == null) return false;

  if (op === 'eq') return actual === expected;
  if (op === 'gt') return Number(actual) > Number(expected);
  if (op === 'gte') return Number(actual) >= Number(expected);
  if (op === 'lt') return Number(actual) < Number(expected);
  if (op === 'lte') return Number(actual) <= Number(expected);
  return false;
}

export function evaluateCompiledCriteria(signal, compiledCriteria = []) {
  if (!Array.isArray(compiledCriteria) || compiledCriteria.length === 0) return false;

  return compiledCriteria.every((criterion) => {
    if (!criterion || typeof criterion !== 'object') return false;
    const metric = String(criterion.metric || '').trim();
    const op = String(criterion.op || '').trim();
    const expected = criterion.value;
    if (!metric || !op) return false;
    const actual = resolveMetricValue(signal, metric);
    return compareValues(actual, op, expected);
  });
}
