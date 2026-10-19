// 0.2.1: databases named once where 0.2.0 left a stack alone because it dropped each tunnel's command and notes.
import type { Migration } from '../run.ts';
import { databasesNamedOnce } from './0.2.0.ts';

export const databasesNamedOnceAgain: Migration = {
  version: '0.2.1',
  about: 'Names each database once where 0.2.0 left the stack alone, keeping each tunnel command and note',
  up: databasesNamedOnce.up,
};
