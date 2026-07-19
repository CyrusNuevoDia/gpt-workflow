# Synchronized npm and PyPI publishing goal

Make every required condition in [verifier.md](verifier.md) pass.

The end state is a safe, repeatable CI release path that versions, builds,
publishes, and independently verifies matching `gpt-workflow` releases on npm
and PyPI. The first human push to `main` remains version `0.3.3` and does not
republish or mutate npm `0.3.3`. Because the immutable npm `0.3.3` CLI lacks the
Python SDK's `models` command and newer App Server flags, the existing changeset
produces `0.3.4` as the first functionally synchronized dual-registry release.

The local `.env.ci` is secret input only. It is never committed or printed.
