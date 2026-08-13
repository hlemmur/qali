# Test Data

> Qali-authored governed source. Store synthetic values or secret references only—never credentials.

| ID       | Purpose                  | Data or secret reference                                    | Reset strategy | Status    | Source | Date       |
| -------- | ------------------------ | ----------------------------------------------------------- | -------------- | --------- | ------ | ---------- |
| DATA-001 | Happy-path demo username | `standard_user` via `QALI_TEST_DATA_JSON.username`          | none           | confirmed | D-003  | 2026-08-13 |
| DATA-002 | Happy-path demo password | named credential `password` in `QALI_TEST_CREDENTIALS_JSON` | none           | confirmed | D-003  | 2026-08-13 |

Tests and scenarios reference data IDs rather than duplicating account or fixture details.
