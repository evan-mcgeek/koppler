# Releasing

A version tag publishes Koppler to npm as `latest`, with provenance, and makes its GitHub Release.

From `app/`, on `main`, with nothing uncommitted and nothing to pull:

```sh
npm run release -- patch   # or minor, major, or an exact version such as 0.1.0
```

It bumps the version in `app/package.json` and its lock, commits `Koppler <version>` and tags `v<version>` on `main`, and pushes both.
Plain `npm version` is not enough here: the package is in `app/`, not at the repo's root, so npm bumps it but makes no commit or tag.

The tag starts the Release workflow (`.github/workflows/release.yml`):

1. It runs every check of the App workflow (lint, types, format, build, unit, CLI and canvas tests, the package's contents).
2. It refuses a tag that is not the version in `app/package.json`.
3. It publishes the package with `npm publish --provenance`, so npm shows the commit and the run that built it.
4. It makes the GitHub Release, with notes from the pull requests merged since the last one.

## How npm trusts the workflow

npm trusts this workflow directly (trusted publishing): no token is stored in the repo.
Set it up on npmjs.com, under the package's Settings, Trusted Publisher, GitHub Actions: owner `evan-mcgeek`, repository `koppler`, workflow `release.yml`, environment `npm`.

npm allows that only for a package that already exists.
The first version was published with a granular access token in the `NPM_TOKEN` secret of the `npm` environment; once trusted publishing is set up, delete the secret and revoke the token.
