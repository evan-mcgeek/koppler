// Koppler's own config (which stack, where to look for repos) and the index of clones the last scan found.
import os from 'node:os';
import path from 'node:path';
import { readJson, writeJson } from '../json-files.ts';
import { Failure } from '../failure.ts';
import { configDir } from '../paths.ts';

/** A clone on this Mac, with one key per remote. */
export interface Repo {
  path: string;
  keys: string[];
}

/** Every clone the last scan found. */
export interface Index {
  at?: string;
  roots: string[];
  depth?: number;
  repos: Repo[];
}

export interface Config {
  stack?: string;
  roots?: string[];
  depth?: number;
  root?: string;
}

interface Called {
  deployed?: string | undefined;
}

export interface AppFile {
  name?: string | undefined;
  kind?: string | undefined;
  slug?: string | undefined;
  outside?: unknown;
  deployedUrl?: string | undefined;
  consumes?: Record<string, Called> | undefined;
  /** What differs per environment; read as it comes. */
  envs?: Record<string, Record<string, unknown>> | undefined;
  pending?: string | boolean | undefined;
}

/** A stack file as far as this module reads it. */
export interface StackFile {
  name?: string | undefined;
  envs?: string[];
  apps: Record<string, AppFile>;
  kinds?: unknown;
}

export type Save = (config: Config) => void;

export const CONFIG = path.join(configDir(), 'config.json');

export const INDEX = path.join(configDir(), 'repos.json');

export const expand = (given: string) => path.resolve(given.replace(/^~/, os.homedir()));

export const tilde = (full: string) => (full.startsWith(os.homedir()) ? '~' + full.slice(os.homedir().length) : full);

// Every failure here exits 1, a usage line too.
export function fail(message: string): never {
  throw new Failure(message, 1);
}

export const readIndex = () => readJson(INDEX) as Index | null;

export const saveConfig: Save = config => {
  writeJson(CONFIG, config);
};

export function loadConfig(): Config {
  const config = (readJson(CONFIG) as Config | null) ?? {};
  if (config.root && !config.roots) config.roots = [config.root];
  delete config.root;
  return config;
}
