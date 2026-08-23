# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub Security Advisories rather than opening a public issue. Include the affected URL, reproduction steps, impact, and any suggested mitigation.

## Security design

- Raw PDFs are processed locally and are not accepted by the server routes.
- Request bodies and result counts are bounded.
- Upstream requests use timeouts and fixed provider endpoints.
- No authentication secret, LLM key, or scholarly-provider key is required in the client.
- User-generated HTML is not rendered.

PaperTrail is a discovery tool. DOI links lead to third-party sites; users should verify the destination before downloading content.
