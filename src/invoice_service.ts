import { createServer } from "node:http";
import { ZodError } from "zod";
import { InfraiError, InfraiPdfClient } from "./infrai_pdf.js";
import { developerOrderSchema, issueDeveloperInvoice, OrderDecisionError } from "./order_invoice.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the invoice service");
const pdfClient = new InfraiPdfClient(apiKey);

const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method !== "POST" || request.url !== "/invoices") {
    response.writeHead(404).end(JSON.stringify({ error: "Route not found" }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const order = developerOrderSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const outcome = await issueDeveloperInvoice(order, pdfClient);
    response.writeHead(201).end(JSON.stringify(outcome));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ZodError) {
      response.writeHead(400).end(JSON.stringify({ error: "Invalid order body" }));
    } else if (error instanceof OrderDecisionError) {
      response.writeHead(409).end(JSON.stringify({ error: error.message }));
    } else if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      response.writeHead(error.status).end(JSON.stringify({ error: error.code, details: error.details }));
    } else {
      response.writeHead(502).end(JSON.stringify({ error: "PDF generation did not complete" }));
    }
  }
});

server.listen(Number(process.env.PORT ?? 3000), () => {
  console.log(`Invoice service listening on http://localhost:${process.env.PORT ?? 3000}`);
});
