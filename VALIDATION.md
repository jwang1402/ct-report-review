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
