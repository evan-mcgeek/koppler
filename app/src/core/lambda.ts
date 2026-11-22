// A Lambda run on this Mac: how `sam build` builds it, and the API Gateway event and answer for a call to its routes.

/** A REST API sends payload 1.0 events; an HTTP API sends payload 2.0. */
export type Api = 'http' | 'rest';

/** The one-function template `sam build` builds from, with the handler and runtime the function then runs with. */
export function samTemplate(
  config: { handler: string; runtime: string },
  code: string,
  arch: 'arm64' | 'x86_64',
  hasGoModule: boolean,
): { template: string; handler: string; runtime: string } | null {
  const go = config.runtime === 'go1.x' || (config.runtime.startsWith('provided') && hasGoModule);
  if (!go && !/^(nodejs|python|java|ruby)/.test(config.runtime)) return null;
  // Go runs on the provided runtime as a binary named bootstrap; go1.x itself is retired.
  const runtime = go ? 'provided.al2023' : config.runtime;
  const handler = go ? 'bootstrap' : config.handler;
  const properties = { CodeUri: code, Handler: handler, Runtime: runtime, Architectures: [arch] };
  const fn = {
    Type: 'AWS::Serverless::Function',
    Properties: properties,
    ...(go && { Metadata: { BuildMethod: 'go1.x' } }),
  };
  // JSON is YAML, and SAM reads it.
  const template = JSON.stringify({
    AWSTemplateFormatVersion: '2010-09-09',
    Transform: 'AWS::Serverless-2016-10-31',
    Resources: { Function: fn },
  });
  return { template, handler, runtime };
}

/** The route a call matches, and its path parameters; with no routes, every call matches. */
export function matchRoute(
  routes: string[],
  method: string,
  path: string,
): { route: string; params: Record<string, string> } | null {
  if (!routes.length) return { route: '$default', params: {} };
  for (const route of routes) {
    const [verb, given] = route.includes(' ') ? route.split(/\s+/, 2) : ['ANY', route];
    if (verb !== 'ANY' && verb?.toUpperCase() !== method) continue;
    const names: string[] = [];
    const pattern = `/${(given ?? '').replace(/^\/+|\/+$/g, '')}`
      .split('/')
      .map(part => {
        const param = /^\{(\w+)(\+?)\}$/.exec(part);
        if (!param) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        names.push(param[1] ?? '');
        return param[2] ? '(.+)' : '([^/]+)';
      })
      .join('/');
    const found = new RegExp(`^${pattern}/?$`).exec(path);
    if (found)
      return {
        route: route.includes(' ') ? route : `/${(given ?? '').replace(/^\/+|\/+$/g, '')}`,
        params: Object.fromEntries(names.map((name, at) => [name, decodeURIComponent(found[at + 1] ?? '')])),
      };
  }
  return null;
}

/** A call to the function's local address, as the HTTP server got it. */
export interface ApiRequest {
  method: string;
  /** Path and query. */
  url: string;
  /** Each header as sent, in order, repeats kept. */
  headers: [string, string][];
  body: Buffer;
  sourceIp: string;
}

const TEXT = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded)|[^;]*\+(json|xml))/i;

/** The event API Gateway sends the function for this call. */
export function apiEvent(
  api: Api,
  request: ApiRequest,
  matched: { route: string; params: Record<string, string> },
  now: Date,
  requestId: string,
): Record<string, unknown> {
  const url = new URL(request.url, 'http://localhost');
  const type = request.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? '';
  const binary = request.body.length > 0 && !!type && !TEXT.test(type);
  const body = request.body.length ? request.body.toString(binary ? 'base64' : 'utf8') : null;
  const agent = request.headers.find(([name]) => name.toLowerCase() === 'user-agent')?.[1] ?? '';
  const params = Object.keys(matched.params).length ? matched.params : null;
  const query = [...url.searchParams];
  const common = { accountId: '000000000000', apiId: 'local', domainName: 'localhost', requestId };
  if (api === 'http') {
    const headers: Record<string, string> = {};
    const cookies: string[] = [];
    for (const [name, value] of request.headers) {
      const lower = name.toLowerCase();
      if (lower === 'cookie') cookies.push(...value.split(/;\s*/).filter(Boolean));
      else headers[lower] = headers[lower] === undefined ? value : `${headers[lower]},${value}`;
    }
    const values: Record<string, string> = {};
    for (const [name, value] of query) values[name] = values[name] === undefined ? value : `${values[name]},${value}`;
    return {
      version: '2.0',
      routeKey: matched.route,
      rawPath: url.pathname,
      rawQueryString: url.search.slice(1),
      ...(cookies.length && { cookies }),
      headers,
      ...(query.length && { queryStringParameters: values }),
      ...(params && { pathParameters: params }),
      requestContext: {
        ...common,
        domainPrefix: 'localhost',
        http: {
          method: request.method,
          path: url.pathname,
          protocol: 'HTTP/1.1',
          sourceIp: request.sourceIp,
          userAgent: agent,
        },
        routeKey: matched.route,
        stage: '$default',
        time: now.toISOString(),
        timeEpoch: now.getTime(),
      },
      ...(body !== null && { body }),
      isBase64Encoded: binary,
    };
  }
  const many = (pairs: [string, string][]) => {
    const all: Record<string, string[]> = {};
    for (const [name, value] of pairs) (all[name] ??= []).push(value);
    return all;
  };
  const last = (all: Record<string, string[]>) =>
    Object.fromEntries(Object.entries(all).map(([name, values]) => [name, values.at(-1) ?? '']));
  const headers = many(request.headers);
  const values = many(query);
  return {
    resource: matched.route,
    path: url.pathname,
    httpMethod: request.method,
    headers: last(headers),
    multiValueHeaders: headers,
    queryStringParameters: query.length ? last(values) : null,
    multiValueQueryStringParameters: query.length ? values : null,
    pathParameters: params,
    stageVariables: null,
    requestContext: {
      ...common,
      resourcePath: matched.route,
      httpMethod: request.method,
      path: url.pathname,
      stage: 'local',
      protocol: 'HTTP/1.1',
      identity: { sourceIp: request.sourceIp, userAgent: agent },
      requestTimeEpoch: now.getTime(),
    },
    body,
    isBase64Encoded: binary,
  };
}

const JSON_TYPE: [string, string] = ['content-type', 'application/json'];

/** What API Gateway answers the caller with, from what the function returned. */
export function apiResponse(api: Api, result: unknown): { status: number; headers: [string, string][]; body: Buffer } {
  const answer = (result ?? {}) as Record<string, unknown>;
  if (typeof result !== 'object' || result === null || typeof answer['statusCode'] !== 'number') {
    if (api === 'rest')
      return { status: 502, headers: [JSON_TYPE], body: Buffer.from('{"message":"Internal server error"}') };
    // An HTTP API takes any other answer as the body.
    return {
      status: 200,
      headers: [JSON_TYPE],
      body: Buffer.from(typeof result === 'string' ? result : JSON.stringify(result)),
    };
  }
  const headers = new Map<string, string[]>();
  for (const [name, value] of Object.entries((answer['headers'] ?? {}) as Record<string, unknown>))
    headers.set(name, [String(value)]);
  // A REST answer's multi-value headers win over its single ones of the same name.
  for (const [name, values] of Object.entries((answer['multiValueHeaders'] ?? {}) as Record<string, unknown[]>))
    headers.set(name, values.map(String));
  const flat = [...headers].flatMap(([name, values]) => values.map((value): [string, string] => [name, value]));
  for (const cookie of api === 'http' ? ((answer['cookies'] ?? []) as unknown[]) : [])
    flat.push(['set-cookie', String(cookie)]);
  const text = typeof answer['body'] === 'string' ? answer['body'] : '';
  return {
    status: answer['statusCode'],
    headers: flat,
    body: Buffer.from(text, answer['isBase64Encoded'] === true ? 'base64' : 'utf8'),
  };
}
