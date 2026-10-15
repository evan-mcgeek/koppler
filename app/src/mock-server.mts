// Answers an app's canned responses (its `mock` in stack.json) on its local port, for a card set to Mock.
// Usage (through `koppler run <app> --mock`): mock-server.mjs <port> <responses json>
import http from 'node:http';
import { answerFor, type MockResponse } from './core/mock.ts';

const port = Number(process.argv[2]);
const responses = JSON.parse(process.argv[3] ?? '[]') as MockResponse[];
if (!port || !Array.isArray(responses)) {
  console.error('usage: mock-server.mjs <port> <responses json>');
  process.exit(1);
}
http
  .createServer((request, response) => {
    const method = request.method ?? 'GET';
    const { pathname } = new URL(request.url ?? '/', 'http://mock');
    const answer = answerFor(responses, method, pathname);
    console.log(`${method} ${pathname} ${String(answer.status)}`);
    request.resume();
    response.writeHead(answer.status, answer.headers).end(answer.body);
  })
  .listen(port, () => {
    console.log(`Mock answering ${String(responses.length)} responses on port ${String(port)}`);
  });
