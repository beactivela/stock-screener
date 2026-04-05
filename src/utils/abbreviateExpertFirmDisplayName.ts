/**
 * Shorten common institutional name fragments for dense UI (e.g. consensus chips).
 */
export function abbreviateExpertFirmDisplayName(name: string): string {
  if (!name) return name
  let s = name
  // "Family Office" → "Family" (phrase before standalone "Management" → "Mgt")
  s = s.replace(/\bFamily Office\b/gi, 'Family')
  s = s.replace(/\bManagement\b/gi, 'Mgt')
  return s
}
