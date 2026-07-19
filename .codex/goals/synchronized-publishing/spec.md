# Synchronized publishing specification

## Bootstrap boundary

The first human push to `main` is still `0.3.3`. npm `0.3.3` already exists and
is immutable. Its live CLI lacks `models` and newer App Server flags, so PyPI
must not receive a Python `0.3.3` whose exact npm pin cannot satisfy its public
contract. The existing patch changeset advances both distributions to `0.3.4`.

## Version source

Root `package.json` is canonical after `changeset version`. A repository-owned
sync command mechanically updates Python build metadata, runtime npm pin,
documentation, verifier expectations, and the uv lock. Drift is a check failure.

## Release state machine

1. Human `0.3.3` commit lands on `main`.
2. The versioning run consumes changesets, synchronizes all version sources,
   verifies the release tree, commits `0.3.4`, pushes it, and stops.
3. The `0.3.4` commit triggers a clean build run at its own `GITHUB_SHA`.
4. CI builds and validates npm and Python artifacts once without credentials.
5. npm publishes and verifies first.
6. PyPI publishes the same-version Python artifacts and verifies second.
7. CI pushes the shared tag only after both registry checks succeed.

There is no cross-registry transaction. Safe recovery is ordered and
idempotent: a retry validates any already-published artifact, then resumes the
missing side. It never treats existence alone as proof of equivalence.

## Credentials

The local `.env.ci` is ignored and never committed. Its `PYPI_TOKEN` value is
loaded into a GitHub Actions repository secret without appearing in a command
literal or output. Build and version jobs receive no PyPI credential. Only the
PyPI upload step reads the secret.
