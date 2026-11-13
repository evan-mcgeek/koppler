// The layout engine on the page's own thread: a page opened from a file starts no worker.
import Bundled from 'elkjs/lib/elk.bundled.js';
import type { ELK } from 'elkjs/lib/elk-api.js';

const elk: ELK = new Bundled();
export const engine = (): ELK => elk;
