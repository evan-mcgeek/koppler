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
