// The layout engine, in a worker of its own: started the first time a map is laid out, and off the page's main thread.
import ElkApi from 'elkjs/lib/elk-api.js';
import type { ELK } from 'elkjs/lib/elk-api.js';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';

let elk: ELK | undefined;
export const engine = (): ELK => (elk ??= new ElkApi({ workerUrl }));
