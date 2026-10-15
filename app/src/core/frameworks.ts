// Browser front-end frameworks, recognised from package.json: the usual dev port, how to open the dev server to the
// network, and the prefix the framework requires for settings the browser code can read.

export interface Framework {
  /** The package that gives it away. */
  dep: string;
  name: string;
  port: number;
  /** Arguments for its dev script that make it listen on the network. */
  lanArgs?: string[];
  /** Or the setting that does, for one without such arguments. */
  lanEnv?: string;
  envPrefix: string;
}
export const FRAMEWORKS: Framework[] = [
  { dep: 'next', name: 'Next.js', port: 3000, lanArgs: ['-H', '0.0.0.0'], envPrefix: 'NEXT_PUBLIC_' },
  { dep: 'vite', name: 'Vite', port: 5173, lanArgs: ['--host', '0.0.0.0'], envPrefix: 'VITE_' },
  { dep: '@angular/cli', name: 'Angular', port: 4200, lanArgs: ['--host', '0.0.0.0'], envPrefix: '' },
  { dep: 'react-scripts', name: 'Create React App', port: 3000, lanEnv: 'HOST=0.0.0.0', envPrefix: 'REACT_APP_' },
];

/** A package.json, as far as this needs it. */
export interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}
export function frameworkOf(pkg: PackageJson | null | undefined): Framework | null {
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  return FRAMEWORKS.find(framework => Object.hasOwn(deps, framework.dep)) ?? null;
}
