# CT Report Review

A desktop-first research application for reviewing AI-generated reports alongside original CT volumes. React, TypeScript, Vite, Cornerstone3D, GitHub Pages, Releases and Issues. No external backend or object storage.

Live: https://jwang1402.github.io/ct-report-review/

## Architecture

- GitHub Pages serves the static application and bundled imaging codecs.
- One published GitHub Release per case contains `case.json` and the original NIfTI or DICOM ZIP asset.
- The frontend discovers `case-*` releases and downloads their metadata and imaging via the public Release Asset API, using `Accept: application/octet-stream` and following redirects.
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

`src/config.ts` is the single repository configuration file. Update owner/repo there for another deployment. The Vite base is relative and routing uses HashRouter, so repository Pages URLs and direct hash routes work.

## Deployment

In the repository, enable Issues. Go to **Settings → Pages → Build and deployment → Source → GitHub Actions**. The included `.github/workflows/deploy.yml` installs locked dependencies, runs tests, builds and deploys the static `dist/` artifact. Push to `main` or manually run the workflow. Pages uses `https://<owner>.github.io/<repo>/`.

Publishing cases does not commit imaging to Git and does not rebuild the website. A published Release becomes discoverable after Refresh Cases on any computer.

## Prepare and publish a case (Computer A)

1. Open Upload Case, enter a unique case ID, name and optional context.
2. Select `.nii`, `.nii.gz`, original DICOM files, a DICOM folder or an existing DICOM ZIP. Folder paths and original bytes are preserved inside the ZIP. NIfTI files are preserved exactly.
3. Add any number of named model reports. IDs must be unique within the case. Type/paste text or import `.txt`/`.md`. Arbitrary model names are supported.
4. Confirm the dataset is public, synthetic or appropriately de-identified. Click **Prepare Case**.
5. Download both `case.json` and the prepared CT asset.
6. Click **Open GitHub Release**. The tag and title are prefilled. Attach BOTH downloaded files without changing their names. Wait for GitHub to finish uploading, then publish the release (not a draft).
7. Return to Clinical Review and refresh. An incomplete or malformed release appears in the warnings, not as a successful case.

### Why publishing happens on GitHub

The originally proposed in-browser PAT upload was changed with user approval. The Release upload host `uploads.github.com` fails the browser CORS preflight tested in September 2026. A frontend cannot override that. GitHub's own Release UI, or the local GitHub CLI, provides the upload step without an external backend. This app therefore does not solicit or store PATs and does not claim to show progress for an upload occurring on github.com. Preparation progress appears here; network upload progress is shown on GitHub.

If you prefer the CLI:

```sh
gh auth login
gh release create case-CT001-20260908 case.json CT001.nii.gz --repo jwang1402/ct-report-review --title "CT001 - Example"
```

If using a fine-grained PAT with your LOCAL CLI, scope it only to the target repository, with **Contents: read and write** for Release publishing (Metadata read is implicit). Never commit it, add it to the web build, send it to clinicians or paste it into issue content. Ordinary browser publishing uses your existing GitHub login. Public reading requires no administrator token. Clinicians need their own GitHub login and permission to create issues, not Contents write access.

## Clinical review (Computer B)

Open the same Pages URL without the administrator's credentials, then Clinical Review. Open a published case. The app downloads the complete asset from GitHub, decompresses it in memory and loads the original image values into Cornerstone3D.

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
- Release Asset CORS and redirects are controlled by GitHub. Network failures and unexpected JSON asset responses are surfaced. Anonymous public access is required for cross-device use.
- The app validates common metadata/format problems, but it is not a complete DICOM conformance validator. No de-identification is performed.
- Review issue bodies are user-editable. Invalid JSON is reported; this is a simple research database, not a tamper-proof audit system. Legacy `ct-review-v1` bodies without a Release ID are accepted by case ID for compatibility. Use unique case IDs to avoid legacy ambiguity.
- The site does not continuously poll or auto-submit issues. Refresh when another researcher publishes a case or another reviewer submits an issue.

## Validation

`npm test` checks metadata validation, asset boundaries, review round trips and identity parsing, partial comment rules, unrelated issue filtering, and CSV escaping. `npm run build` performs TypeScript compilation and a Vite production build. See `VALIDATION.md` for actual execution evidence and any outstanding real-data acceptance checks.

## Design and reuse

The compact neutral-dark workspace follows medical-imaging UI patterns from OHIF. `Resizable.tsx` adapts the OHIF resizable-panel wrapper composition, and `Tabs.tsx` adapts shadcn/ui's Radix wrapper pattern; styling is specific to this application. The Cornerstone viewer integration follows the upstream NIfTI and local DICOM examples. Source links and licenses are recorded in `THIRD_PARTY_NOTICES.md`.
