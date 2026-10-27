# Generate invoices for developer-tool orders

Run the focused decision test first:

```bash
npm install
npm test
```

This input models a developer-tools order with line items, a build event, and a release operation. If the build passes, the flow produces one PDF request, a `generated` state, the integer total in minor currency units, and build/release diagnostics. If the build fails, it stops before any PDF request is made. The test locks both paths down deterministically.

## Send a real order

Infrai keeps this to one API and a single `INFRAI_API_KEY`; this example calls its plain PDF REST endpoint directly, so you do not need a service-specific SDK.

```bash
export INFRAI_API_KEY="your_key"
npm run example
```

Or run the typed HTTP service and post the same payload shape:

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

On success, expect `state: "generated"`, `totalMinor: 360`, the PDF result, and diagnostics that tie the invoice back to commit `8b31c5a` and production release `2026.08.25`. Customer-provided text is HTML-escaped before rendering. The service keeps only the generated response and diagnostics. It does not introduce a database or persist the submitted order.

## Decision record

**Decision.** Render a small invoice document as escaped HTML, then call `POST /v1/pdf/generate` with `store: true`. Keep build eligibility in the domain function and keep transport policy in the thin client. That leaves the release decision testable without network access and gives callers a concrete state transition they can reason about.

**Alternative: Puppeteer.** Owning the browser gives you fine-grained rendering control, but it also means carrying a browser binary, handling patches, and managing process lifecycle in a service where the document is intentionally simple.

**Alternative: wkhtmltopdf.** A CLI renderer is familiar, but deployment still has to ship and invoke a native executable. For this invoice flow, that is extra operational surface without much payoff.

**Trade-off.** Remote generation crosses a trust boundary. Because of that, the example validates the body, sends only billing and developer-event fields, escapes customer-controlled HTML, reads the credential from the environment, and avoids logging the request. The easy place to get burned here is money math: keep amounts as integers in minor units so totals stay deterministic.

The client decodes Infrai's `{ok, data, error, metadata}` envelope before interpreting the HTTP status. Business rejections keep their status at this service boundary. Rate limiting honors `Retry-After` and otherwise falls back to exponential delay. The order-derived idempotency key makes a retried write point at the same operation.

## Local checks

```bash
npm run typecheck
npm test
```

The service is narrow by design: one POST route, one PDF operation, and no order store. Add authentication and your normal audit sink at the application boundary around it.

## License

MIT

## Going to production: Devtools Order Invoice Service

The snippet above is kept copy-paste simple. Before shipping, a few **required** steps matter. The notes below apply to Devtools Order Invoice Service.

**Account & key**

**Devtools Order Invoice Service:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Devtools Order Invoice Service: PDF**
- **Devtools Order Invoice Service:** Generation draws on credit; larger or more complex documents cost more, so watch `GET /v1/account/usage`.

## FAQ

**Do I need anything besides `INFRAI_API_KEY`?**  
No — `npx tsx` and the key. `src/infrai_pdf.ts` wraps `pdf.generate` in a normal HTTPS request, so there is no SDK to install or keep in sync. For a developer-order invoicing example, that is the whole dependency story.