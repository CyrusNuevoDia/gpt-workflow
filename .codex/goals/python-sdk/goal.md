# Python SDK goal

Make the verifier in [verifier.md](verifier.md) pass.

The end state is a synchronous, typed Python 3.12+ SDK in `sdks/python`
that wraps the synchronized `gpt-workflow` CLI, builds and installs locally,
and preserves structured run status and errors without hiding ambiguous work
or retrying automatically.

`verifier.md` is the fixed definition of done. `spec.md` records the agreed
product contract. `notes.md` records execution constraints and the TDD order.
