# Runtime skill security review

Reviewed 2026-08-12 by Qali against `markdown-instructions-v1`.

- Assets are Markdown instructions only; no executable files, hooks, or bundled scripts are selected.
- External links and example commands are untrusted reference material and do not grant network or shell access.
- Runtime policies override upstream examples that mention credentials, cookies, tokens, uploads, browser automation, or external services.
- The assembled agent environment excludes target credentials and Slack, GitHub, and publication secrets.
- Browser work is available only through Qali's restricted MCP facade; shell is denied.
- Every asset is pinned to an upstream commit and SHA-256 content hash. A content change invalidates assembly until reviewed and re-pinned.
