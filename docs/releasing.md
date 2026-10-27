# Releasing

Merging a version bump releases Koppler: it is tagged, published to npm as `latest`, with provenance, and to GitHub Packages, and gets its GitHub Release.

From `app/`, with nothing uncommitted:

```sh
npm run release -- patch   # or minor, major, or an exact version such as 0.1.0
```

It bumps the version in `app/package.json` and its lock on a `release/<version>` branch from `main` as it is on GitHub, commits `Koppler <version>`, and opens its pull request.
Plain `npm version` is not enough here: the package is in `app/`, not at the repo's root, so npm bumps it but makes no commit.

Merging that pull request starts the Release workflow (`.github/workflows/release.yml`):

1. On `main`, it tags the merge commit `v<version>` and starts itself again on that tag. A change to `app/package.json` that keeps the version finds its tag there already, and releases nothing.
   The `npm` environment deploys only from `v*` tags, so publishing runs on the tag, and waits for a reviewer's approval there.
2. It publishes the package with `npm publish --provenance`, so npm shows the commit and the run that built it.
3. It publishes the same package to GitHub Packages as `@evan-mcgeek/koppler`, which lists it on the repository's page.
   GitHub Packages takes only scoped names, so npm stays the place to install from: installing from GitHub Packages needs a GitHub sign-in even for a public package.
4. It makes the GitHub Release: the install command and links to the version on npm and on GitHub Packages, then notes from the pull requests merged since the last one.

If a release stops part-way, run the workflow by hand (Actions, Release, Run workflow): on `main` it tags a version that has no tag yet, and on a `v*` tag it publishes that tag again.

## How npm trusts the workflow

npm trusts this workflow directly (trusted publishing): no token is stored in the repo.
Set it up on npmjs.com, under the package's Settings, Trusted Publisher, GitHub Actions: owner `evan-mcgeek`, repository `koppler`, workflow `release.yml`, environment `npm`.

npm allows that only for a package that already exists.
The first version was published with a granular access token in the `NPM_TOKEN` secret of the `npm` environment; once trusted publishing is set up, delete the secret and revoke the token.
