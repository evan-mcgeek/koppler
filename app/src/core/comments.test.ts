import { expect, test } from 'vitest';
import { inEffect } from './comments.ts';

test('what is commented out is left out, an address after http:// in effect is kept', () => {
  const text = [
    "apiUrl: 'https://api-qa.acme.example/',",
    "// apiUrl: 'http://localhost:5001/',",
    '# API_URL=http://localhost:5002',
    '; url = http://localhost:5003',
    '/* old: http://localhost:5004 */',
    '<!-- <add key="Url" value="http://localhost:5005" /> -->',
    'other: http://localhost:5006',
  ].join('\n');
  const kept = inEffect(text);
  for (const port of ['5001', '5002', '5003', '5004', '5005']) expect(kept).not.toContain(port);
  expect(kept).toContain('https://api-qa.acme.example/');
  expect(kept).toContain('http://localhost:5006');
});
