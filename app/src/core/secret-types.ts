/** The kinds of stored secret Koppler can test: a database, a cache, or a key it tries at an address. */
export const SECRET_TYPES = ['postgres', 'mysql', 'redis', 'key'] as const;

/** A key is only ever sent over https, or to this Mac. */
export const probeUrlOk = (url: string): boolean => {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' || (protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname));
  } catch {
    return false;
  }
};

/** Where a key is tried, and the header that carries it (a bearer token without one). */
export interface Probe {
  url?: string | undefined;
  header?: string | undefined;
}

/** The arguments of secret-test for one declared secret. */
export const testArgs = (
  store: string,
  name: string,
  secret: { type?: string | undefined; probe?: Probe | undefined },
) => [
  store,
  name,
  ...(secret.type ? ['--type', secret.type] : []),
  ...(secret.type === 'key' && secret.probe?.url ? ['--url', secret.probe.url] : []),
  ...(secret.type === 'key' && secret.probe?.header ? ['--header', secret.probe.header] : []),
];
