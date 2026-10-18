// Appearance, remembered in this browser: a scheme, and the local and deployed colours picked by hand over it. Warning
// and PROD colours are not among the picks, so a custom colour can never be mistaken for either.
export const SCHEMES = {
  mono: { name: 'Mono', note: 'No hue until something needs you', local: '#ffffff', deployed: '#9a9a9a' },
  lime: { name: 'Patch bay', note: 'Lime local, periwinkle deployed', local: '#c8f03c', deployed: '#8ea2ff' },
  signal: { name: 'Signal', note: 'Orange local, steel deployed, warm black', local: '#ff8a1f', deployed: '#7fc4d8' },
  scope: { name: 'Scope', note: 'Phosphor green local, cyan deployed', local: '#52f29a', deployed: '#5cc8ff' },
  sodium: { name: 'Sodium', note: 'Yellow local, violet deployed, cool slate', local: '#ffd43b', deployed: '#a98bff' },
} as const;
export type Scheme = keyof typeof SCHEMES;
export const LOCALS = ['#ffffff', '#c8f03c', '#52f29a', '#5ce1e6', '#ffd43b', '#ff8a1f'] as const;
export const DEPLOYEDS = ['#9a9a9a', '#8ea2ff', '#a98bff', '#7fc4d8', '#5cc8ff', '#e6a3d8'] as const;

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
    const local = pick(kept.local, LOCALS);
    const deployed = pick(kept.deployed, DEPLOYEDS);
    return {
      scheme: kept.scheme && kept.scheme in SCHEMES ? kept.scheme : 'mono',
      ...(local && { local }),
      ...(deployed && { deployed }),
    };
  } catch {
    return { scheme: 'mono' };
  }
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
    ] as const)
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
  }
}
export const appearance = new Appearance();
