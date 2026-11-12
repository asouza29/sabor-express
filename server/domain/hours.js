'use strict';

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: days[get('weekday')], minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMin = (s) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

/**
 * O estabelecimento está aberto em `date`? `rows` = [{weekday(0=dom), opens:'HH:MM', closes:'HH:MM'}].
 * Suporta horário que atravessa a meia-noite (ex.: 18:00–02:00).
 */
function isOpenAt(rows, date, timeZone) {
  const { weekday, minutes } = localParts(date, timeZone);
  const byDay = new Map(rows.map((r) => [r.weekday, r]));
  const today = byDay.get(weekday);
  if (today) {
    const o = toMin(today.opens);
    const c = toMin(today.closes);
    if (o < c && minutes >= o && minutes < c) return true;
    if (o > c && minutes >= o) return true;
  }
  const prev = byDay.get((weekday + 6) % 7);
  if (prev) {
    const o = toMin(prev.opens);
    const c = toMin(prev.closes);
    if (o > c && minutes < c) return true;
  }
  return false;
}

module.exports = { isOpenAt, localParts };
