// For tests: a result that is either a value or `{ error }`, read as the value.

/** The result itself when it is not an error; the test fails with the error's text otherwise. */
export function ok<T>(result: T): Exclude<T, { error: string }> {
  const error = (result as { error?: unknown } | null)?.error;
  if (typeof error === 'string') throw new Error(`expected a result, got the error: ${error}`);
  return result as Exclude<T, { error: string }>;
}
