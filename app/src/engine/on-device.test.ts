import { expect, it } from 'vitest';
import { onDevice } from './up.ts';

const app = { platform: 'ios' as const, device: 'iPhone 16', deviceId: 'A1', pid: 7 };
const fast = { every: 1, minutes: 0.001 };

it('is done once the app is on the device, not when what builds it starts', async () => {
  let looks = 0;
  const found = await onDevice(
    async () => (++looks < 3 ? [] : [app]),
    () => true,
    fast,
  );
  expect(found).toEqual({ on: 'device', app });
  expect(looks).toBe(3);
});

it('fails when what builds and installs it ends first', async () => {
  expect(
    await onDevice(
      async () => [],
      () => false,
      fast,
    ),
  ).toEqual({ on: 'died' });
});

it('stops waiting after its time, without calling it failed', async () => {
  expect(
    await onDevice(
      async () => [],
      () => true,
      fast,
    ),
  ).toEqual({ on: 'waited' });
});
