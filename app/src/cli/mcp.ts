// `koppler mcp`: an MCP server on stdio, so an agent reads and waits on Koppler without the listen loop.
// Each tool runs the koppler command itself with fixed flags; nothing that needs the user's approval is offered.
import { execFile } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { z } from 'zod';
import { APP_ID, RUN_ID } from '../ids.ts';
import { CODE } from '../paths.ts';

const app = z.string().regex(APP_ID).describe('An app id from the stack, such as orders-api');
const env = z.string().regex(APP_ID).describe('An environment of the stack, such as qa; the first one when left out');
const JSON_OUT = { type: 'object' } as const;

interface Tool<T extends z.ZodType> {
  description: string;
  input: T;
  readOnly: boolean;
  /** The koppler arguments for a call, and what goes to its stdin. */
  command: (input: z.infer<T>) => { args: string[]; stdin?: string };
  /** Whether it prints JSON, which comes back as structured content too. */
  json: boolean;
}
const tool = <T extends z.ZodType>(one: Tool<T>) => one;

const TOOLS = {
  status: tool({
    description: 'What Koppler runs now (apps, tunnels, the canvas), each with its state, port and uptime.',
    input: z.strictObject({
      apps: z.boolean().optional().describe("Add every app in the stack with its clone's branch"),
    }),
    readOnly: true,
    json: true,
    command: ({ apps }) => ({ args: ['status', '--json', ...(apps ? ['--apps'] : [])] }),
  }),
  logs: tool({
    description: "The last lines of an app's or tunnel's log, secrets masked.",
    input: z.strictObject({
      name: app,
      lines: z.number().int().min(1).max(2000).optional().describe('How many, 100 when left out'),
    }),
    readOnly: true,
    json: false,
    command: ({ name, lines }) => ({ args: ['logs', name, '-n', String(lines ?? 100)] }),
  }),
  doctor: tool({
    description:
      'Whether apps can run on this Mac: tools, sign-ins, tunnels, hosts entries, secrets, and what the user still has to do.',
    input: z.strictObject({
      apps: z.array(app).max(50).optional().describe('The apps to check; every app on the board when left out'),
      env: env.optional(),
      secrets: z.boolean().optional().describe('Also check that each stored secret is there'),
      flow: z.boolean().optional().describe('Also test every connection between the apps that run'),
    }),
    readOnly: true,
    json: true,
    command: ({ apps, env: on, secrets, flow }) => ({
      args: [
        'doctor',
        ...(apps ?? []),
        ...(on ? ['--env', on] : []),
        ...(secrets ? ['--secrets'] : []),
        ...(flow ? ['--flow'] : []),
        '--json',
      ],
    }),
  }),
  plan: tool({
    description:
      'What the newest run does compared with what runs now: what starts, restarts, stops and keeps running.',
    input: z.strictObject({ apps: z.array(app).max(50).optional(), env: env.optional() }),
    readOnly: true,
    json: true,
    command: ({ apps, env: on }) => ({ args: ['plan', ...(apps ?? []), ...(on ? ['--env', on] : []), '--json'] }),
  }),
  history: tool({
    description: 'Recent runs and Stops, and how each ended.',
    input: z.strictObject({}),
    readOnly: true,
    json: true,
    command: () => ({ args: ['history', '--json'] }),
  }),
  wait: tool({
    description:
      'Waits until apps are healthy (answering, and passing their ready check), up or down. Fails on a timeout or an app that exits, naming each state.',
    input: z.strictObject({
      apps: z.array(app).min(1).max(50),
      until: z.enum(['healthy', 'up', 'down']),
      timeoutSeconds: z.number().int().min(1).max(1800).optional().describe('120 when left out'),
    }),
    readOnly: true,
    json: true,
    command: ({ apps, until, timeoutSeconds }) => ({
      args: ['wait', ...apps, `--${until}`, '--timeout', String(timeoutSeconds ?? 120), '--json'],
    }),
  }),
  say: tool({
    description:
      "Shows a question, a result or a failure in the canvas's inbox. Commands for the user go in a section's commands.",
    input: z.strictObject({
      kind: z.enum(['question', 'result', 'failure', 'info']),
      title: z.string().min(1).max(120),
      summary: z.string().max(800).optional(),
      run: z.string().regex(RUN_ID).optional().describe('The run it is about'),
      sections: z
        .array(
          z.strictObject({
            title: z.string().max(80),
            items: z.array(z.string().max(400)).max(12),
            commands: z.array(z.string().max(1000)).max(6).optional(),
          }),
        )
        .max(8)
        .optional(),
      choices: z
        .array(
          z.strictObject({
            id: z.string().regex(/^[a-z0-9-]{1,32}$/),
            label: z.string().min(1).max(80),
            detail: z.string().max(300).optional(),
          }),
        )
        .max(6)
        .optional(),
    }),
    readOnly: false,
    json: false,
    command: message => ({ args: ['say'], stdin: JSON.stringify(message) }),
  }),
} satisfies Record<string, Tool<z.ZodType>>;
type Name = keyof typeof TOOLS;

const ENTRY = path.join(CODE, 'koppler.mjs');
/** Runs koppler with the given arguments: what it printed, and whether it failed. */
const koppler = (args: string[], stdin?: string) =>
  new Promise<{ out: string; err: string; failed: boolean }>(resolve => {
    const child = execFile(
      process.execPath,
      [ENTRY, ...args],
      { maxBuffer: 8 << 20, timeout: 31 * 60_000 },
      (error, out, err) => {
        resolve({ out, err, failed: !!error });
      },
    );
    child.stdin?.end(stdin ?? '');
  });

async function call(name: string, given: unknown) {
  if (!Object.hasOwn(TOOLS, name))
    return { content: [{ type: 'text', text: `No tool called ${name}` }], isError: true };
  const one = TOOLS[name as Name] as Tool<z.ZodType>;
  const parsed = one.input.safeParse(given ?? {});
  if (!parsed.success) return { content: [{ type: 'text', text: z.prettifyError(parsed.error) }], isError: true };
  const { args, stdin } = one.command(parsed.data);
  const { out, err, failed } = await koppler(args, stdin);
  const text = [out.trim(), err.trim()].filter(Boolean).join('\n') || (failed ? 'failed' : 'done');
  let structured: unknown;
  if (one.json)
    try {
      structured = JSON.parse(out);
    } catch {
      // Not JSON (a failure said in words): the text says it.
    }
  const object = structured && typeof structured === 'object' && !Array.isArray(structured);
  return {
    content: [{ type: 'text', text }],
    ...(object
      ? { structuredContent: structured }
      : structured !== undefined && { structuredContent: { result: structured } }),
    isError: failed,
  };
}

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
type Request = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: Record<string, unknown> };

async function answer(request: Request, version: string): Promise<unknown> {
  const { method, params = {} } = request;
  if (method === 'initialize') {
    const asked = typeof params['protocolVersion'] === 'string' ? params['protocolVersion'] : '';
    return {
      protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
      capabilities: { tools: {} },
      serverInfo: { name: 'koppler', version },
      instructions:
        'Koppler runs part of a stack locally. Read with status, plan, history, logs and doctor; wait for apps with wait; talk to the user on the canvas with say. Starting, stopping and approving stay with the koppler command and the user.',
    };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list')
    return {
      tools: Object.entries(TOOLS).map(([name, one]) => ({
        name,
        description: one.description,
        inputSchema: z.toJSONSchema(one.input),
        ...(one.json && { outputSchema: JSON_OUT }),
        annotations: { readOnlyHint: one.readOnly },
      })),
    };
  if (method === 'tools/call')
    return call(typeof params['name'] === 'string' ? params['name'] : '', params['arguments']);
  throw Object.assign(new Error(`Method not found: ${String(method)}`), { code: -32601 });
}

/** Serves MCP over stdin and stdout, one JSON message a line, until stdin closes. */
export async function mcp(version: string): Promise<void> {
  const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const lines = readline.createInterface({ input: process.stdin });
  const pending = new Set<Promise<void>>();
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request: Request;
    try {
      request = JSON.parse(line) as Request;
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    // A notification gets no answer.
    if (request.id === undefined) continue;
    const id = request.id;
    const done = answer(request, version).then(
      result => {
        send({ jsonrpc: '2.0', id, result });
      },
      (error: unknown) => {
        const { code = -32603, message = String(error) } = error as { code?: number; message?: string };
        send({ jsonrpc: '2.0', id, error: { code, message } });
      },
    );
    pending.add(done);
    void done.finally(() => pending.delete(done));
  }
  await Promise.all(pending);
}
