import { test, expect } from '../../fixtures/base.fixture';
/**
 * Login flow — deep coverage for Sauce Demo authentication.
 * Sources: REQ-001, REQ-003, JRN-001, DATA-001, DATA-002, D-002, D-003
 */
test.describe('login flow', () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.goto();
  });
  /**
   * Scenario: SCN-LOGIN-001 — Named demo shopper reaches inventory
   * Requirement: REQ-001 | Journey: JRN-001 | Priority: P0
   */
  test('signs in with named demo account and reaches inventory @smoke', async ({
    loginPage,
    inventoryPage,
    standardUsername,
    demoPassword,
    page
  }) => {
    await test.step('submit valid credentials', async () => {
      await loginPage.login(standardUsername, demoPassword);
    });
    await test.step('verify inventory is visible', async () => {
      await expect(page).toHaveURL(/inventory\.html/);
      await expect(inventoryPage.title).toBeVisible();
      await expect(inventoryPage.addToCartButtons.first()).toBeVisible();
    });
  });
  /**
   * Scenario: SCN-LOGIN-002 — Login form is presented on landing
   * Requirement: REQ-001 | Priority: P1
   */
  test('displays username, password, and login controls on the login page @regression', async ({
    loginPage
  }) => {
    await expect(loginPage.usernameInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.loginButton).toBeVisible();
    await expect(loginPage.loginButton).toBeEnabled();
  });
  /**
   * Scenario: SCN-LOGIN-003 — Locked account cannot reach inventory
   * Requirement: REQ-003 | Priority: P0
   */
  test('rejects locked_out_user and does not reach inventory @regression', async ({
    loginPage,
    page,
    demoPassword
  }) => {
    await loginPage.login('locked_out_user', demoPassword);
    await expect(page).not.toHaveURL(/inventory\.html/);
    await expect(loginPage.errorBanner).toBeVisible();
    await expect(loginPage.errorBanner).toContainText('locked out');
    await expect(loginPage.loginButton).toBeVisible();
  });
  /**
   * Scenario: SCN-LOGIN-004 — Mismatched credentials stay on login
   * Requirement: REQ-003 | Priority: P0
   */
  test('rejects invalid password for standard_user @regression', async ({
    loginPage,
    standardUsername,
    page
  }) => {
    await loginPage.login(standardUsername, 'not-the-demo-password');
    await expect(page).not.toHaveURL(/inventory\.html/);
    await expect(loginPage.errorBanner).toBeVisible();
    await expect(loginPage.errorBanner).toContainText('do not match any user');
  });
  /**
   * Scenario: SCN-LOGIN-005 — Unknown username is rejected
   * Requirement: REQ-003 | Priority: P1
   */
  test('rejects unknown username @regression', async ({ loginPage, page, demoPassword }) => {
    await loginPage.login('nobody_on_saucedemo', demoPassword);
    await expect(page).not.toHaveURL(/inventory\.html/);
    await expect(loginPage.errorBanner).toBeVisible();
    await expect(loginPage.errorBanner).toContainText('do not match any user');
  });
  /**
   * Scenario: SCN-LOGIN-006 — Empty username blocked before inventory
   * Requirement: REQ-003 | Priority: P1
   */
  test('requires username before login @regression', async ({ loginPage, page, demoPassword }) => {
    await loginPage.fillPassword(demoPassword);
    await loginPage.submit();
    await expect(page).not.toHaveURL(/inventory\.html/);
    await expect(loginPage.errorBanner).toBeVisible();
    await expect(loginPage.errorBanner).toContainText('Username is required');
  });
  /**
   * Scenario: SCN-LOGIN-007 — Empty password blocked before inventory
   * Requirement: REQ-003 | Priority: P1
   */
  test('requires password before login @regression', async ({
    loginPage,
    standardUsername,
    page
  }) => {
    await loginPage.fillUsername(standardUsername);
    await loginPage.submit();
    await expect(page).not.toHaveURL(/inventory\.html/);
    await expect(loginPage.errorBanner).toBeVisible();
    await expect(loginPage.errorBanner).toContainText('Password is required');
  });
  /**
   * Scenario: SCN-LOGIN-008 — Both fields empty
   * Requirement: REQ-003 | Priority: P2
   */
  test('rejects empty username and password @regression', async ({ loginPage, page }) => {
    await loginPage.submit();
    await expect(page).not.toHaveURL(/inventory\.html/);
    await expect(loginPage.errorBanner).toBeVisible();
    await expect(loginPage.errorBanner).toContainText('Username is required');
  });
  /**
   * Scenario: SCN-LOGIN-009 — Alternate valid demo account reaches inventory
   * Requirement: REQ-001 | Priority: P2
   */
  test('signs in with problem_user alternate demo account @regression', async ({
    loginPage,
    inventoryPage,
    demoPassword,
    page
  }) => {
    await loginPage.login('problem_user', demoPassword);
    await expect(page).toHaveURL(/inventory\.html/);
    await expect(inventoryPage.title).toBeVisible();
    await expect(inventoryPage.addToCartButtons.first()).toBeVisible();
  });
  /**
   * Scenario: SCN-LOGIN-010 — Failed login preserves entered username
   * Requirement: REQ-003 | Priority: P2
   */
  test('retains username input after failed login @regression', async ({
    loginPage,
    standardUsername
  }) => {
    await loginPage.login(standardUsername, 'wrong-password');
    await expect(loginPage.usernameInput).toHaveValue(standardUsername);
    await expect(loginPage.errorBanner).toBeVisible();
  });
});
