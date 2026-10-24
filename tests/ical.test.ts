// Esecuzione: node --test "tests/*.test.ts"   (Node 22.18+ / 24, che esegue TypeScript senza compilazione)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, buildIcs } from '../supabase/functions/_shared/ical.ts';

const BOOKING = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Booking.com//Booking.com Calendar//EN',
  'BEGIN:VEVENT',
  'UID:abc123@booking.com',
  'DTSTART;VALUE=DATE:20261105',
  'DTEND;VALUE=DATE:20261108',
  'SUMMARY:CLOSED - Not available',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:def456@booking.com',
  'DTSTART;VALUE=DATE:20261201',
  'DTEND;VALUE=DATE:20261202',
  'SUMMARY:CLOSED - Not available',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('legge gli eventi a giornata intera di Booking', () => {
  assert.deepEqual(parseIcs(BOOKING), [
    { uid: 'abc123@booking.com', start: '2026-11-05', end: '2026-11-08', summary: 'CLOSED - Not available' },
    { uid: 'def456@booking.com', start: '2026-12-01', end: '2026-12-02', summary: 'CLOSED - Not available' },
  ]);
});

test('gestisce righe piegate, orari UTC, parametri e testo con escape (stile Airbnb)', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTAMP:20261020T101010Z',
    'DTSTART:20270110T150000Z',
    'DTEND;TZID=Europe/Rome:20270113T100000',
    'SUMMARY:Reserved\\, conferma',
    'UID:1418fb94e984-0b6f2a7c4d3f5a1b2c3d4e5f60718293@airbnb.c',
    ' om',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n');
  assert.deepEqual(parseIcs(ics), [{
    uid: '1418fb94e984-0b6f2a7c4d3f5a1b2c3d4e5f60718293@airbnb.com',
    start: '2027-01-10', end: '2027-01-13', summary: 'Reserved, conferma',
  }]);
});

test('senza DTEND o UID usa una notte e un UID derivato; ignora gli eventi annullati', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261231', 'SUMMARY:Blocco', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:x', 'STATUS:CANCELLED', 'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261103', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  assert.deepEqual(parseIcs(ics), [
    { uid: '2026-12-31_2027-01-01_Blocco', start: '2026-12-31', end: '2027-01-01', summary: 'Blocco' },
  ]);
});

test('il calendario esportato si rilegge identico e rispetta CRLF e piegatura', () => {
  const events = [
    { uid: 'e1@affittacamere', start: '2026-11-05', end: '2026-11-08', summary: 'Non disponibile' },
    { uid: 'e2@affittacamere', start: '2027-02-28', end: '2027-03-02', summary: 'Testo, con; caratteri\\speciali ' + 'x'.repeat(80) },
  ];
  const ics = buildIcs('Camera Blu', events, new Date('2026-10-24T08:00:00.000Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261105\r\n'));
  assert.ok(ics.includes('DTSTAMP:20261024T080000Z\r\n'));
  for (const line of ics.split('\r\n')) assert.ok(line.length <= 75, `riga troppo lunga: ${line}`);
  assert.deepEqual(parseIcs(ics), events);
});
