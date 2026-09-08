# CT Report Review

A desktop-first research application for reviewing AI-generated reports alongside original CT volumes. React, TypeScript, Vite, Cornerstone3D, GitHub Pages, Releases and Issues. No external backend or object storage.

Live: https://jwang1402.github.io/ct-report-review/

## Architecture

- GitHub Pages serves the static application and bundled imaging codecs.
- One published GitHub Release per case contains `case.json` and the original NIfTI or DICOM ZIP asset.
- GitHub Actions discovers `case-*` releases, downloads case.json and CT files server-side, validates size/SHA-256 and copies them into the Pages deployment artifact. Browsers read `data/index.json` and original imaging bytes from the same Pages origin. No large imaging files are committed to Git.
- Review submissions open GitHub's new-issue page with a human-readable summary and structured `ct-review-v1` JSON block. The clinician submits the issue while logged into GitHub.
- Results are read from public GitHub Issues. The issue author supplies the reviewer identity. Each issue remains independent; no consensus is inferred.
- Case and issue lists are cached in memory. Manual refresh queries GitHub again. A selected CT is retained while switching reports and released when closing the case.

## Local development

Requires Node 22 or newer and npm.

```sh
npm ci
npm run dev
npm test
npm run build
```

`github.config.json` is the single repository configuration file. `src/config.ts` imports it for the application. Update owner/repo there for another deployment. The Vite base is relative and routing uses HashRouter, so repository Pages URLs and direct hash routes work.

## Deployment

In the repository, enable Issues. Go to **Settings → Pages → Build and deployment → Source → GitHub Actions**. The included `.github/workflows/deploy.yml` installs locked dependencies, runs tests, builds and deploys the static `dist/` artifact. Push to `main` or manually run the workflow. Pages uses `https://<owner>.github.io/<repo>/`.

For this temporary test architecture, publishing/editing/deleting a Release triggers the Pages workflow. The workflow rebuilds the frontend and mirrors all published cases into its static artifact. A new case becomes visible to every computer AFTER this deployment completes. Refresh Cases reads the new same-origin index. This deliberately replaces the original no-rebuild requirement with the user-approved Pages mirror approach. The original CT remains in Releases.

## Prepare and publish a case (Computer A)

1. Open Upload Case, enter a unique case ID, name and optional context.
2. Select `.nii`, `.nii.gz`, original DICOM files, a DICOM folder or an existing DICOM ZIP. Folder paths and original bytes are preserved inside the ZIP. NIfTI files are preserved exactly.
3. Add any number of named model reports. IDs must be unique within the case. Type/paste text or import `.txt`/`.md`. Arbitrary model names are supported.
4. Confirm the dataset is public, synthetic or appropriately de-identified. Click **Prepare Case**.
5. Download both `case.json` and the prepared CT asset.
6. Click **Open GitHub Release**. The tag and title are prefilled. Attach BOTH downloaded files without changing their names. Wait for GitHub to finish uploading, then publish the release (not a draft).
7. Wait for **Actions → Deploy CT Report Review** to finish successfully, then return to Clinical Review and refresh. An incomplete or malformed release appears in synchronization warnings, not as a successful case. If assets were changed after publication, run Deploy CT Report Review manually because asset-only changes may not generate a Release event.

### Why publishing happens on GitHub

The originally proposed in-browser PAT upload was changed with user approval. The Release upload host `uploads.github.com` fails the browser CORS preflight tested in September 2026. A frontend cannot override that. GitHub's own Release UI, or the local GitHub CLI, provides the upload step without an external backend. This app therefore does not solicit or store PATs and does not claim to show progress for an upload occurring on github.com. Preparation progress appears here; network upload progress is shown on GitHub.

If you prefer the CLI:

```sh
gh auth login
gh release create case-CT001-20260908 case.json CT001.nii.gz --repo jwang1402/ct-report-review --title "CT001 - Example"
```

If using a fine-grained PAT with your LOCAL CLI, scope it only to the target repository, with **Contents: read and write** for Release publishing (Metadata read is implicit). Never commit it, add it to the web build, send it to clinicians or paste it into issue content. Ordinary browser publishing uses your existing GitHub login. Public reading requires no administrator token. Clinicians need their own GitHub login and permission to create issues, not Contents write access.

## Clinical review (Computer B)

Open the same Pages URL without the administrator's credentials, then Clinical Review. Open a published case. The app downloads the complete synchronized asset from the same Pages origin, decompresses it in memory and loads the original image values into Cornerstone3D.

- Axial, sagittal and coronal MPR viewports with wheel scrolling and individual slice sliders.
- Window/level, pan, zoom, reset and soft tissue/lung/bone/brain presets.
- For multiple DICOM series the app lists every readable series. Choose the required series; the default is the one with most frames. No source images are converted to screenshots.
- Report tabs are outside the viewer lifecycle. Switching models preserves slices, camera and window/level.
- Download Original CT links to the exact original Release asset. Download Report saves complete report text.

For each report choose Accept, Reject or Partial. Partial requires a nonempty comment. Local choices are saved per repository, Release and report in browser localStorage. Submit Review opens a NEW GitHub issue tab; the reviewer must click GitHub's Create/Submit button. The local status becomes Pending GitHub Submission. Refresh Reviews confirms Submitted only when the exact submission ID, Release, report, decision and comment appear in an actual issue. Opening a tab is not counted as a successful submission.

If the issue URL would be too long, a Markdown body is downloaded. Paste the full body into the opened issue, keeping the JSON block intact. Other reviewers' submissions appear independently.

## Results and exports

Results groups issues by case/Release and model report. It shows counts of Accept, Reject and Partial, individual authors and comments, and links to each issue. JSON and CSV exports contain only data read from GitHub Issues. CSV includes case_id, case_name, report_id, model_name, reviewer, decision, comment, created_at and github_issue_number. Cells that could be interpreted as spreadsheet formulas are escaped.

## Constraints and limits

- **Research only.** Public repository assets and review comments are publicly accessible. This prototype does not provide HIPAA infrastructure or a diagnostic workflow.
- Each asset must be smaller than 2 GiB; browsers may run out of memory on substantially smaller datasets. ZIP preparation, full-volume decompression and rendering need additional RAM. Expanded DICOM datasets and NIfTI volumes are limited to 2 GiB in this implementation; use a sufficiently capable desktop and WebGL2 browser.
- NIfTI volume loader support targets ordinary 3D volumes. Specialized 4D, non-volumetric, segmentation, irregularly spaced or unsupported DICOM encodings may not render correctly. Review the displayed series and geometry; there is no advanced annotation/segmentation.
- DICOM non-image files are ignored for rendering but remain in the original ZIP. Multiple series remain independently selectable. Unsupported files yield a visible error instead of a fake CT image.
- Public GitHub REST access typically has a 60 requests/hour per-IP limit. Pagination and metadata downloads consume requests. Manual refresh avoids aggressive polling; Settings shows the latest available remaining count. The API reports reset time when exhausted.
- The Release upload AND download hosts do not provide the cross-origin response headers needed by this browser workflow. Actions performs Release downloads server-side, then Pages serves the bytes without a cross-origin request. An extra .bin suffix on mirrored filenames prevents web servers interpreting .nii.gz as HTTP Content-Encoding; the bytes remain identical and the original filename stays in metadata.
- The app validates common metadata/format problems, but it is not a complete DICOM conformance validator. No de-identification is performed.
- Review issue bodies are user-editable. Invalid JSON is reported; this is a simple research database, not a tamper-proof audit system. Legacy `ct-review-v1` bodies without a Release ID are accepted by case ID for compatibility. Use unique case IDs to avoid legacy ambiguity.
- The site does not continuously poll or auto-submit issues. Refresh when another researcher publishes a case or another reviewer submits an issue.

## Validation

`npm test` checks metadata validation, asset boundaries, review round trips and identity parsing, partial comment rules, unrelated issue filtering, and CSV escaping. `npm run build` performs TypeScript compilation and a Vite production build. See `VALIDATION.md` for actual execution evidence and any outstanding real-data acceptance checks.

## Design and reuse

The compact neutral-dark workspace follows medical-imaging UI patterns from OHIF. `Resizable.tsx` adapts the OHIF resizable-panel wrapper composition, and `Tabs.tsx` adapts shadcn/ui's Radix wrapper pattern; styling is specific to this application. The Cornerstone viewer integration follows the upstream NIfTI and local DICOM examples. Source links and licenses are recorded in `THIRD_PARTY_NOTICES.md`.

## Temporary Pages mirror and capacity

This deployment is a PUBLIC TEST SITE, not the final production architecture. Its fixed address is https://jwang1402.github.io/ct-report-review/ and other users do not need access to the developer computer.

- Default total imaging budget: 800,000,000 bytes, configured by `pagesMirrorBudgetBytes` in `github.config.json`.
- The script permits raising that test budget to at most 900,000,000 bytes and separately protects the entire generated site at 950,000,000 bytes, leaving margin below GitHub Pages' 1 GB site limit.
- If capacity would be exceeded, the job fails before downloading imaging and before deployment. The previous successfully deployed site remains available. Check the Actions log for the required size.
- Synchronization runs on code pushes, published/edited/deleted Releases, manual workflow dispatch, and completion of the synthetic fixture workflow. Upload both assets before publishing. Manually rerun the deployment after asset-only changes if no automatic run starts.
- Every published case is mirrored. To retire test data, remove the case Release or change its case tag outside the `case-` pattern, then run synchronization; do not remove real data without maintaining its original backup.
- No separate storage provider, server, database or write token in the web application is introduced. GitHub Actions uses its job-scoped built-in token.
- `npm run dev` requires local mirror data for the case list. Generate it with `node scripts/sync-pages-cases.mjs public`. `public/data` is ignored by Git; the cloud workflow mirrors into `dist` AFTER the production build.
- To generate the provided explicitly labeled synthetic test case, run the **Publish synthetic validation case** Actions workflow. It creates a NIfTI phantom in a Release without committing binary imaging to Git. It never changes an existing fixture Release.

### Later expansion

Raising an application threshold does not raise the GitHub Pages platform limit. For larger studies or a growing case library, migrate imaging delivery to storage that supports browser CORS or to a streaming service. Keep the current Cornerstone viewer and report-review UI. Replace the case-source implementation in `src/services/github/releases.ts` and the mirror deployment script; the Review/Issue schema is independent of image storage. Do not use multiple Pages sites to evade platform limits.

GitHub Pages documentation: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits