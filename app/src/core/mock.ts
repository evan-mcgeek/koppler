// A card set to Mock: the app's canned responses from the stack, answered in place of the app.

export interface MockResponse {
  method?: string | undefined;
  path: string;
  status?: number | undefined;
  body?: unknown;
  headers?: Record<string, string> | undefined;
}
export interface Answer {
  status: number;
  headers: Record<string, string>;
  body: string;
}

// A web app calls it from the browser, on another port.
const CORS = { 'access-control-allow-origin': '*' };
const matches = (response: MockResponse, method: string, path: string) =>
  (!response.method || response.method.toUpperCase() === method) &&
  (response.path.endsWith('*') ? path.startsWith(response.path.slice(0, -1)) : response.path === path);

/** The first response for this method and path; a 404 that lists the ones there are when none fits. */
export function answerFor(responses: MockResponse[], method: string, path: string): Answer {
  if (method === 'OPTIONS')
    return {
      status: 204,
      headers: { ...CORS, 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' },
      body: '',
    };
  const json = { ...CORS, 'content-type': 'application/json' };
  const hit = responses.find(response => matches(response, method, path));
  if (!hit) {
    const known = responses.map(response => `${response.method?.toUpperCase() ?? 'ANY'} ${response.path}`);
    return { status: 404, headers: json, body: JSON.stringify({ error: `no mock for ${method} ${path}`, known }) };
  }
  const text = typeof hit.body === 'string';
  return {
    status: hit.status ?? 200,
    headers: { ...(text ? { ...CORS, 'content-type': 'text/plain; charset=utf-8' } : json), ...hit.headers },
    body: hit.body === undefined ? '' : typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body),
  };
}
