import { describe, expect, it } from 'vitest';
import { isIdentifier, sentencesOf, summaryProblems, tooLong, wordsIn } from './plain-words.ts';

describe('summaryProblems', () => {
  it('passes one plain sentence', () => {
    expect(summaryProblems('Gets the discount campaign and its variant with the feature flags.')).toEqual([]);
    expect(summaryProblems('Reads the order from the GraphQL API over HTTPS on iOS.')).toEqual([]);
  });

  it('names each rule a summary breaks', () => {
    const long =
      'AccountChangeHandlers.FlagAccountForCodes sets CodeId__c = CODE_PENDING on non-staff accounts; GenerateDiscountCodeBatch fills the code, then the short link batch fills it too for every account in the shop.';
    expect(summaryProblems(long)).toEqual([
      '2 sentences',
      '26 words',
      'code names (AccountChangeHandlers.FlagAccountForCodes, CodeId__c, =)',
    ]);
  });
});

describe('isIdentifier', () => {
  it('tells code names from words', () => {
    const named = ['featureFlags', 'CodeId__c', '/OrdersApi/Flags', 'Account.CodeId', 'GetCustomerById', 'a=b'];
    const plain = ['GraphQL', 'iOS', 'JavaScript', 'CRM', 'UTC', 'read/'];
    expect(named.filter(isIdentifier)).toEqual(named);
    expect(plain.filter(isIdentifier)).toEqual([]);
  });
});

describe('sentences and words', () => {
  it('counts a code span as one word and punctuation as none, and splits where a sentence starts', () => {
    expect(wordsIn('Run `koppler canvas start --no-open` - then reload.')).toBe(4);
    expect(sentencesOf('Stop the run. Then start again.\n--all shows every app. e.g. this stays')).toEqual([
      'Stop the run.',
      'Then start again.',
      '--all shows every app. e.g. this stays',
    ]);
    const long = ['Word', ...Array.from({ length: 25 }, () => 'word')].join(' ');
    expect(tooLong(`Short one. ${long}.`)).toEqual([{ sentence: `${long}.`, words: 26 }]);
  });
});
