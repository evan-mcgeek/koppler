import { expect, test } from 'vitest';
import { apiEvent, apiResponse, matchRoute, samTemplate, type ApiRequest } from './lambda.ts';

const code = '/Users/acme/acme-shop/orders-fn';

test('Node, Python, Java and Ruby are built by sam build from a one-function template that points at the code', () => {
  for (const runtime of ['nodejs20.x', 'python3.12', 'java21', 'ruby3.3']) {
    const made = samTemplate({ handler: 'app.handler', runtime }, code, 'arm64', false);
    expect(made?.handler).toBe('app.handler');
    expect(made?.runtime).toBe(runtime);
    const template = JSON.parse(made?.template ?? '') as Record<string, unknown>;
    expect(template).toEqual({
      AWSTemplateFormatVersion: '2010-09-09',
      Transform: 'AWS::Serverless-2016-10-31',
      Resources: {
        Function: {
          Type: 'AWS::Serverless::Function',
          Properties: { CodeUri: code, Handler: 'app.handler', Runtime: runtime, Architectures: ['arm64'] },
        },
      },
    });
  }
});

test('Go is built by sam build on the provided runtime, its handler the bootstrap binary', () => {
  for (const runtime of ['go1.x', 'provided.al2023']) {
    const made = samTemplate({ handler: 'main', runtime }, code, 'x86_64', true);
    expect(made?.runtime).toBe('provided.al2023');
    expect(made?.handler).toBe('bootstrap');
    const template = JSON.parse(made?.template ?? '') as { Resources: { Function: Record<string, unknown> } };
    expect(template.Resources.Function['Metadata']).toEqual({ BuildMethod: 'go1.x' });
    expect(template.Resources.Function['Properties']).toMatchObject({
      Runtime: 'provided.al2023',
      Handler: 'bootstrap',
    });
  }
});

test('.NET keeps its own build, and a custom runtime with no Go module is zipped as it is', () => {
  expect(
    samTemplate({ handler: 'Orders::Orders.Function::Handle', runtime: 'dotnet8' }, code, 'arm64', false),
  ).toBeNull();
  expect(samTemplate({ handler: 'bootstrap', runtime: 'provided.al2023' }, code, 'arm64', false)).toBeNull();
});

test('a route matches its path, with or without a method, and takes its path parameters', () => {
  expect(matchRoute([], 'GET', '/anything/else')).toEqual({
    route: '$default',
    resource: '/{proxy+}',
    params: { proxy: 'anything/else' },
  });
  expect(matchRoute(['/orders'], 'POST', '/orders')).toEqual({ route: 'ANY /orders', resource: '/orders', params: {} });
  expect(matchRoute(['orders/'], 'GET', '/orders')).toEqual({ route: 'ANY /orders', resource: '/orders', params: {} });
  expect(matchRoute(['GET /orders/{id}'], 'GET', '/orders/42')).toEqual({
    route: 'GET /orders/{id}',
    resource: '/orders/{id}',
    params: { id: '42' },
  });
  expect(matchRoute(['GET /orders/{id}'], 'DELETE', '/orders/42')).toBeNull();
  expect(matchRoute(['any /files/{path+}'], 'PUT', '/files/a/b%20c.txt')).toEqual({
    route: 'ANY /files/{path+}',
    resource: '/files/{path+}',
    params: { path: 'a/b c.txt' },
  });
  expect(matchRoute(['get /orders'], 'GET', '/orders')?.route).toBe('GET /orders');
  expect(matchRoute(['/orders'], 'GET', '/carts')).toBeNull();
});

test('the most specific route wins whatever the order, as API Gateway picks: a path, then a named method', () => {
  const routes = ['ANY /{proxy+}', 'GET /orders/{id}', 'ANY /orders/latest', 'GET /orders/latest', 'ANY /orders/{id}'];
  expect(matchRoute(routes, 'GET', '/orders/latest')?.route).toBe('GET /orders/latest');
  expect(matchRoute(routes, 'POST', '/orders/latest')?.route).toBe('ANY /orders/latest');
  expect(matchRoute(routes, 'GET', '/orders/7')?.route).toBe('GET /orders/{id}');
  expect(matchRoute(routes, 'PUT', '/orders/7')?.route).toBe('ANY /orders/{id}');
  expect(matchRoute(routes, 'GET', '/carts/7')?.route).toBe('ANY /{proxy+}');
  expect(matchRoute(['ANY /orders', 'POST /orders'], 'POST', '/orders')?.route).toBe('POST /orders');
});

test('a malformed escape in a path parameter is a bad request, not a crash', () => {
  expect(() => matchRoute(['GET /orders/{id}'], 'GET', '/orders/100%')).toThrow(URIError);
});

const request: ApiRequest = {
  method: 'POST',
  url: '/orders/42?size=big&tag=a&tag=b',
  headers: [
    ['Content-Type', 'application/json'],
    ['X-Tag', 'one'],
    ['X-Tag', 'two'],
    ['Cookie', 'cart=1; theme=dark'],
    ['User-Agent', 'acme-shop'],
  ],
  body: Buffer.from('{"item":"mug"}'),
  sourceIp: '127.0.0.1',
};
const at = new Date('2026-11-22T10:00:00Z');

test('an HTTP API gets a payload 2.0 event', () => {
  const matched = matchRoute(['POST /orders/{id}'], 'POST', '/orders/42');
  if (!matched) throw new Error('no route');
  const event = apiEvent('http', request, matched, at, 'req-1');
  expect(event).toMatchObject({
    version: '2.0',
    routeKey: 'POST /orders/{id}',
    rawPath: '/orders/42',
    rawQueryString: 'size=big&tag=a&tag=b',
    cookies: ['cart=1', 'theme=dark'],
    headers: { 'content-type': 'application/json', 'x-tag': 'one,two', 'user-agent': 'acme-shop' },
    queryStringParameters: { size: 'big', tag: 'a,b' },
    pathParameters: { id: '42' },
    body: '{"item":"mug"}',
    isBase64Encoded: false,
    requestContext: {
      http: { method: 'POST', path: '/orders/42', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'acme-shop' },
      requestId: 'req-1',
      routeKey: 'POST /orders/{id}',
      stage: '$default',
      time: '22/Nov/2026:10:00:00 +0000',
      timeEpoch: at.getTime(),
    },
  });
  expect((event['headers'] as Record<string, string>)['cookie']).toBeUndefined();
});

test('a REST API gets a payload 1.0 event, with every header and query value', () => {
  const matched = matchRoute(['POST /orders/{id}'], 'POST', '/orders/42');
  if (!matched) throw new Error('no route');
  const event = apiEvent('rest', request, matched, at, 'req-1');
  expect(event).toMatchObject({
    resource: '/orders/{id}',
    path: '/orders/42',
    httpMethod: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tag': 'two' },
    multiValueHeaders: { 'Content-Type': ['application/json'], 'X-Tag': ['one', 'two'] },
    queryStringParameters: { size: 'big', tag: 'b' },
    multiValueQueryStringParameters: { size: ['big'], tag: ['a', 'b'] },
    pathParameters: { id: '42' },
    body: '{"item":"mug"}',
    isBase64Encoded: false,
    requestContext: {
      httpMethod: 'POST',
      path: '/orders/42',
      resourcePath: '/orders/{id}',
      requestId: 'req-1',
      requestTime: '22/Nov/2026:10:00:00 +0000',
    },
  });
});

test('a REST API with no routes is a greedy proxy, never $default', () => {
  const matched = matchRoute([], 'GET', '/a/b');
  if (!matched) throw new Error('no route');
  expect(apiEvent('rest', { ...request, method: 'GET', url: '/a/b' }, matched, at, 'r')).toMatchObject({
    resource: '/{proxy+}',
    pathParameters: { proxy: 'a/b' },
    requestContext: { resourcePath: '/{proxy+}' },
  });
});

test('a binary body goes base64; an empty one is null in REST and absent in HTTP', () => {
  const png = { ...request, headers: [['Content-Type', 'image/png']] as [string, string][], body: Buffer.from([1, 2]) };
  expect(apiEvent('http', png, { route: '$default', resource: '/{proxy+}', params: {} }, at, 'r')).toMatchObject({
    body: 'AQI=',
    isBase64Encoded: true,
  });
  const empty = { ...request, method: 'GET', url: '/', headers: [], body: Buffer.alloc(0) };
  expect(apiEvent('rest', empty, { route: 'ANY /', resource: '/', params: {} }, at, 'r')).toMatchObject({
    body: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
  });
  const http = apiEvent('http', empty, { route: '$default', resource: '/{proxy+}', params: {} }, at, 'r');
  expect('body' in http).toBe(false);
  expect('cookies' in http).toBe(false);
});

test("the caller gets the function's own response: status, headers, cookies and a base64 body decoded", () => {
  expect(
    apiResponse('http', {
      statusCode: 201,
      headers: { 'content-type': 'image/png' },
      cookies: ['a=1', 'b=2'],
      body: 'AQI=',
      isBase64Encoded: true,
    }),
  ).toEqual({
    status: 201,
    headers: [
      ['content-type', 'image/png'],
      ['set-cookie', 'a=1'],
      ['set-cookie', 'b=2'],
    ],
    body: Buffer.from([1, 2]),
  });
  expect(
    apiResponse('rest', {
      statusCode: 200,
      headers: { 'X-One': 'h' },
      multiValueHeaders: { 'Set-Cookie': ['a=1', 'b=2'], 'X-One': ['m'] },
      body: 'ok',
    }),
  ).toEqual({
    status: 200,
    headers: [
      ['X-One', 'm'],
      ['Set-Cookie', 'a=1'],
      ['Set-Cookie', 'b=2'],
    ],
    body: Buffer.from('ok'),
  });
});

test('an HTTP API answer with no statusCode is the JSON body; a REST one is an error, as API Gateway does', () => {
  expect(apiResponse('http', { ok: true })).toEqual({
    status: 200,
    headers: [['content-type', 'application/json']],
    body: Buffer.from('{"ok":true}'),
  });
  expect(apiResponse('http', 'hello')).toEqual({
    status: 200,
    headers: [['content-type', 'application/json']],
    body: Buffer.from('hello'),
  });
  expect(apiResponse('rest', { ok: true })).toEqual({
    status: 502,
    headers: [['content-type', 'application/json']],
    body: Buffer.from('{"message":"Internal server error"}'),
  });
});
