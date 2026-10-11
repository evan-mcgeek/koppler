import { expect, test } from 'vitest';
import { browserChecks, deviceHost, envFileChange, localAddress } from './addresses.ts';
import { frameworkOf } from './frameworks.ts';

const api = { url: 'http://localhost:57057/' };
const secure = { url: 'https://localhost:7089/' };

test('how a device reaches this machine', () => {
  expect(deviceHost({ platform: 'ios' })).toBe('localhost');
  expect(deviceHost({ platform: 'android' })).toBe('10.0.2.2');
  expect(deviceHost({ platform: 'android', physical: true }, '192.168.0.5')).toBe('192.168.0.5');
  expect(deviceHost({ platform: 'ios', physical: true })).toBeNull();
  expect(deviceHost(null)).toBe('localhost');
});

test('the address a caller uses for a local app', () => {
  expect(localAddress(api, { platform: 'ios' }).url).toBe('http://localhost:57057/');
  expect(localAddress(api, { platform: 'android' }).url).toBe('http://10.0.2.2:57057/');
  expect(localAddress({ url: 'http://localhost:3000' }).url).toBe('http://localhost:3000');
  expect(localAddress({}).error).toMatch(/no url in stack\.json/);
});

test('a phone gets the plain http address over the network, and is told when there is none', () => {
  const phone = { platform: 'ios', physical: true };
  expect(localAddress(api, phone, { lanIp: '192.168.0.5' })).toEqual({
    url: 'http://192.168.0.5:57057/',
    needsLan: true,
    note: undefined,
  });
  const onAndroid = { platform: 'android', physical: true };
  expect(localAddress(secure, onAndroid, { lanIp: '10.1.1.1', httpUrl: 'http://localhost:5089' }).url).toBe(
    'http://10.1.1.1:5089/',
  );
  expect(localAddress(secure, phone, { lanIp: '10.1.1.1' }).note).toMatch(/certificate/);
  expect(localAddress(api, phone).error).toMatch(/network address/);
});

test("the trailing slash follows the caller's own address for the deployed app", () => {
  expect(localAddress({ url: 'https://localhost:56037/' }, null, { like: 'https://cs-qa.acme.dev' }).url).toBe(
    'https://localhost:56037',
  );
  expect(localAddress({ url: 'http://localhost:3000' }, null, { like: 'https://x.acme.dev/' }).url).toBe(
    'http://localhost:3000/',
  );
});

test('a browser front end needs its origin allowed, and no https page calling http', () => {
  const withCors = { name: 'Orders API', url: 'https://localhost:7001', cors: { env: ['Cors__Origins__0'] } };
  expect(browserChecks(withCors, 'http://localhost:5173')).toEqual({
    settings: [{ app: 'callee', env: 'Cors__Origins__0', value: 'http://localhost:5173' }],
    warnings: [],
  });
  const plain = { name: 'Pay', url: 'http://localhost:5000' };
  expect(browserChecks(plain, 'http://localhost:5173').warnings[0]).toMatch(/no recorded CORS setting/);
  expect(browserChecks({ ...plain, cors: { env: 'X' } }, 'https://localhost:3000').warnings[0]).toMatch(
    /https page cannot call an http API/,
  );
  const numbered = { url: 'https://localhost:7001', cors: { env: 'Cors__AllowedOrigins__{n}' } };
  expect(browserChecks(numbered, 'http://localhost:3000', 1).settings[0]?.env).toBe('Cors__AllowedOrigins__1');
  expect(browserChecks(plain, 'not an address')).toEqual({ settings: [], warnings: [] });
});

test('a local env file gets one line per setting', () => {
  expect(envFileChange({ env: ['VITE_API_URL'] }, 'https://localhost:7001')).toEqual({
    file: '.env.local',
    lines: ['VITE_API_URL=https://localhost:7001'],
  });
  expect(envFileChange({ env: 'API', file: '.env.development.local' }, 'x')).toEqual({
    file: '.env.development.local',
    lines: ['API=x'],
  });
});

test('a front-end framework is recognised from package.json', () => {
  expect(frameworkOf({ devDependencies: { vite: '^5' } })?.name).toBe('Vite');
  expect(frameworkOf({ dependencies: { next: '14', react: '18' } })?.name).toBe('Next.js');
  expect(frameworkOf({ dependencies: { express: '4' } })).toBeNull();
  expect(frameworkOf(null)).toBeNull();
});
