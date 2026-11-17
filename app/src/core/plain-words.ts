// Plain words: the writing rules of Simplified Technical English (ASD-STE100) that Koppler holds its text to.

/** The most words a step's summary or an instruction may have. */
export const SUMMARY_WORDS = 20;

/** A word that names code rather than saying something: a path, a field, a setting, a camelCase or joined name. */
export const isIdentifier = (word: string): boolean =>
  /[_={}]|\S\/\S|[a-z]\.[A-Za-z]|^[a-z]+[A-Z][a-z]|[a-z][A-Z][a-z].*[a-z][A-Z][a-z]/.test(word);

/** What a step's summary breaks, in words; empty when it keeps every rule. */
export function summaryProblems(text: string): string[] {
  const said = text.trim();
  const words = said.split(/\s+/).filter(Boolean);
  const sentences = said.replace(/[.!?]+$/, '').split(/[.!?;]+\s+/).length;
  const names = words.filter(isIdentifier);
  return [
    ...(sentences > 1 ? [`${String(sentences)} sentences`] : []),
    ...(words.length > SUMMARY_WORDS ? [`${String(words.length)} words`] : []),
    ...(names.length ? [`code names (${names.slice(0, 3).join(', ')})`] : []),
  ];
}

/** The most words a sentence of Koppler's own text may have. */
export const SENTENCE_WORDS = 25;

/** A sentence's words: an inline code span counts as one, punctuation alone as none. */
export const wordsIn = (sentence: string): number =>
  sentence
    .replace(/`[^`]*`/g, 'x')
    .split(/\s+/)
    .filter(word => /[\p{L}\p{N}]/u.test(word)).length;

/** A text's sentences: each line on its own, split after ".", "!" or "?" where a new sentence starts. */
export const sentencesOf = (text: string): string[] =>
  text
    .split(/\n+|(?<=[.!?])\s+(?=[\p{Lu}"“(*`[-])/u)
    .map(one => one.trim())
    .filter(Boolean);

/** The sentences over the limit, with their word counts. */
export const tooLong = (text: string, most = SENTENCE_WORDS): { sentence: string; words: number }[] =>
  sentencesOf(text)
    .map(sentence => ({ sentence, words: wordsIn(sentence) }))
    .filter(one => one.words > most);
