import { expect, test } from 'vitest';
import { parseLine, parseLog } from './logfmt.ts';

test('Serilog compact JSON: the message, a filled template, the level and the exception', () => {
  const line = '{"@t":"2026-10-06T17:00:00.0446470Z","@m":"HTTP \\"GET\\" \\"/\\" responded 200","@i":"x"}';
  const row = parseLine(line);
  expect(row.level).toBe('info');
  expect(row.text).toBe('HTTP "GET" "/" responded 200');
  expect(row.time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  const templated = '{"@t":"2026-10-06T17:00:00Z","@mt":"Got {Count} items","Count":3,"@l":"Warning"}';
  expect(parseLine(templated)).toMatchObject({ text: 'Got 3 items', level: 'warn' });
  const failed = '{"@t":"2026-10-06T17:00:00Z","@m":"boom","@l":"Error","@x":"System.Exception: boom"}';
  expect(parseLine(failed).detail).toBe('System.Exception: boom');
});

test("Microsoft's JSON console: the template filled from its properties", () => {
  const line =
    '{"Timestamp":"2026-10-06T19:00:07.24+02:00","Level":"Warning","MessageTemplate":"HTTP {RequestMethod} {RequestPath} responded {StatusCode} in {ElapsedMilliseconds:0.0000} ms","Properties":{"RequestMethod":"GET","RequestPath":"/","StatusCode":404,"ElapsedMilliseconds":1.5}}';
  expect(parseLine(line)).toMatchObject({ level: 'warn', text: 'HTTP GET / responded 404 in 1.5 ms' });
});

test('text lines: a tunnel, a mobile app, the compiler, Koppler itself and the start line', () => {
  expect(parseLine('2026-10-06T18:12:00Z ERR failed to connect to origin').level).toBe('error');
  expect(parseLine('flutter: \\^[[31mException -- Invalid payment key\\^[[0m')).toEqual({
    time: '',
    level: 'error',
    text: 'Exception -- Invalid payment key',
    detail: '',
  });
  expect(parseLine('flutter: \\^[[36mAcmeBlocObserver: onClose -- PaymentBloc\\^[[0m').level).toBe('info');
  const warning =
    '/r/Acme.Api/Resolvers/TravelResolver.cs(34,40): warning CS1573: Parameter x has no tag [/r/a.csproj]';
  expect(parseLine(warning).text).toBe('CS1573 Resolvers/TravelResolver.cs:34 Parameter x has no tag');
  expect(parseLine('koppler: ready: POST http://localhost:5080/x')).toMatchObject({
    level: 'koppler',
    text: 'ready: POST http://localhost:5080/x',
  });
  expect(parseLine('2026-10-06 20:08:37 $ dotnet run --project Api')).toMatchObject({
    level: 'start',
    time: '20:08:37',
  });
  expect(parseLine('{"not":"a log event"}')).toMatchObject({ level: 'info', text: '{"not":"a log event"}' });
});

test('a stack trace belongs to the row above it', () => {
  const rows = parseLog('Unhandled exception. System.Exception: x\n   at A.B()\n   at C.D()\nnext line\n\n');
  expect(rows.map(r => [r.level, r.detail])).toEqual([
    ['error', 'at A.B()\nat C.D()'],
    ['info', ''],
  ]);
  const flutter = parseLog(
    'flutter: Exception -- boom\nflutter: #0      A.b (x.dart:1)\nflutter: <asynchronous suspension>\nflutter:  -- null\nflutter: next',
  );
  expect(flutter.map(r => [r.level, r.text])).toEqual([
    ['error', 'Exception -- boom'],
    ['info', 'next'],
  ]);
  expect(flutter[0]?.detail).toBe('#0      A.b (x.dart:1)\n<asynchronous suspension>\n-- null');
});

test('a run of compiler warnings is one row that says how many', () => {
  const rows = parseLog('/r/A.cs(1,2): warning CS1: one\n/r/B.cs(3,4): warning CS2: two\nBuild done');
  expect(rows.map(r => [r.text, r.items?.length ?? 0])).toEqual([
    ['2 build warnings', 2],
    ['Build done', 0],
  ]);
  expect(parseLog(null)).toEqual([]);
});
