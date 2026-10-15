// The simulators, emulators and phones a mobile app can run on, and this machine's address on its network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fail } from '../failure.ts';
import type { App } from '../core/stack.ts';
import { sh } from './processes.ts';

export interface RunDevice {
  id: string;
  name: string;
  platform: 'ios' | 'android';
  /** A real phone, as opposed to a simulator or emulator. */
  physical: boolean;
}

function simulators(): RunDevice[] {
  try {
    const listed = JSON.parse(sh('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'])) as {
      devices: Record<string, { udid: string; name: string }[]>;
    };
    return Object.values(listed.devices)
      .flat()
      .map(device => ({ id: device.udid, name: device.name, platform: 'ios', physical: false }));
  } catch {
    return [];
  }
}

function androids(): RunDevice[] {
  const lines = sh('adb', ['devices', '-l']).split('\n').slice(1);
  return lines
    .filter(line => /\sdevice\b/.test(line))
    .map(line => {
      const id = line.split(/\s+/)[0] ?? '';
      const model = /model:(\S+)/.exec(line)?.[1]?.replace(/_/g, ' ');
      return { id, name: model ?? id, platform: 'android', physical: !id.startsWith('emulator-') };
    });
}

interface ConnectedDevice {
  identifier?: string;
  connectionProperties?: { tunnelState?: string; pairingState?: string; transportType?: string };
  hardwareProperties?: { udid?: string };
  deviceProperties?: { name?: string };
}
function phones(): RunDevice[] {
  const out = path.join(os.tmpdir(), `koppler-devices-${String(process.pid)}.json`);
  try {
    sh('xcrun', ['devicectl', 'list', 'devices', '--json-output', out]);
    const listed = JSON.parse(fs.readFileSync(out, 'utf8')) as { result?: { devices?: ConnectedDevice[] } };
    const reachable = ({ connectionProperties: c }: ConnectedDevice) =>
      c?.tunnelState === 'connected' || (c?.pairingState === 'paired' && !!c.transportType);
    return (listed.result?.devices ?? []).filter(reachable).map(device => ({
      id: device.hardwareProperties?.udid ?? device.identifier ?? '',
      name: device.deviceProperties?.name ?? 'iPhone',
      platform: 'ios',
      physical: true,
    }));
  } catch {
    return [];
  } finally {
    fs.rmSync(out, { force: true });
  }
}

/** Everything a mobile app could be run on right now. */
export const devices = (): RunDevice[] => [...simulators(), ...androids(), ...phones()];

const NONE: Record<string, string> = {
  ios: 'no booted iOS simulator: open -a Simulator, then try again',
  android: 'no Android emulator running (adb devices)',
  phone: 'no phone connected: plug it in (or pair it over Wi-Fi) and unlock it',
};
/**
 * The device to run a mobile app on: `ios` (a simulator), `android` (an emulator), `phone` (a connected phone), or a
 * device's id or name. With nothing asked for, a simulator or emulator that is already up.
 */
export function resolveDevice(spec: string | undefined, app: Pick<App, 'mobile'>): RunDevice {
  const all = devices();
  const simulator = all.find(device => device.platform === 'ios' && !device.physical);
  const emulator = all.find(device => device.platform === 'android' && !device.physical);
  const want = spec ?? ((app.mobile?.iosBundleId && simulator) || !emulator ? 'ios' : 'android');
  const found =
    want === 'ios'
      ? simulator
      : want === 'android'
        ? emulator
        : want === 'phone'
          ? all.find(device => device.physical)
          : all.find(device => device.id === want || device.name === want);
  if (found) return found;
  const connected = all.map(device => `${device.name} (${device.id})`).join(', ') || 'none';
  return fail(NONE[want] ?? `no device ${want}; connected: ${connected}`);
}

/** This machine's address on its network, for phones on the same Wi-Fi; null when it has none. */
export function lanIp(): string | null {
  const iface = /interface:\s*(\S+)/.exec(sh('route', ['-n', 'get', 'default']))?.[1] ?? 'en0';
  return sh('ipconfig', ['getifaddr', iface]) || null;
}
