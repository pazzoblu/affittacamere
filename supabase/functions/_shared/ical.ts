// Lettura e scrittura minimale di calendari iCalendar (RFC 5545):
// quanto basta per i feed di disponibilità di Booking.com e Airbnb.

export interface IcsEvent {
  uid: string;
  start: string; // YYYY-MM-DD (primo giorno occupato)
  end: string;   // YYYY-MM-DD (giorno di partenza, escluso)
  summary: string;
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "20261105" o "20261105T140000Z" -> "2026-11-05"
function toIsoDate(value: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

export function parseIcs(text: string): IcsEvent[] {
  // le righe lunghe sono "piegate": una riga che inizia con spazio/tab continua la precedente
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: IcsEvent[] = [];
  let cur: Record<string, string> | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur) {
        const start = cur.DTSTART ? toIsoDate(cur.DTSTART) : null;
        if (start) {
          let end = cur.DTEND ? toIsoDate(cur.DTEND) : null;
          if (!end || end <= start) end = addDays(start, 1);
          const summary = unescapeText(cur.SUMMARY ?? '');
          const uid = cur.UID?.trim() || `${start}_${end}_${summary}`;
          if (cur.STATUS?.toUpperCase() !== 'CANCELLED') events.push({ uid, start, end, summary });
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    // "DTSTART;VALUE=DATE:20261105" -> nome "DTSTART", parametri ignorati
    const name = line.slice(0, colon).split(';')[0].toUpperCase();
    if (!(name in cur)) cur[name] = line.slice(colon + 1);
  }
  return events;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// piega le righe oltre i 75 caratteri come richiesto dallo standard
function fold(line: string): string {
  const out: string[] = [];
  while (line.length > 75) { out.push(line.slice(0, 75)); line = ' ' + line.slice(75); }
  out.push(line);
  return out.join('\r\n');
}

export function buildIcs(calName: string, events: IcsEvent[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const d = (iso: string) => iso.replace(/-/g, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AffittaCamere//Disponibilita//IT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calName)}`,
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d(e.start)}`,
      `DTEND;VALUE=DATE:${d(e.end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
