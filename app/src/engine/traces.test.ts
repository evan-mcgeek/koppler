import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { noTraces } from './traces.ts';

const repo = (files: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koppler-traces-'));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  return dir;
};
const api = { kind: 'dotnet', project: 'src/Orders.Api' };
const csproj = (inner: string) => `<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup>${inner}</ItemGroup></Project>`;

test('a .NET app with no OpenTelemetry package anywhere it is built from sends no traces, and says what to add', () => {
  const dir = repo({ 'src/Orders.Api/Orders.Api.csproj': csproj('<PackageReference Include="Serilog" />') });
  expect(noTraces(api, dir)).toMatch(
    /^no OpenTelemetry package in src\/Orders\.Api\/Orders\.Api\.csproj .*OpenTelemetry\.Exporter\.OpenTelemetryProtocol/,
  );
});

test('one in its project, a project it references, or the repo-wide props is enough', () => {
  const own = repo({
    'src/Orders.Api/Orders.Api.csproj': csproj('<PackageReference Include="OpenTelemetry.Extensions.Hosting" />'),
  });
  expect(noTraces(api, own)).toBeNull();
  const referenced = repo({
    'src/Orders.Api/Orders.Api.csproj': csproj('<ProjectReference Include="..\\Shared\\Shared.csproj" />'),
    'src/Shared/Shared.csproj': csproj('<PackageReference Include="OpenTelemetry" />'),
  });
  expect(noTraces(api, referenced)).toBeNull();
  const props = repo({
    'src/Orders.Api/Orders.Api.csproj': csproj(''),
    'Directory.Packages.props':
      '<Project><ItemGroup><PackageVersion Include="OpenTelemetry" Version="1.9.0" /></ItemGroup></Project>',
  });
  expect(noTraces(api, props)).toBeNull();
});

test('a Node app needs an @opentelemetry package; for other kinds Koppler does not tell', () => {
  expect(noTraces({ kind: 'node' }, repo({ 'package.json': '{"dependencies":{"express":"4"}}' }))).toMatch(
    /@opentelemetry/,
  );
  expect(
    noTraces({ kind: 'node' }, repo({ 'package.json': '{"dependencies":{"@opentelemetry/sdk-node":"0.5"}}' })),
  ).toBeNull();
  expect(noTraces({ kind: 'other' }, repo({}))).toBeNull();
  expect(noTraces({ kind: 'dotnet', project: 'missing' }, repo({}))).toMatch(/^no OpenTelemetry package/);
});
