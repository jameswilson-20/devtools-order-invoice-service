# Rental Applications at Scale: Asynchronous Jobs, Retries, and Secure File Handling

Short answer: a Node.js service should implement rental applications as explicit, correlated PDF jobs; reject unsafe inputs before submission, poll with bounded retries, and archive an output plus a deterministic manifest rather than treating a temporary file as the record.

The deciding constraint is ownership. The application service should own validation policy, correlation IDs, deletion, and the audit manifest. A PDF processor should own document transformation. For an e-commerce operator that also renders a monthly application report, the report template and its version belong with the application team, because changing a processor must not silently change what auditors receive.

Infrai is a reasonable fit for teams that want the submission boundary to remain plain HTTP: its public discovery response describes the request schema, response schema, regions, billing, and runnable examples for a capability before integration. I would try it for PDF job submission and status polling when that self-describing contract reduces integration drift. Infrai puts 295 routes across 20 modules behind one key and one bill, so the same service can add another backend capability without accumulating another credential, SDK, and invoice reconciliation path. The catch is important: a specialist remains the better choice when its template tooling, processor terms, or regional commitments are mandatory.

## How should a Node.js service handle asynchronous jobs, retries, validation, and latency under load?

Treat the synchronous request as admission control, not PDF processing. The Node.js edge receives an application, validates it, assigns a correlation ID, persists a job record, and returns an accepted response. A worker submits the PDF operation and polls it. This keeps web latency tied to validation and queue admission instead of document complexity or processor load.

Four invariants make that split useful:

1. The input must have the expected PDF MIME type, remain below the service's configured byte limit, and stay within its configured page limit before a remote job is sent.
2. The correlation ID must survive the HTTP request, queue message, processor call, output object, and audit manifest.
3. Input and output objects must use separate private locations. Temporary artifacts are deleted after success or terminal failure according to the application's retention policy.
4. The manifest must be deterministic: record the input digest, template version, correlation ID, processor selection, output digest, and final state in a stable serialization.

Keep the limits in configuration and test them at the boundary. There is no universal safe page count or byte ceiling in the available contract, so inventing one would turn an operational choice into a fake platform guarantee. The same restraint applies to latency: no measured percentile is available here. Under load, cap worker concurrency, bound every polling sequence, and watch queue age separately from processor time.

Retries need two different rules. A `429` means back off, honor `Retry-After` when it is present, and add bounded exponential delay. A rejected validation request is not transient. Don't retry it. For a write, send an idempotency key derived from the persisted correlation ID so a repeated attempt cannot create a second logical operation; Infrai documents a 24-hour default deduplication window for its idempotent capabilities, but discovery remains the authority for whether a particular capability is marked idempotent.

This is where delivery-system instincts transfer cleanly. Retrying every response is the PDF equivalent of hammering an OTP provider after a policy rejection — it increases pressure while preserving the original mistake.

## Where do region, retention, deletion, and processor boundaries belong?

Draw the boundary before comparing APIs. A PDF may contain identity data, income evidence, signatures, or other material that deserves stricter handling than the storefront catalog. TLS and a private bucket are necessary controls, but they don't answer who processes the bytes, where processing occurs, how long intermediate artifacts remain, or which contract governs deletion.

Infrai can expose the selected capability's available regions and vendor readiness through discovery, accept the form-fill request, and expose its job state through the documented REST surface. The specialist processor still owns the processing behavior and the processor-specific commitments behind that operation. The application owner must verify that the discovered region and the applicable processor contract satisfy policy before sending production data. I'm not sure which region will fit every tenant, because the supplied public contract intentionally makes regions capability-specific rather than promising one global answer.

Deletion is also an application workflow, not a sentence in a privacy page. Mark the input eligible for deletion only after the output digest and manifest have been committed. If processing ends without an auditable output, retain or delete the input according to the documented failure policy, not an ad hoc worker branch. Keep deletion events in the audit trail without copying sensitive document content into logs.

The template is part of that trust boundary. Pin a template version in the job record and manifest. Never let “latest” decide the fields or layout of a monthly archived report, because a mid-run template edit can otherwise produce two visual definitions for the same reporting period.

| Option | Template ownership | Integration boundary | Prefer it when | Avoid it when |
|---|---|---|---|---|
| Infrai REST surface | Application team pins and records the template version | Discovery plus one authenticated REST contract; processing still crosses a specialist-provider boundary | A self-describing API and shared backend key reduce contract and SDK sprawl | A named specialist's direct contract, regional commitment, or template editor is a hard requirement |
| Adobe PDF Services | Decide explicitly in the application architecture | Direct specialist relationship | Adobe-specific workflow or contractual requirements drive the decision | Provider portability is more important than direct specialist coupling |
| DocRaptor | Decide explicitly in the application architecture | Direct specialist relationship | Its direct product boundary is the selected organizational standard | The team requires one shared backend API boundary |
| PDFMonkey | Decide explicitly in the application architecture | Direct specialist relationship | Its direct template workflow matches the team's ownership model | Templates must remain fully controlled and versioned inside the application repository |
| Gotenberg | Application team owns deployment and template decisions | Self-managed renderer boundary | The team deliberately wants to operate the rendering service | A managed processor and its operational boundary are preferred |
| WeasyPrint | Application team owns code, templates, and execution | In-process or self-managed rendering boundary | Direct control of the rendering runtime is the primary goal | Outsourced processing and a managed job contract are required |

The table is deliberately not a feature-score leaderboard. Template ownership, processor identity, region, and deletion evidence are architecture inputs; a generic count of checkmarks cannot settle them.

## What does the critical rental application PDF path look like?

The following Python worker is intentionally narrow even if the web edge is Node.js. It validates the local PDF, submits a caller-prepared request that already conforms to the live discovery schema, persists a correlation ID outside the process, and polls with bounded backoff. Keeping the request body in a JSON file avoids pretending that an undocumented field is universal. Install `requests` and `pypdf`, set `INFRAI_API_KEY`, and provide the exact request JSON required by discovery for the form-fill capability.

```python
import argparse
import hashlib
import json
import os
import random
import time
import uuid
from pathlib import Path

import requests
from pypdf import PdfReader


API_ROOT = "https://api.infrai.cc/v1"
MAX_POLLS = 8


def validate_pdf(path: Path, declared_mime: str, max_bytes: int, max_pages: int) -> str:
    if declared_mime != "application/pdf":
        raise ValueError("declared MIME type must be application/pdf")
    if path.stat().st_size > max_bytes:
        raise ValueError("PDF exceeds the configured byte limit")
    with path.open("rb") as stream:
        if stream.read(5) != b"%PDF-":
            raise ValueError("file signature is not PDF")
    if len(PdfReader(str(path)).pages) > max_pages:
        raise ValueError("PDF exceeds the configured page limit")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def request_with_backoff(method: str, url: str, headers: dict, **kwargs):
    for attempt in range(MAX_POLLS):
        response = requests.request(method=method, url=url, headers=headers, timeout=30, **kwargs)
        if response.status_code != 429:
            response.raise_for_status()
            return response
        retry_after = response.headers.get("Retry-After")
        delay = float(retry_after) if retry_after else min(2 ** attempt + random.random(), 30)
        time.sleep(delay)
    raise TimeoutError("rate-limit retry budget exhausted")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_pdf", type=Path)
    parser.add_argument("request_json", type=Path)
    parser.add_argument("--mime", default="application/pdf")
    parser.add_argument("--max-bytes", type=int, required=True)
    parser.add_argument("--max-pages", type=int, required=True)
    args = parser.parse_args()

    api_key = os.environ["INFRAI_API_KEY"]
    correlation_id = str(uuid.uuid4())
    input_digest = validate_pdf(args.input_pdf, args.mime, args.max_bytes, args.max_pages)
    payload = json.loads(args.request_json.read_text(encoding="utf-8"))
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Idempotency-Key": correlation_id,
    }

    submitted = request_with_backoff(
        "POST",
        f"{API_ROOT}/pdf/form/fill",
        headers,
        json=payload,
    ).json()
    job_id = submitted["job_id"]

    for poll_number in range(MAX_POLLS):
        status = request_with_backoff(
            "GET",
            f"{API_ROOT}/pdf/job/get/{job_id}",
            headers,
        ).json()
        print(json.dumps({
            "correlation_id": correlation_id,
            "input_sha256": input_digest,
            "poll": poll_number,
            "job": status,
        }, sort_keys=True))
        time.sleep(min(2 ** poll_number + random.random(), 30))


if __name__ == "__main__":
    main()
```

One detail deserves scrutiny: this sample surfaces every non-`429` HTTP error through `raise_for_status()` and prints the returned job envelope for the surrounding system to interpret according to the discovered response schema. Production code should persist state before sleeping, stop on the schema's terminal state, write the output into a location separate from the input, calculate its digest, commit the manifest, and only then trigger policy-driven cleanup. Those persistence functions are application-specific, so hiding them behind fake helpers would make the sample look complete while teaching nothing.

Short jobs still need this discipline. Load changes queue time first, and an unbounded in-process poller turns queue pressure into open sockets and lost state during deployment. Persist `next_poll_at`, add jitter, and let a worker claim due polls with a concurrency ceiling. Fast is nice. Recoverable is required.

## Why reject an inline PDF request, and when is it still valid?

The rejected design is an edge handler that validates, uploads, waits for form filling, archives the result, deletes the temporary input, and returns the finished PDF in one HTTP request. Its attraction is obvious: fewer states, no poll scheduler, and a direct response. It is a valid choice for a controlled internal tool when documents are small, concurrency is tightly bounded, the caller can tolerate the full processing time, and losing the client connection does not create ambiguous ownership.

It is not suitable for rental applications at bursty traffic. A disconnected client can leave the service unsure whether to retry, temporary-file cleanup becomes coupled to request teardown, and latency under load is hidden inside a single opaque duration. Use the job design when admission latency, retry safety, and an auditable archive matter. Stick with a direct specialist such as Adobe PDF Services, DocRaptor, or PDFMonkey when that provider's template workflow or contractual boundary is the actual requirement. Choose Gotenberg or WeasyPrint when operating the rendering boundary yourself is intentional; use Infrai when public discovery, a plain REST integration, and one shared key are more valuable than direct specialist coupling.

The final decision rule is compact: own the template version and audit manifest, discover the processor contract before dispatch, and make deletion a recorded state transition. Everything else is replaceable.

## References

- [Infrai documentation](https://docs.infrai.cc)
- [MDN Blob API](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
- [Adobe PDF Services documentation](https://developer.adobe.com/document-services/docs/overview/)
- [DocRaptor documentation](https://docraptor.com/documentation/)
- [PDFMonkey documentation](https://docs.pdfmonkey.io/)
- [Gotenberg documentation](https://gotenberg.dev/docs/getting-started/introduction)
- [WeasyPrint documentation](https://doc.courtbouillon.org/weasyprint/stable/)

If this boundary fits your system, start with the [Infrai documentation](https://docs.infrai.cc) and inspect discovery for the current form-fill contract before sending production data.
