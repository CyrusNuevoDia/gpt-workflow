# Codex plugin

The repository root is the `gpt-workflow` plugin root. Its manifest is
`.codex-plugin/plugin.json`, and `.agents/plugins/marketplace.json` exposes that
root as `./`.

## Install from the repository

Add the repository as a marketplace, then install the plugin by its marketplace
name:

```sh
codex plugin marketplace add CyrusNuevoDia/gpt-workflow
codex plugin add gpt-workflow@gpt-workflow
```

Restart the ChatGPT desktop app after installation and use a new task so Codex
loads the bundled skill. Use `codex plugin marketplace list` and
`codex plugin list` to inspect configured sources and installed plugins.

The plugin requires Bun, but it does not require a separate package install.
The bundled skill runs the latest published CLI with
`bunx gpt-workflow@latest`.

## Bundled skill

The `workflow` skill helps Codex:

- decide when deterministic orchestration is appropriate;
- author scripts under `.codex/workflows/`;
- run them through the CLI or library;
- resume by run ID;
- inspect past runs with `list` and `status`;
- stream and diagnose journals without loading them wholesale;
- apply runtime, failure, cap, and verification rules from its references.

The skill does not publish packages, spend live model tokens without the task
requiring a live run, or treat private Codex rollout files as the workflow
journal.

## Develop and validate

From the repository root:

```sh
python3 /path/to/plugin-creator/scripts/validate_plugin.py .
python3 /path/to/skill-creator/scripts/quick_validate.py skills/workflow
```

Use an isolated Codex home when testing marketplace installation so local
development does not alter a user's installed plugin state.
