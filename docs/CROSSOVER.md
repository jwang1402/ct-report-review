# Radiologist review

Share the [senior reader link](https://jwang1402.github.io/ct-report-review/#/senior) with the two senior radiologists and the [junior reader link](https://jwang1402.github.io/ct-report-review/#/junior) with the three junior radiologists. Each reader enters their name. Seniors choose Study A or Study B. Juniors go directly to Study B.

Enter your name and select **Continue**. The same name in the same reader group resumes your saved work on any browser. If the name has no match, a recognized browser restores its reader’s record under the saved name. Sign out before handing a computer to someone else. This clears the browser’s reader association and keeps your study progress. Coordinators can correct a saved name in [Reader access](https://jwang1402.github.io/ct-report-review/#/admin/reader-access).

## Study A

Each senior independently rates three anonymously lettered reports for each of ten CT examinations. Each report has its own 18-finding checklist, overall quality rating and error record. Record each clinically important missed, unsupported or incorrectly located finding, including the side or location when relevant.

In [Study A results](https://jwang1402.github.io/ct-report-review/#/admin/results), the coordinator can enter the independent case reference, view progress and export reviews, individual errors or finding-level comparisons. **Show model names** reveals each case’s report key and the matched comparison across the three models. Finding-level exports distinguish a missing reference, an indeterminate finding and a confirmed absence. Reader-identified errors remain separate from checklist comparisons.

## Prepare Study B

1. In [Study B administration](https://jwang1402.github.io/ct-report-review/#/admin/study-b), open **Case configuration → Bulk upload → Choose Study B files**. Select the supplied Study B ZIP. It contains `Study_B_admin_import.json` and `images/B01.nii.gz` through `images/B10.nii.gz`. The editor matches each scan to its draft and preserves previously entered expert text. You can also select multiple individual NIfTI files or import a configuration with **Import JSON**.
2. For cases approved for sharing by link, select the public-sharing checkbox, **Connect Google Drive**, then **Choose folder**. Select a dedicated Drive folder set to **Anyone with the link → Viewer**. **Upload and verify CTs** uploads missing scans, verifies reader access, and fills the corresponding case links. Choose **Save configuration draft**. If a transfer stops, select the same package and folder to reuse completed files.
3. Add the original MORPH-CT draft, independent expert reference, and key findings. Give each reference finding and each known draft error a stable item ID so the reviewer’s final report can be assessed against it. An independent reference can describe a normal examination with no positive key findings. Record the study's case mix, reader experience, model settings, prompts and generation dates in the study records.
4. Choose **Save configuration draft** to continue later. After confirming all ten cases, choose **Freeze and open study**. Freeze locks the cases, references, and original drafts and opens the readings. Draft configuration and the expert reference are visible to coordinators.

## Study B readings and results

Each senior writes one unaided report for each CT. Each junior reads all ten CTs twice. Each junior receives five AI drafts and five blank editors in the first session. The second session reverses the condition for every case. It becomes available 28 days after the junior's final submission in the first session and requires a new name confirmation.

Opening a CT starts the server timer. Readers can save their own drafts and resume them. The clock includes image loading, breaks and editing, and stops on final submission. Open a case when ready to read it. Readers complete the present/absent checklist and specify laterality where applicable before signing the report. Final submissions are locked.

In **Readings and results**, use the independent reference to assess each final report. For each AI-assisted report, record which errors in the original draft were retained. The export includes the readings, timing, reader and case identifiers, assessments and paired analysis. Agreement uses the same cases and the same three juniors in both conditions. Reporting time uses paired readings by case and reader. Incomplete pairs and unassessed outcomes remain distinguishable from zero errors.

If practice is approved, use two separate practice examinations before timed Study B readings. Keep practice cases and submissions outside the ten scored cases.
