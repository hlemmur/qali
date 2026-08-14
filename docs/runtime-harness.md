# Runtime harness

Qali assembles a new least-privilege workspace for every agent step. The source repository remains outside the agent workspace; the host copies only declared inputs and publishes only validated staged outputs.

## Reviewed skills

Full runtime instructions live under `skills/runtime/<skill>/SKILL.md`, not the repository-level `.agents/skills` discovery path. `skills/runtime/manifest.json` pins each asset to:

- Its upstream repository, path, and 40-character commit.
- The upstream and vendored SHA-256 content hashes.
- Its vendored MIT license.
- A Qali review and approved security-audit profile.

`loadRuntimeSkillAssets()` fails closed on content drift, missing licenses, duplicate or extra assets, unapproved audits, and malformed provenance. Updating a skill requires reviewing the full new source, updating its pinned commit and hashes, and rerunning `npm run harness:validate`.

## Profiles

`harness/profiles.json` defines the selected skills, policies, templates, writable output directories, tools, mutations, and deterministic validators for 17 step-specific harnesses. Every profile includes the operating-model, evidence/provenance, and authority/autonomy policies. Only browser exploration receives the restricted `qali-browser` MCP tool; no profile receives shell access. Conditional visual generation and journey reconciliation profiles may add reviewed craft instructions and validators, but must remain authority-equivalent to their base profile. Deterministic Playwright execution uses a host-only profile with no agent skills.

Slice 4 binds workflow steps to these profile IDs. Conditional visual and journey variants remain separate profiles so selection stays typed and auditable.

## Assembled workspace

`assembleHarnessWorkspace()` creates a previously nonexistent directory containing only:

- Declared inputs under `inputs/`.
- Selected skills under `.agents/skills/`.
- Generated always-on rules under `.cursor/rules/`.
- Required templates under `templates/`.
- Generated `AGENTS.md`, `.cursor/cli.json`, and, when selected, `.cursor/mcp.json`.
- Empty declared directories under `outputs/`.
- A host-generated `harness-manifest.json` with asset hashes and a deterministic fingerprint.

All generated files and non-output directories are made read-only at the filesystem layer. Declared output directories alone remain writable. Cursor starts with kernel sandboxing enabled and without `--force`. If the kernel sandbox cannot start (typical on GitHub-hosted Ubuntu because AppArmor blocks unprivileged user namespaces), Qali retries once with `--sandbox disabled` so the CLI uses the assembled `.cursor/cli.json` allowlist (`Shell(*)` denied). Isolation remains the ephemeral workspace, read-only files, tool/MCP allowlist, and secret-filtered environment—not a caller-controlled `CURSOR_SANDBOX` variable. The browser MCP reads its secrets from a host-owned external environment file; secret values are never written into the staged workspace.

Shell commands remain host responsibilities. Deterministic host code runs Playwright, validators, fingerprinting, policy checks, and publication after the agent returns staged artifacts.

## Validation

Run:

```bash
npm run harness:validate
npm run check
```

Tests assemble every profile and compare its exact file set, reject traversal and unreviewed assets, verify deny-by-default permissions, and prove that skill, rule, template, validator, mutation, or writable-permission changes alter the manifest fingerprint.
