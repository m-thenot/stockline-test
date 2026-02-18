import type { Page } from "@playwright/test";

/**
 * NetworkSimulator - Controls network state in e2e tests
 */
export class NetworkSimulator {
  private isOffline = false;

  /**
   * Set the page to offline mode
   */
  async setOffline(page: Page): Promise<void> {
    if (this.isOffline) {
      return; // Already offline
    }

    this.isOffline = true;
    await page.context().setOffline(true);
    await page.waitForFunction(() => navigator.onLine === false);
  }

  /**
   * Set the page to online mode
   */
  async setOnline(page: Page): Promise<void> {
    if (!this.isOffline) {
      return; // Already online
    }

    this.isOffline = false;
    await page.context().setOffline(false);
    await page.waitForFunction(() => navigator.onLine === true);
  }

  /**
   * Reset network state (cleanup)
   */
  async reset(page: Page): Promise<void> {
    if (this.isOffline) {
      await this.setOnline(page);
    }
  }
}
