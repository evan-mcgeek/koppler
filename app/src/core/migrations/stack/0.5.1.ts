// 0.5.1: the fields Koppler stopped reading give their facts to the ones it reads: an app's run, config, note and
// overrides, and a database's env, become start, description, the stack's notes, or go when another field holds them.
import type { Migration, Raw } from '../run.ts';

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
/** A command with a placeholder such as <profile> is a template for a person, not one Koppler can run. */
const runnable = (command: string) => !/<[^<>\s]+>/.test(command);
/** An old field with no fact in it: dropped, since nothing is lost. */
const blank = (value: unknown) =>
  value === null ||
  (typeof value === 'string' && !value.trim()) ||
  (isObject(value) && Object.values(value).every(one => typeof one === 'string' && !one.trim()));
/** Takes a field out of an old place in the file. */
const drop = (place: Raw, field: string) => Reflect.deleteProperty(place, field);
/** What fits description: one line of at most 200 characters. */
const fitsDescription = (words: string) => words.length <= 200 && !/[\r\n]/.test(words);

/** The old run: a command, or how to start it from the terminal (cli) and from an IDE (ide). */
function readRun(run: unknown): { cli?: string; ide?: string } | undefined {
  const command = text(run);
  if (command) return { cli: command };
  if (!isObject(run) || Object.keys(run).some(key => key !== 'cli' && key !== 'ide')) return undefined;
  const [cli, ide] = [text(run['cli']), text(run['ide'])];
  if ((run['cli'] !== undefined && !cli) || (run['ide'] !== undefined && !ide)) return undefined;
  return { ...(cli && { cli }), ...(ide && { ide }) };
}

export const oldAppFields: Migration = {
  version: '0.5.1',
  about: "Fields Koppler stopped reading become start, description or the stack's notes, or go when another holds them",
  up: (raw, say) => {
    const next = structuredClone(raw);
    const notes: string[] = Array.isArray(next['notes'])
      ? [...(next['notes'] as string[])]
      : text(next['notes'])
        ? [text(next['notes']) as string]
        : [];
    const before = notes.length;
    const note = (line: string) => {
      if (!notes.some(one => one.includes(line))) notes.push(line);
    };
    /** Moves one place's run (the app's, or an environment's) into its start, or the notes when it cannot run as written. */
    const moveRun = (place: Raw, who: string, at: string) => {
      if (!Object.hasOwn(place, 'run')) return;
      if (blank(place['run'])) {
        drop(place, 'run');
        return;
      }
      const run = readRun(place['run']);
      if (!run) {
        say(`${at}: run left as it was, its shape is not one Koppler knew`);
        return;
      }
      const { cli, ide } = run;
      const inIde = ide ? `; in an IDE: ${ide}` : '';
      if (cli && runnable(cli) && !text(place['start'])) {
        place['start'] = cli;
        if (ide) note(`${who} in an IDE: ${ide}`);
        say(`${at}: run became start`);
      } else if (cli) {
        note(`${who} starts with \`${cli}\`${inIde}`);
        say(`${at}: run kept in the stack's notes`);
      } else if (ide) note(`${who} in an IDE: ${ide}`);
      delete place['run'];
    };
    for (const [id, app] of Object.entries(isObject(next['apps']) ? next['apps'] : {})) {
      if (!isObject(app)) continue;
      const who = text(app['name']) ?? id;
      moveRun(app, who, id);
      for (const [env, overlay] of Object.entries(isObject(app['envs']) ? app['envs'] : {})) {
        if (!isObject(overlay)) continue;
        moveRun(overlay, `${who} on ${env}`, `${id} on ${env}`);
        for (const field of ['config', 'note']) {
          const words = text(overlay[field]);
          if (Object.hasOwn(overlay, field) && blank(overlay[field])) drop(overlay, field);
          else if (words) {
            note(`${who} on ${env}: ${words}`);
            drop(overlay, field);
            say(`${id} on ${env}: ${field} kept in the stack's notes`);
          }
        }
      }
      for (const field of ['config', 'note']) if (Object.hasOwn(app, field) && blank(app[field])) drop(app, field);
      const said = text(app['note']);
      if (said && !text(app['description']) && fitsDescription(said)) {
        app['description'] = said;
        delete app['note'];
        say(`${id}: note became description`);
      } else if (said) {
        note(`${who}: ${said}`);
        delete app['note'];
        say(`${id}: note kept in the stack's notes`);
      }
      const config = text(app['config']);
      if (config) {
        note(`${who}: ${config}`);
        delete app['config'];
        say(`${id}: config kept in the stack's notes`);
      }
      moveOverrides(app, who, id);
    }
    /** An app's overrides: settings its AWS sign-in already sets go, the rest is kept in words. */
    function moveOverrides(app: Raw, who: string, id: string) {
      const overrides = app['overrides'];
      if (!Object.hasOwn(app, 'overrides')) return;
      const set = isObject(overrides) ? overrides['set'] : undefined;
      if (
        !isObject(overrides) ||
        Object.entries(overrides).some(([key, value]) => (key === 'set' ? !isObject(value) : !text(value))) ||
        (isObject(set) && Object.values(set).some(value => !text(value)))
      ) {
        say(`${id}: overrides left as they were, their shape is not one Koppler knew`);
        return;
      }
      const signedIn = (Array.isArray(app['prereqs']) ? app['prereqs'] : []).map(need => isObject(need) && need['sso']);
      for (const [name, value] of Object.entries(isObject(set) ? set : {}))
        if (!(name === 'AWS_PROFILE' && signedIn.includes(value))) note(`${who} runs with ${name}=${String(value)}`);
      for (const [key, value] of Object.entries(overrides))
        if (key === 'note') note(`${who}: ${String(value)}`);
        else if (key !== 'set') note(`${who} runs with ${key}=${String(value)}`);
      delete app['overrides'];
      say(`${id}: overrides kept in the stack's notes, what its sign-in sets dropped`);
    }
    const uses = Object.values(isObject(next['apps']) ? next['apps'] : {}).flatMap(app =>
      isObject(app) && isObject(app['uses']) ? Object.entries(app['uses']) : [],
    );
    for (const [id, database] of Object.entries(isObject(next['databases']) ? next['databases'] : {})) {
      if (!isObject(database) || !Object.hasOwn(database, 'env')) continue;
      const env = text(database['env']);
      if (env === undefined && !blank(database['env'])) {
        say(`databases.${id}: env left as it was, its shape is not one Koppler knew`);
        continue;
      }
      const held = uses.some(
        ([used, use]) => used === id && isObject(use) && (use['setting'] === env || use['env'] === env),
      );
      if (env && !held) note(`${text(database['name']) ?? id}: its apps read it from ${env}`);
      delete database['env'];
      if (env)
        say(
          `databases.${id}: env ${held ? 'dropped, its apps' : 'kept in the stack'}${held ? "' uses hold it" : "'s notes"}`,
        );
    }
    if (notes.length > before) next['notes'] = notes;
    return next;
  },
};
