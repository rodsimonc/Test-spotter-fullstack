const US_ZONES: { id: string; name: string }[] = [
  { id: 'America/New_York', name: 'Eastern' },
  { id: 'America/Chicago', name: 'Central' },
  { id: 'America/Denver', name: 'Mountain' },
  { id: 'America/Phoenix', name: 'Mountain, no daylight time' },
  { id: 'America/Los_Angeles', name: 'Pacific' },
  { id: 'America/Anchorage', name: 'Alaska' },
  { id: 'Pacific/Honolulu', name: 'Hawaii' },
]

export interface ZoneOption {
  id: string
  label: string
}

export interface ZoneGroups {
  us: ZoneOption[]
  other: ZoneOption[]
}

function allZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
}

/** US zones first with friendly names, then every other IANA zone the browser knows. */
export function buildZoneGroups(current: string): ZoneGroups {
  const us = US_ZONES.map((z) => ({ id: z.id, label: `${z.name} (${z.id})` }))
  const taken = new Set(us.map((z) => z.id))
  const ids = new Set(allZones())
  ids.add('UTC')
  if (current) ids.add(current)
  const other = [...ids]
    .filter((id) => !taken.has(id))
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, label: id }))
  return { us, other }
}
