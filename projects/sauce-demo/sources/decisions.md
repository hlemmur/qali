# Decisions

> Qali-authored governed source. Decisions are authority records; reference affected fact IDs.

## Overrides

- Allow execution with blocking questions: yes
- Approved by: Qali teammate rebuild lock
- Date: 2026-08-13
- Scope: sauce-demo first live target

## Decision Log

| ID    | Decision                                                                                                                                                        | Status    | Decided by | Source question/evidence | Date       | Affected IDs                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- | ------------------------ | ---------- | --------------------------- |
| D-002 | Live Slack target is Sauce Demo at `https://www.saucedemo.com`, not `_demo` Mock Mode.                                                                          | confirmed | human      | Q-001, Q-005             | 2026-08-13 | CTX-002, CTX-006            |
| D-003 | Demo login uses named fills. Username is `standard_user` in test data; password stays in GitHub Environment `qali-sauce-demo` and is never committed or echoed. | confirmed | human      | Q-011                    | 2026-08-13 | DATA-001, DATA-002, CTX-011 |
