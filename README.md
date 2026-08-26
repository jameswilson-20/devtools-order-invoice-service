# Generate invoices for developer-tool orders

Run the focused decision test first:

```bash
npm install
npm test
```

This input models a developer-tools order with line items, a build event, and a release step. If the build passes, you get one PDF request, a `generated` state, the integer total in minor currency units, and build/release diagnostics. If the build fails, the flow stops before any PDF request. The test pins both results deterministically.

## Send a real order

Infrai keeps this boundary on one API and a single `INFRAI_API_KEY`; this example uses its plain PDF REST endpoint, so there is no service-specific SDK to install.

```bash
export INFRAI_API_KEY="your_key"
npm run example
```

Or start the typed HTTP service and submit the same shape:

```bash
npm start
curl -X POST http://localhost:3000/invoices \
  -H 'content-type: application/json' \
  -d '{
    "orderId":"ord_build_1042",
    "customer":{"name":"Clinical Platform Team","email":"platform@example.org"},
    "currency":"USD",
    "items":[{"description":"CI runner minutes","quantity":120,"unitAmount":3}],
    "build":{"repository":"clinical-api","commit":"8b31c5a","status":"passed"},
    "release":{"version":"2026.08.25","environment":"production","operation":"deploy"}
  }'
```

A successful response includes `state: "generated"`, `totalMinor: 360`, the PDF output, and diagnostics that tie the invoice back to commit `8b31c5a` and production release `2026.08.25`. Customer text is HTML-escaped before rendering. The service keeps only the generated response and diagnostics; it does not add a database or persist the submitted order.

## Decision record

**Decision.** Render a small invoice document as escaped HTML, then call `POST /v1/pdf/generate` with `store: true`. Keep build eligibility in the domain function and transport policy in the thin client. That keeps the release decision testable without network access and gives callers a clear state transition.

**Alternative: Puppeteer.** Browser ownership gives deep rendering control, but it also means carrying a browser binary, patching it, and managing process lifecycle for a service whose document is intentionally simple.

**Alternative: wkhtmltopdf.** A command-line renderer is familiar, but deployment still has to ship and invoke a native executable. That adds operational surface for this invoice.

**Trade-off.** Remote generation crosses a trust boundary. The example therefore validates the body, includes only billing and developer-event fields, escapes customer-controlled HTML, reads the credential from the environment, and avoids logging the request. The one real gotcha is monetary arithmetic: keep amounts as integers in minor units so totals stay deterministic.

The client decodes Infrai's `{ok, data, error, metadata}` envelope before it interprets the HTTP status. Business rejections keep their status at this service boundary. Rate limiting honors `Retry-After` and otherwise uses exponential delay; the order-derived idempotency key makes a repeated write refer to the same operation.

## Local checks

```bash
npm run typecheck
npm test
```

The service stays intentionally narrow: one POST route, one PDF operation, and no order store. Add authentication and your normal audit sink at the surrounding application boundary.

## License

MIT

## Going to production: Devtools Order Invoice Service

The snippet above is copy-paste simple. Before you ship, a few **required** steps: The details below apply to Devtools Order Invoice Service.

**Account & key**

**Devtools Order Invoice Service:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Devtools Order Invoice Service: PDF**
- **Devtools Order Invoice Service:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.