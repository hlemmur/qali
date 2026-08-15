# Smoke suite — Sauce Demo

Generated from coverage map `Ev0BQDM3SJBG` for project `sauce-demo`.

| Test file                   | Scenario    | Requirement | Journey |
| --------------------------- | ----------- | ----------- | ------- |
| `sign-in-inventory.spec.ts` | SCN-SMK-001 | REQ-001     | JRN-001 |
| `add-to-cart.spec.ts`       | SCN-SMK-002 | REQ-002     | JRN-002 |

## Environment

- `BASE_URL` — defaults to `https://www.saucedemo.com` (D-002)
- `QALI_TEST_DATA_JSON` — `{"username":"standard_user"}` (DATA-001)
- `QALI_TEST_CREDENTIALS_JSON` — `{"password":"<secret>"}` (DATA-002, never commit)

## Run

```bash
npm install
npx playwright install chromium
npm run test:smoke
```
