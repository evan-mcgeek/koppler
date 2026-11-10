// A scheduled job's schedule, as EventBridge writes it (`rate(20 minutes)`, `cron(0 0 * * ? *)`), read back in words.

const UNITS = { minute: 'min', hour: 'hour', day: 'day' } as const;
const DAYS: Record<string, string> = {
  'MON-FRI': 'weekdays',
  'SAT,SUN': 'weekends',
  'SUN,SAT': 'weekends',
  MON: 'Mondays',
  TUE: 'Tuesdays',
  WED: 'Wednesdays',
  THU: 'Thursdays',
  FRI: 'Fridays',
  SAT: 'Saturdays',
  SUN: 'Sundays',
};
const time = (hour: string, minute: string) => `${hour.padStart(2, '0')}:${minute.padStart(2, '0')} UTC`;
const number = (field: string) => /^\d{1,2}$/.test(field);

/** The schedule in words, or why it does not read as one. */
export function readSchedule(expression: string): { words: string } | { error: string } {
  const text = expression.trim();
  const rate = /^rate\((.*)\)$/.exec(text);
  if (rate) {
    const [count = '', unit = '', ...more] = (rate[1] ?? '').trim().split(/\s+/);
    const n = Number(count);
    if (!/^\d+$/.test(count) || n < 1 || more.length) return { error: 'Write it as rate(<number> <unit>)' };
    const one = unit.replace(/s$/, '') as keyof typeof UNITS;
    if (!(one in UNITS)) return { error: 'The unit is minute, hour or day' };
    if (n === 1 && unit.endsWith('s')) return { error: `Use "${one}" for 1` };
    if (n > 1 && !unit.endsWith('s')) return { error: `Use "${one}s" for more than 1` };
    return { words: n === 1 ? `every ${UNITS[one]}` : `every ${String(n)} ${one === 'minute' ? 'min' : `${one}s`}` };
  }
  const cron = /^cron\((.*)\)$/.exec(text);
  if (!cron) return { error: 'Write a rate(...) or cron(...) expression' };
  const fields = (cron[1] ?? '').trim().split(/\s+/);
  if (fields.length !== 6) return { error: 'A cron has six fields: minutes hours day month weekday year' };
  const [minute = '', hour = '', day = '', month = '', weekday = ''] = fields;
  if (day !== '?' && weekday !== '?') return { error: 'One of day and weekday must be ?' };
  if (!number(minute) || !number(hour)) return { words: text };
  const at = time(hour, minute);
  if (month !== '*') return { words: text };
  if (weekday === '?' && day === '*') return { words: `daily ${at}` };
  if (day === '?' && weekday === '*') return { words: `daily ${at}` };
  if (day === '?' && DAYS[weekday]) return { words: `${DAYS[weekday] ?? ''} ${at}` };
  if (weekday === '?' && number(day)) return { words: `monthly on the ${day}${ordinal(Number(day))} ${at}` };
  return { words: text };
}

const ordinal = (n: number) =>
  n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';

/** The schedule in words, or the expression itself when it does not read. */
export const scheduleWords = (expression: string): string => {
  const read = readSchedule(expression);
  return 'words' in read ? read.words : expression;
};
