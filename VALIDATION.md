# Validation record — 2026-09-08

Public test site: https://jwang1402.github.io/ct-report-review/

## Verified

- Vitest: 8 tests passed (schema, asset limits, issue serialization/parser and author identity, partial-comment rule, filtering, CSV escaping, same-origin paths).
- TypeScript build passed. Vite production build passed; Cornerstone codec dependency externalization and bundle-size warnings remain.
- Synthetic NIfTI: original gzipped 96 x 96 x 64 voxel volume rendered in all three orthographic viewports in Chrome. Slice navigation and switching report tabs were exercised; slice position survived report changes. Partial decision required a comment before Submit was enabled.
- Synthetic DICOM: 32 Explicit VR Little Endian image files in a ZIP rendered as a 96 x 96 x 32 volume with 1 x 1 x 1.5 mm spacing. This required Cornerstone's supported legacy metadata provider for locally registered files.
- GitHub Actions published the fixture Release and deployed the Pages mirror. Public manifest provides same-origin imaging paths; mirrored binary length/hash is verified during synchronization.
- White/blue workbench visually inspected with the loaded NIfTI study. CT canvas backgrounds remain dark for grayscale contrast.

## Still outstanding

- A real de-identified clinical CT dataset, compressed DICOM transfer syntaxes, enhanced/multiframe DICOM and multiple real series have not been acceptance-tested.
- Actual clinician-created GitHub Issue submission, read-back on a second computer and multi-user acceptance remain to be exercised. Parser tests alone do not establish this end-to-end result.
- No 2 GiB browser-memory stress test or concurrent-user load test has been performed.
- R2 subscription/storage has not been provisioned or connected. The present site uses the approved public GitHub Pages test mirror.

Synthetic fixtures contain generated mathematical objects, not patient anatomy or actual model predictions. Passing these tests is not clinical validation.
## Google Drive samples — 2026-09-08

Official Drive API enabled in medllm. A dedicated website-restricted key is supplied through the DRIVE_PUBLIC_API_KEY Actions variable and VITE_DRIVE_API_KEY build environment, not committed in source. This is a public browser client key, visible in the built application; it has no service-account binding or private-file authorization. Allowed referrers: https://jwang1402.github.io/* and http://127.0.0.1:5173/*; API restricted to Drive only.

The three public NIfTI samples and cases.pdf all returned HTTP 200 from a credentials-omitted browser request, with exact byte lengths and SHA-256 matches. Local integrated MPR for valid_1087_a_2 rendered all three views. Source PDF links are provided; displayed report text was extracted from the supplied PDF at import time, and is not reparsed automatically when that PDF changes.

public/drive-cases/index.json contains metadata only. review_id values are stable IDs in the existing review interchange format; they are not GitHub Release IDs. Keep them unchanged when updating storage paths. New Drive uploads must be added to this index before appearing. Large-scale folder discovery/paginated catalog integration is not yet deployed. CT bytes are fetched only on selecting a case, verified, and released when switching. No real CT bytes are mirrored to GitHub by this integration.

11 unit tests pass, including corrupted/truncated response rejection; TypeScript and production build pass. Public deployment acceptance results will be recorded separately. No Cloudflare subscription opened.
