import type { Page } from "@playwright/test";
import type { OutboxOperation, PreOrder } from "@/lib/db/models";

/**
 * DatabaseHelpers - Utilities to inspect IndexedDB in e2e tests
 */
export class DatabaseHelpers {
  private readonly DB_NAME = "SyncDB";

  /**
   * Get all operations from the outbox
   */
  async getOutboxOperations(page: Page): Promise<OutboxOperation[]> {
    return page.evaluate((dbName) => {
      return new Promise<any[]>((resolve, reject) => {
        const request = indexedDB.open(dbName);

        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["outbox"], "readonly");
          const store = transaction.objectStore("outbox");
          const getAllRequest = store.getAll();

          getAllRequest.onsuccess = () => {
            resolve(getAllRequest.result);
            db.close();
          };

          getAllRequest.onerror = () => {
            reject(getAllRequest.error);
            db.close();
          };
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    }, this.DB_NAME) as Promise<OutboxOperation[]>;
  }

  /**
   * Get all pre-orders from IndexedDB
   */
  async getPreOrders(page: Page): Promise<PreOrder[]> {
    return page.evaluate((dbName) => {
      return new Promise<any[]>((resolve, reject) => {
        const request = indexedDB.open(dbName);

        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["pre_orders"], "readonly");
          const store = transaction.objectStore("pre_orders");
          const getAllRequest = store.getAll();

          getAllRequest.onsuccess = () => {
            resolve(getAllRequest.result);
            db.close();
          };

          getAllRequest.onerror = () => {
            reject(getAllRequest.error);
            db.close();
          };
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    }, this.DB_NAME) as Promise<PreOrder[]>;
  }

  /**
   * Get pending operations from the outbox
   */
  async getPendingOperations(page: Page): Promise<OutboxOperation[]> {
    const allOps = await this.getOutboxOperations(page);
    return allOps.filter((op) => op.status === "pending");
  }

  /**
   * Get the count of pending operations
   */
  async getPendingCount(page: Page): Promise<number> {
    return page.evaluate((dbName) => {
      return new Promise<number>((resolve, reject) => {
        const request = indexedDB.open(dbName);

        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["outbox"], "readonly");
          const store = transaction.objectStore("outbox");

          // Try to use index if available, otherwise count manually
          let countRequest: IDBRequest<number>;
          try {
            const index = store.index("status");
            countRequest = index.count(IDBKeyRange.only("pending"));
          } catch {
            // If index doesn't exist, count manually
            const getAllRequest = store.getAll();
            getAllRequest.onsuccess = () => {
              const count = getAllRequest.result.filter(
                (op: any) => op.status === "pending",
              ).length;
              db.close();
              resolve(count);
            };
            getAllRequest.onerror = () => {
              db.close();
              reject(getAllRequest.error);
            };
            return;
          }

          countRequest.onsuccess = () => {
            resolve(countRequest.result);
            db.close();
          };

          countRequest.onerror = () => {
            db.close();
            reject(countRequest.error);
          };
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    }, this.DB_NAME);
  }

  /**
   * Get the count of syncing operations
   */
  async getSyncingCount(page: Page): Promise<number> {
    return page.evaluate((dbName) => {
      return new Promise<number>((resolve, reject) => {
        const request = indexedDB.open(dbName);

        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["outbox"], "readonly");
          const store = transaction.objectStore("outbox");

          // Try to use index if available, otherwise count manually
          let countRequest: IDBRequest<number>;
          try {
            const index = store.index("status");
            countRequest = index.count(IDBKeyRange.only("syncing"));
          } catch {
            // If index doesn't exist, count manually
            const getAllRequest = store.getAll();
            getAllRequest.onsuccess = () => {
              const count = getAllRequest.result.filter(
                (op: any) => op.status === "syncing",
              ).length;
              db.close();
              resolve(count);
            };
            getAllRequest.onerror = () => {
              db.close();
              reject(getAllRequest.error);
            };
            return;
          }

          countRequest.onsuccess = () => {
            resolve(countRequest.result);
            db.close();
          };

          countRequest.onerror = () => {
            db.close();
            reject(countRequest.error);
          };
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    }, this.DB_NAME);
  }

  /**
   * Wait for the outbox to be empty (all operations synced)
   * Polls until no pending/syncing operations remain
   */
  async waitForOutboxEmpty(page: Page, timeout: number = 30000): Promise<void> {
    await page.waitForFunction(
      (dbName) => {
        return new Promise<boolean>((resolve) => {
          const request = indexedDB.open(dbName);

          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction(["outbox"], "readonly");
            const store = transaction.objectStore("outbox");

            // Get all operations and filter by status
            const getAllRequest = store.getAll();
            getAllRequest.onsuccess = () => {
              const ops = getAllRequest.result as any[];
              const pending = ops.filter(
                (op: any) => op.status === "pending",
              ).length;
              const syncing = ops.filter(
                (op: any) => op.status === "syncing",
              ).length;
              db.close();
              resolve(pending === 0 && syncing === 0);
            };

            getAllRequest.onerror = () => {
              db.close();
              resolve(false);
            };
          };

          request.onerror = () => {
            resolve(false);
          };
        });
      },
      this.DB_NAME,
      { timeout },
    );
  }

  /**
   * Wait for sync to complete
   * Wrapper that waits for outbox to be empty and optionally for network requests
   */
  async waitForSyncToComplete(
    page: Page,
    timeout: number = 30000,
  ): Promise<void> {
    // Wait for push request to complete
    await page
      .waitForResponse(
        (response) =>
          response.url().includes("/sync/push") && response.status() === 200,
        { timeout },
      )
      .catch(() => {
        // If no push request happens (e.g., outbox already empty), continue
      });

    // Wait for outbox to be empty
    await this.waitForOutboxEmpty(page, timeout);
  }

  /**
   * Clear all data from IndexedDB
   * Clears all object stores: metadata, pre_orders, pre_order_flows, outbox, partners, products, units
   */
  async clearDatabase(page: Page): Promise<void> {
    return page.evaluate((dbName) => {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName);

        request.onsuccess = () => {
          const db = request.result;
          const objectStoreNames = [
            "metadata",
            "pre_orders",
            "pre_order_flows",
            "outbox",
            "partners",
            "products",
            "units",
          ];

          const transaction = db.transaction(objectStoreNames, "readwrite");
          let completed = 0;
          const total = objectStoreNames.length;

          const checkComplete = () => {
            completed++;
            if (completed === total) {
              db.close();
              resolve();
            }
          };

          transaction.onerror = () => {
            db.close();
            reject(transaction.error);
          };

          objectStoreNames.forEach((storeName) => {
            const store = transaction.objectStore(storeName);
            const clearRequest = store.clear();

            clearRequest.onsuccess = () => {
              checkComplete();
            };

            clearRequest.onerror = () => {
              db.close();
              reject(clearRequest.error);
            };
          });
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    }, this.DB_NAME);
  }
}
