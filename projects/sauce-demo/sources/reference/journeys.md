# User Journeys

> Qali-authored governed source. Reference requirement IDs instead of restating their facts.

## JRN-001: Sign in and view inventory

- Actor: named demo shopper (`DATA-001`)
- Goal: reach the product inventory after login
- Preconditions: public origin `https://www.saucedemo.com` is reachable; named credentials are configured in `qali-sauce-demo`
- Steps: open the login page; fill the named username; fill the named password; submit Login
- Outcome: inventory of products is visible
- Requirement links: REQ-001
- Status: inferred
- Source: https://www.saucedemo.com
- Date: 2026-08-13

## JRN-002: Add a product to the cart

- Actor: authenticated demo shopper
- Goal: place one inventory item in the cart
- Preconditions: JRN-001 succeeded
- Steps: choose a product; add it to the cart; open the cart
- Outcome: the selected product is listed in the cart
- Requirement links: REQ-002
- Status: inferred
- Source: https://www.saucedemo.com
- Date: 2026-08-13
