import { describe, expect, it } from 'vitest';
import { atRest, breakable, isCode, noteWords, valueWords } from './step-text.ts';

describe('atRest', () => {
  it('shows the summary, else the note up to its first "; " or " (", and opens only when there is more', () => {
    const values = [{ label: 'Route', items: ['POST /orders'] }];
    expect(atRest({ summary: 'Sends the order.', note: 'POST /orders' })).toEqual({
      line: 'Sends the order.',
      opens: true,
    });
    expect(atRest({ summary: 'Sends the order.' })).toEqual({ line: 'Sends the order.', opens: false });
    expect(atRest({ note: 'Replicates Account (CodeId__c) out of the CRM.' })).toEqual({
      line: 'Replicates Account',
      opens: true,
    });
    expect(atRest({ note: 'Applies the code before tax.' })).toEqual({
      line: 'Applies the code before tax.',
      opens: false,
    });
    expect(atRest({ note: 'Applies the code before tax.', values })).toEqual({
      line: 'Applies the code before tax.',
      opens: true,
    });
    expect(atRest({})).toEqual({ opens: false });
    expect(atRest({ values })).toEqual({ opens: true });
  });
});

describe('breakable', () => {
  it('breaks after "." and "/" and before "__"', () => {
    expect(breakable('/OrdersApi/Flags')).toEqual(['/', 'OrdersApi/', 'Flags']);
    expect(breakable('Account.CodeId__c')).toEqual(['Account.', 'CodeId', '__c']);
  });
});

describe('noteWords', () => {
  it('tells code names and dates from prose, keeping the brackets and punctuation prose', () => {
    expect(noteWords('Replicates Account (CodeId__c) out of the CRM, from 2026-11-09; FeatureFlag=true.')).toEqual([
      { text: 'Replicates Account (' },
      { text: 'CodeId__c', code: true },
      { text: ') out of the CRM, from ' },
      { text: '2026-11-09', code: true, date: true },
      { text: '; ' },
      { text: 'FeatureFlag=true', code: true },
      { text: '.' },
    ]);
    expect(['CRM', 'UTC', 'Account'].filter(isCode)).toEqual([]);
  });
});

describe('valueWords', () => {
  it('keeps dates whole', () => {
    expect(valueWords('2026-11-09 to 2026-12-03, UTC')).toEqual([
      { text: '2026-11-09', date: true },
      { text: ' to ' },
      { text: '2026-12-03', date: true },
      { text: ', UTC' },
    ]);
  });
});
