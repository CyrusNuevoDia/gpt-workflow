# Synchronized publishing verifier

Run this verifier adversarially against the local checkout and the live GitHub,
npm, and PyPI state. For every numbered requirement, print `PASS` or `FAIL`
with concrete command, file, workflow, registry, or isolated-install evidence.
Print `OVERALL: PASS` only when every requirement passes. Otherwise print
`OVERALL: FAIL` and the smallest remaining gaps.

## Required

1. Secret hygiene is proven. Root `.gitignore` ignores `.env.ci`;
   `git check-ignore -v .env.ci` succeeds; `.env.ci` is absent from the Git
   index and every commit; no command, workflow log, commit, or final report
   exposes its value. GitHub Actions has a repository secret named
   `PYPI_TOKEN`, loaded from the local file without printing it.
2. One automated version-sync command treats root `package.json` as canonical
   and updates every Python release version source, exact runtime npm pin,
   user-facing exact pin, package-verifier expectation, and `uv.lock`. It is
   idempotent, tested, and fails clearly on malformed or missing inputs. The
   normal check rejects drift among npm, Python metadata, runtime, docs, and
   lock state.
3. Pull-request and release CI explicitly install Python 3.12 and uv in
   addition to the existing Bun, Node, and Just toolchain. They use the
   committed locks, and `just fmt` followed by `just check` passes locally and
   in GitHub Actions without model-token spend.
4. Release automation is two-pass. A run that applies Changesets synchronizes
   Python, regenerates locks, formats, checks, commits, and pushes the release
   commit, then performs no registry publication. The bot-created release
   commit triggers a new run whose checked-out `GITHUB_SHA` is exactly the
   source of all artifacts and provenance.
5. The first human push from this work to `origin/main` contains package
   version `0.3.3`. It does not overwrite, unpublish, retag, or otherwise mutate
   the existing npm `gpt-workflow@0.3.3`. No Python `0.3.3` is published merely
   to satisfy version aesthetics when its pinned npm CLI cannot support the
   public Python API.
6. A release build produces the npm tarball and Python wheel plus sdist once,
   validates all metadata, and passes isolated installed-package smokes before
   either registry mutation. Publish jobs consume those exact immutable build
   artifacts rather than rebuilding them with registry credentials.
7. Steady-state publication is ordered npm then PyPI. Existing-version handling
   is idempotent but never a blind skip: a retry proves the remote artifact is
   the expected release before continuing. PyPI authentication uses only the
   `PYPI_TOKEN` GitHub secret. Logs contain no token. A shared release tag is
   created or pushed only after both registries independently verify the same
   version.
8. The current `.changeset` ledger includes user-facing release notes for both
   the App Server controls and Python SDK. The first dual-registry release is
   `0.3.4`; all synchronized Python pins and metadata become `0.3.4` in the
   bot-created release commit while the human-authored main commit remains
   `0.3.3`.
9. Live npm independently reports `gpt-workflow@0.3.4`; live PyPI independently
   reports `gpt-workflow==0.3.4` with exactly one wheel and one sdist. Registry
   evidence is collected after the publishing workflow succeeds, not inferred
   from a green upload step or a local build.
10. In a fresh temporary Python 3.12 environment, installing
    `gpt-workflow==0.3.4` from PyPI imports as `0.3.4`, includes `py.typed`, and
    runs a deterministic no-agent workflow through
    `bunx --bun gpt-workflow@0.3.4`. The smoke exercises at least one App Server
    flag absent from npm `0.3.3`, returns the expected result and detailed
    status, and proves the durable run directory. It spends no model tokens.
11. The exact pushed `main` SHA, release commit SHA, successful CI/release runs,
    npm version, PyPI files, and shared tag are mutually consistent. Local
    `main` is fast-forwarded to the final remote state after automation settles.
    No unrequested branch, release, registry package, or CI secret is created.
12. Preserve the user's pre-existing changes in `skills/workflow/SKILL.md` and
    `skills/workflow/references/workflow-language.md`; do not stage or commit
    them. Their combined binary diff SHA-256 remains
    `6f493a78bb17d3c94e317ca504979169631ca091c809f08b1fdf3fe05ca2b277`.
    `git diff --check` passes for all authored changes.

## Explicitly out of scope

- Publishing a knowingly incompatible Python `0.3.3`.
- Rewriting or moving the existing npm `0.3.3` tags.
- Bundled Bun wheels, a `gpt-workflow[bun]` extra, or async Python APIs.
- Printing, committing, or otherwise exposing `.env.ci` contents.
