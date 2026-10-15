import { describe, expect, it } from 'vitest';
import { answerFor } from './mock.ts';

const responses = [
  { method: 'post', path: '/orders', status: 201, body: { id: 7 } },
  { path: '/health', body: 'ok' },
  { method: 'GET', path: '/orders/*', body: { id: 1 }, headers: { 'x-mock': 'yes' } },
];

describe('answerFor', () => {
  it('answers the first response for the method and path, as JSON or text', () => {
    expect(answerFor(responses, 'POST', '/orders')).toMatchObject({
      status: 201,
      body: '{"id":7}',
      headers: { 'content-type': 'application/json' },
    });
    expect(answerFor(responses, 'DELETE', '/health')).toMatchObject({
      status: 200,
      body: 'ok',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  });

  it('answers every path under one that ends in *, with its own headers', () => {
    expect(answerFor(responses, 'GET', '/orders/42/lines')).toMatchObject({
      body: '{"id":1}',
      headers: { 'x-mock': 'yes' },
    });
    expect(answerFor(responses, 'GET', '/orders').status).toBe(404);
  });

  it('says which mocks there are when none fits, and lets a browser call it', () => {
    const missing = answerFor(responses, 'GET', '/nope');
    expect(missing.status).toBe(404);
    expect(JSON.parse(missing.body)).toEqual({
      error: 'no mock for GET /nope',
      known: ['POST /orders', 'ANY /health', 'GET /orders/*'],
    });
    expect(missing.headers['access-control-allow-origin']).toBe('*');
    expect(answerFor(responses, 'OPTIONS', '/orders').status).toBe(204);
  });
});
