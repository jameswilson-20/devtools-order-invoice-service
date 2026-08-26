import { z } from "zod";
import type { PdfGeneration } from "./infrai_pdf.js";

export const developerOrderSchema = z.object({
  orderId: z.string().min(1).max(80),
  customer: z.object({
    name: z.string().min(1).max(120),
    email: z.string().email(),
  }),
  currency: z.string().regex(/^[A-Z]{3}$/),
  items: z.array(z.object({
    description: z.string().min(1).max(160),
    quantity: z.number().int().positive(),
    unitAmount: z.number().int().nonnegative(),
  })).min(1).max(50),
  build: z.object({
    repository: z.string().min(1).max(200),
    commit: z.string().regex(/^[a-f0-9]{7,40}$/),
    status: z.enum(["passed", "failed"]),
  }),
  release: z.object({
    version: z.string().min(1).max(50),
    environment: z.enum(["staging", "production"]),
    operation: z.enum(["deploy", "rollback"]),
  }),
});

export type DeveloperOrder = z.infer<typeof developerOrderSchema>;

export type InvoiceOutcome = {
  orderId: string;
  state: "generated";
  totalMinor: number;
  pdf: PdfGeneration;
  diagnostics: {
    build: string;
    release: string;
  };
};

export interface InvoicePdfPort {
  generateInvoice(html: string, idempotencyKey: string): Promise<PdfGeneration>;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
}[character] ?? character));

export async function issueDeveloperInvoice(
  order: DeveloperOrder,
  pdfClient: InvoicePdfPort,
): Promise<InvoiceOutcome> {
  if (order.build.status !== "passed") {
    throw new OrderDecisionError("Invoice held: the referenced build did not pass");
  }

  const totalMinor = order.items.reduce(
    (sum, item) => sum + item.quantity * item.unitAmount,
    0,
  );
  const rows = order.items.map((item) =>
    `<tr><td>${escapeHtml(item.description)}</td><td>${item.quantity}</td><td>${item.unitAmount}</td></tr>`,
  ).join("");
  const html = `<!doctype html><html><body><h1>Invoice ${escapeHtml(order.orderId)}</h1><p>${escapeHtml(order.customer.name)} (${escapeHtml(order.customer.email)})</p><table><thead><tr><th>Item</th><th>Qty</th><th>Unit amount</th></tr></thead><tbody>${rows}</tbody></table><p>Total: ${totalMinor} ${order.currency} minor units</p><hr><p>Build ${escapeHtml(order.build.commit)}: passed</p><p>Release ${escapeHtml(order.release.version)}: ${order.release.operation} to ${order.release.environment}</p></body></html>`;
  const pdf = await pdfClient.generateInvoice(html, `developer-order:${order.orderId}`);

  return {
    orderId: order.orderId,
    state: "generated",
    totalMinor,
    pdf,
    diagnostics: {
      build: `${order.build.repository}@${order.build.commit}:passed`,
      release: `${order.release.version}:${order.release.operation}:${order.release.environment}`,
    },
  };
}

export class OrderDecisionError extends Error {}
