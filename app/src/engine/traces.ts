// Traces across local apps: one Jaeger in Docker takes OpenTelemetry from every app Koppler starts while it runs, and
// its trace view follows one request across the apps on the board, to where it failed.
import { spawn } from 'node:child_process';
import { positional } from '../cli/output.ts';
import { fail } from '../failure.ts';
import { alive, listener, readRecord, startProcess, stopOne } from './processes.ts';

export const TRACES = 'koppler-traces';
export const VIEW_PORT = 16686;
const OTLP_PORT = 4318;
// To update: the digest of the new version's tag on Docker Hub (jaegertracing/jaeger), once it is two weeks old.
const IMAGE = 'jaegertracing/jaeger:2.21.0@sha256:3d0ac795ff98aa04d1be04311d2dac6c25b4bfc8322dc02e53bc5b170c5018c3';
// Stopping the Docker client does not stop its container: it is removed on stop, and a leftover one before starting.
const RM = `docker rm -f ${TRACES} >/dev/null 2>&1`;
const COLLECTOR = [
  'sh',
  '-c',
  `${RM}; trap '${RM}; exit 0' TERM INT HUP; docker run --rm --name ${TRACES} -p 127.0.0.1:${String(VIEW_PORT)}:16686 -p 127.0.0.1:${String(OTLP_PORT)}:4318 ${IMAGE} & wait`,
];

/** Whether the collector runs, so apps started now send it their traces. */
export const tracing = (): boolean => {
  const record = readRecord(TRACES);
  return !!record && alive(record);
};

/** The settings an OpenTelemetry SDK (.NET, Node, Java, Python, Go) reads to send its traces here. */
export const traceEnv = (app: string): Record<string, string> => ({
  OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost:${String(OTLP_PORT)}`,
  OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
  OTEL_SERVICE_NAME: app,
  OTEL_TRACES_EXPORTER: 'otlp',
});

/** Where one app's traces are, or every app's. */
export const traceView = (app?: string): string =>
  `http://localhost:${String(VIEW_PORT)}/search${app ? `?service=${encodeURIComponent(app)}` : ''}`;

/** `koppler traces start|stop|open [<app>]`. */
export async function tracesCommand(args: string[]): Promise<void> {
  const [what = 'open', app] = positional(args);
  const record = readRecord(TRACES);
  if (what === 'stop') {
    console.log(record ? await stopOne(record) : 'traces are not being collected');
    return;
  }
  if (what === 'start') {
    if (record && alive(record)) console.log(`traces are collected already: ${traceView()}`);
    else {
      await startProcess({
        name: TRACES,
        command: COLLECTOR,
        restart: false,
        port: VIEW_PORT,
        onStop: [['docker', 'rm', '-f', TRACES]],
      });
      console.log(`Collecting traces: ${traceView()}`);
    }
    console.log('Apps Koppler starts from now on send theirs; restart the ones already running to include them.');
    return;
  }
  if (what !== 'open') fail('usage: koppler traces start|stop|open [<app>]');
  if (!tracing() || !listener(VIEW_PORT)) fail('traces are not being collected: koppler traces start');
  const url = traceView(app);
  spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  console.log(url);
}
