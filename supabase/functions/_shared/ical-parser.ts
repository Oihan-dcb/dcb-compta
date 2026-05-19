/**
 * Parser iCal minimal — VEVENT only
 * Utilisé par sync-ical-ae et sync-ical-planning
 */

export interface ICalEvent {
  uid:      string | null
  dtstart:  string | null
  dtend:    string | null
  summary:  string | null
  status:   string | null
  location: string | null
}

/**
 * Parse un texte iCal brut et retourne la liste des VEVENT
 */
export function parseIcal(text: string): ICalEvent[] {
  const events: ICalEvent[] = []
  // Unfold lines (RFC 5545 §3.1 — continuation lines start with SPACE or TAB)
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '')
  const lines = unfolded.split('\n')
  let current: Partial<ICalEvent> | null = null

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = { uid: null, dtstart: null, dtend: null, summary: null, status: null, location: null }
    } else if (line === 'END:VEVENT') {
      if (current) events.push(current as ICalEvent)
      current = null
    } else if (current) {
      const col = line.indexOf(':')
      if (col < 0) continue
      // key peut avoir des paramètres: DTSTART;TZID=Europe/Paris:... → strip params
      const rawKey = line.substring(0, col).toLowerCase().replace(/;[^:]+$/, '')
      const val = line.substring(col + 1)
      if      (rawKey === 'uid')      current.uid      = val
      else if (rawKey === 'dtstart')  current.dtstart  = val
      else if (rawKey === 'dtend')    current.dtend    = val
      else if (rawKey === 'summary')  current.summary  = val
      else if (rawKey === 'status')   current.status   = val
      else if (rawKey === 'location') current.location = val
    }
  }
  return events
}

/**
 * Parse une date iCal en objet Date (jour uniquement, ignorant heure/timezone)
 * Formats: 20260315 ou 20260315T143000Z ou 20260315T143000
 */
export function parseIcalDate(s: string | null): Date | null {
  if (!s) return null
  const clean = s.replace(/T.*$/, '').replace(/[^0-9]/g, '')
  if (clean.length !== 8) return null
  return new Date(
    parseInt(clean.substring(0, 4)),
    parseInt(clean.substring(4, 6)) - 1,
    parseInt(clean.substring(6, 8))
  )
}

/**
 * Deviner la source depuis le summary ou l'URL iCal
 * ex: "Réservation Airbnb" → 'airbnb', "Booking.com" → 'booking'
 */
export function detecterSource(summary: string | null, icalUrl: string): string {
  const s = (summary || '').toLowerCase()
  const u = icalUrl.toLowerCase()
  if (u.includes('airbnb') || s.includes('airbnb')) return 'airbnb'
  if (u.includes('booking') || s.includes('booking')) return 'booking'
  if (u.includes('abritel') || s.includes('abritel') || s.includes('vrbo')) return 'abritel'
  if (s.includes('blocked') || s.includes('bloqué') || s.includes('unavailable')) return 'blocked'
  return 'direct'
}
