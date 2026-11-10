import { describe, expect, it } from 'vitest';
import { readSchedule, scheduleWords } from './schedule.ts';

describe('readSchedule', () => {
  it('reads rates and crons back in words', () => {
    expect(readSchedule('rate(20 minutes)')).toEqual({ words: 'every 20 min' });
    expect(readSchedule('rate(1 hour)')).toEqual({ words: 'every hour' });
    expect(readSchedule('rate(2 days)')).toEqual({ words: 'every 2 days' });
    expect(readSchedule('cron(0 0 * * ? *)')).toEqual({ words: 'daily 00:00 UTC' });
    expect(readSchedule('cron(5 4 ? * MON-FRI *)')).toEqual({ words: 'weekdays 04:05 UTC' });
    expect(readSchedule('cron(30 6 1 * ? *)')).toEqual({ words: 'monthly on the 1st 06:30 UTC' });
  });

  it('keeps an odd cron as it is, and says why a broken one does not read', () => {
    expect(readSchedule('cron(0/15 * * * ? *)')).toEqual({ words: 'cron(0/15 * * * ? *)' });
    expect(readSchedule('rate(20 minute)')).toEqual({ error: 'Use "minutes" for more than 1' });
    expect(readSchedule('rate(1 hours)')).toEqual({ error: 'Use "hour" for 1' });
    expect(readSchedule('rate(5 weeks)')).toEqual({ error: 'The unit is minute, hour or day' });
    expect(readSchedule('cron(0 0 * * *)')).toHaveProperty('error');
    expect(readSchedule('cron(0 0 * * MON *)')).toEqual({ error: 'One of day and weekday must be ?' });
    expect(readSchedule('every day')).toHaveProperty('error');
    expect(scheduleWords('rate(20 minute)')).toBe('rate(20 minute)');
  });
});
