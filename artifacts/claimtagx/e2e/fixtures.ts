import { test as base, expect } from "@playwright/test";
import { installE2eStability } from "./a11y-helpers";

export const test = base.extend({
  page: async ({ page }, use) => {
    await installE2eStability(page);
    await use(page);
  },
});

export { expect };
export type { Page, APIRequestContext, Route } from "@playwright/test";
