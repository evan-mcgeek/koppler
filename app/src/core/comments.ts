/** A file's text without what is commented out: block comments, and lines that are a comment (//, #, ;). */
export const inEffect = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter(line => !/^\s*(\/\/|#|;)/.test(line))
    .join('\n');
