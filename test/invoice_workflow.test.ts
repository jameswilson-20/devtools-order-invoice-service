import assert from "node:assert/strict";
import test from "node:test";
import { issueDeveloperInvoice, type DeveloperOrder, type InvoicePdfPort, OrderDecisionError } from "../src/order_invoice.js";

const baseOrder: DeveloperOrder = {
  orderId: "ord_7",
  customer: { name: "Care API", email: "billing@example.org" },
  currency: "USD",
  items: [{ description: "Build minutes", quantity: 4, unitAmount: 25 }],
  build: { repository: "care-api", commit: "abc1234", status: "passed" },
  release: { version: "1.4.0", environment: "production", operation: "deploy" },
};

test("a passed build produces one invoice with traceable release diagnostics", async () => {
  const calls: Array<{ html: string; key: string }> = [];
  const client: InvoicePdfPort = {
    async generateInvoice(html, key) {
      calls.push({ html, key });
      return { accepted: true };
    },
  };

  const result = await issueDeveloperInvoice(baseOrder, client);

  assert.equal(result.state, "generated");
  assert.equal(result.totalMinor, 100);
  assert.equal(result.diagnostics.release, "1.4.0:deploy:production");
  assert.equal(calls[0]?.key, "developer-order:ord_7");
  assert.match(calls[0]?.html ?? "", /Build minutes/);
});

test("a failed build is held before PDF generation", async () => {
  let called = false;
  const client: InvoicePdfPort = {
    async generateInvoice() {
      called = true;
      return {};
    },
  };

  await assert.rejects(
    issueDeveloperInvoice({ ...baseOrder, build: { ...baseOrder.build, status: "failed" } }, client),
    OrderDecisionError,
  );
  assert.equal(called, false);
});
