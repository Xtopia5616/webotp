import { expect, test } from "@playwright/test";

test("homepage has title and links to login", async ({ page }) => {
  await page.goto("/");

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/WebOTP/);

  // Check for the "Get Started" button which leads to login
  await expect(
    page.getByRole("button", { name: /Get Started/i }),
  ).toBeVisible();
});

test("login page loads and shows form", async ({ page }) => {
  await page.goto("/login");

  // Check for email input
  await expect(page.getByLabel(/Email/i)).toBeVisible();

  // Check for password input
  await expect(page.getByLabel(/Password/i)).toBeVisible();

  // Check for submit button
  await expect(
    page.getByRole("button", { name: /Unlock Vault/i }),
  ).toBeVisible();
});
