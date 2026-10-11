// For tests: a clone given as { path: text }, seen the way the kind recipes see one.
import type { RepoView } from '../kinds.ts';

export function repoOf(files: Record<string, string>): RepoView {
  const paths = Object.keys(files);
  return {
    has: path => Object.hasOwn(files, path) || paths.some(p => p.startsWith(`${path}/`)),
    read: path => files[path] ?? null,
    find: suffix => paths.some(p => p.endsWith(suffix)),
    // The names directly inside `dir` that are folders themselves.
    list: dir => {
      const depth = dir.split('/').length;
      const inside = paths.filter(p => p.startsWith(`${dir}/`) && p.split('/').length > depth + 1);
      return [...new Set(inside.map(p => p.split('/')[depth] ?? ''))];
    },
  };
}

/** One small clone per kind Koppler recognises. */
export const CLONES: Record<string, Record<string, string>> = {
  flutter: { 'pubspec.yaml': '' },
  reactnative: { 'package.json': '{"dependencies":{"expo":"~51.0.0","react":"18"}}' },
  dotnet: { 'src/Api/Api.csproj': '' },
  web: { 'package.json': '{"devDependencies":{"vite":"5"}}' },
  node: { 'package.json': '{"dependencies":{"express":"4"}}' },
  go: { 'go.mod': 'module x', 'main.go': '' },
  rust: { 'Cargo.toml': '' },
  java: { 'build.gradle.kts': 'id("org.springframework.boot")', gradlew: '' },
  python: { 'pyproject.toml': 'dependencies = ["fastapi"]', 'app/main.py': '' },
  ruby: { Gemfile: '', 'config/application.rb': '' },
  php: { artisan: '', 'composer.json': '{}' },
  compose: { 'compose.yaml': 'services:\n  api:\n    ports:\n      - "8085:80"\n' },
};
