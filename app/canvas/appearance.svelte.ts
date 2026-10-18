// Appearance, remembered in this browser: a scheme, and the local and deployed colours picked by hand over it. Warning
// and PROD colours are not among the picks, so a custom colour can never be mistaken for either.
interface SchemeOf {
  name: string;
  note: string;
  /** Its board, for the swatch in Appearance. */
  desk: string;
  local: string;
  deployed: string;
  live: string;
  light?: true;
}
export const SCHEMES = {
  mono: {
    desk: '#0d0d0d',
    name: 'Mono',
    note: 'No hue until something needs you',
    local: '#ffffff',
    deployed: '#9a9a9a',
    live: '#4ade80',
  },
  lime: {
    desk: '#0e0f10',
    name: 'Patch bay',
    note: 'Lime local, periwinkle deployed',
    local: '#c8f03c',
    deployed: '#8ea2ff',
    live: '#4fd6c4',
  },
  signal: {
    desk: '#100e0c',
    name: 'Signal',
    note: 'Orange local, steel deployed, warm black',
    local: '#ff8a1f',
    deployed: '#7fc4d8',
    live: '#5bd97a',
  },
  scope: {
    desk: '#0a0d0b',
    name: 'Scope',
    note: 'Phosphor green local, cyan deployed',
    local: '#52f29a',
    deployed: '#5cc8ff',
    live: '#ffffff',
  },
  sodium: {
    desk: '#0c0e12',
    name: 'Sodium',
    note: 'Yellow local, violet deployed, cool slate',
    local: '#ffd43b',
    deployed: '#a98bff',
    live: '#4ade80',
  },
  paper: {
    desk: '#f4f4f2',
    name: 'Paper',
    note: 'Light, ink local',
    local: '#141414',
    deployed: '#6b6b6b',
    live: '#1a8f4c',
    light: true,
  },
  blueprint: {
    desk: '#edf1f5',
    name: 'Blueprint',
    note: 'Light, blue local, violet deployed, cool grey',
    local: '#1f4fd8',
    deployed: '#7652c2',
    live: '#15803d',
    light: true,
  },
  workshop: {
    desk: '#f5f1ea',
    name: 'Workshop',
    note: 'Light, burnt orange local, teal deployed, warm paper',
    local: '#b4490a',
    deployed: '#22738a',
    live: '#2b8048',
    light: true,
  },
} satisfies Record<string, SchemeOf>;
export type Scheme = keyof typeof SCHEMES;
const DARK = {
  locals: ['#ffffff', '#c8f03c', '#52f29a', '#5ce1e6', '#ffd43b', '#ff8a1f'],
  deployeds: ['#9a9a9a', '#8ea2ff', '#a98bff', '#7fc4d8', '#5cc8ff', '#e6a3d8'],
};
const LIGHT = {
  locals: ['#141414', '#1f4fd8', '#b4490a', '#0f766e', '#7a3fc8', '#1a6e2e'],
  deployeds: ['#6b6b6b', '#7652c2', '#22738a', '#4a5fb5', '#8a5a2b', '#a3407a'],
};
/** The local and deployed colours a scheme offers to pick by hand: light ones for a light scheme. */
export const isLight = (scheme: Scheme) => !!(SCHEMES[scheme] as SchemeOf).light;
export const picksFor = (scheme: Scheme) => (isLight(scheme) ? LIGHT : DARK);
// A green local cable would read as running: the running light then takes the ink colour instead.
const GREEN_LOCALS = ['#c8f03c', '#52f29a', '#1a6e2e'];
const GREEN_LIVES = ['#4ade80', '#5bd97a', '#1a8f4c', '#15803d', '#2b8048'];

interface Kept {
  scheme: Scheme;
  local?: string;
  deployed?: string;
}
const KEY = 'koppler-appearance';
const remembered = (): Kept => {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Kept>;
    const pick = (value: unknown, from: readonly string[]) =>
      typeof value === 'string' && from.includes(value) ? value : undefined;
    const scheme = kept.scheme && kept.scheme in SCHEMES ? kept.scheme : 'mono';
    const local = pick(kept.local, picksFor(scheme).locals);
    const deployed = pick(kept.deployed, picksFor(scheme).deployeds);
    return {
      scheme,
      ...(local && { local }),
      ...(deployed && { deployed }),
    };
  } catch {
    return { scheme: 'mono' };
  }
};
/** The running colour beside a local colour: never two greens. */
const liveFor = (scheme: Scheme, local: string | undefined): string | undefined => {
  const own = SCHEMES[scheme] as SchemeOf;
  if (!local || !GREEN_LOCALS.includes(local) || !GREEN_LIVES.includes(own.live)) return undefined;
  return own.light ? '#141414' : '#ffffff';
};

class Appearance {
  now = $state<Kept>(remembered());
  constructor() {
    this.#apply();
  }
  /** The local and deployed colours in use: the hand-picked ones, else the scheme's. */
  get local(): string {
    return this.now.local ?? SCHEMES[this.now.scheme].local;
  }
  get deployed(): string {
    return this.now.deployed ?? SCHEMES[this.now.scheme].deployed;
  }
  /** A scheme brings its own local and deployed colours: picks made by hand are dropped. */
  pickScheme(scheme: Scheme): void {
    this.#keep({ scheme });
  }
  pickLocal(local: string): void {
    this.#keep({ ...this.now, local });
  }
  pickDeployed(deployed: string): void {
    this.#keep({ ...this.now, deployed });
  }
  /** Back to the scheme's own local and deployed colours. */
  schemeDefault(): void {
    this.#keep({ scheme: this.now.scheme });
  }
  #keep(next: Kept): void {
    this.now = next;
    this.#apply();
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Not remembered where the browser keeps nothing; it still holds for this page.
    }
  }
  #apply(): void {
    const root = document.documentElement;
    if (this.now.scheme === 'mono') delete root.dataset['scheme'];
    else root.dataset['scheme'] = this.now.scheme;
    for (const [name, value] of [
      ['--local', this.now.local],
      ['--deployed', this.now.deployed],
      ['--live', liveFor(this.now.scheme, this.now.local)],
    ] as const)
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
  }
}
export const appearance = new Appearance();
