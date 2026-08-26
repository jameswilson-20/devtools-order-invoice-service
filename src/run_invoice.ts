import { InfraiPdfClient } from "./infrai_pdf.js";
import { developerOrderSchema, issueDeveloperInvoice } from "./order_invoice.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before running the example");

const order = developerOrderSchema.parse({
  orderId: "ord_build_1042",
  customer: { name: "Clinical Platform Team", email: "platform@example.org" },
  currency: "USD",
  items: [{ description: "CI runner minutes", quantity: 120, unitAmount: 3 }],
  build: { repository: "clinical-api", commit: "8b31c5a", status: "passed" },
  release: { version: "2026.08.25", environment: "production", operation: "deploy" },
});

console.log(JSON.stringify(await issueDeveloperInvoice(order, new InfraiPdfClient(apiKey)), null, 2));
