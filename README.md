# CT Report Review

Two workspaces share the same CT viewer. Each doctor signs in to `#/doctor` with a personal account, reviews the study CTs and rates four anonymized reports per case. A coordinator signs in to `#/admin` to see the model behind each letter, track each reader's progress and export scores and comments.

## Prepare the study

Follow [四模型盲审部署与病例导入](docs/BLIND_STUDY.md) to set up D1 and private R2 and create the first administrator. In the administrator workspace, use **Upload study** to verify the three study archives, upload scans and publish the reports. **Readers** manages individual accounts and study assignments. All readers follow the same case order and see the same four reports under the same A–D labels for each case. Administrators can edit a case before its first rating.

## Application

GitHub Pages serves the React application. A Cloudflare Worker authenticates each request, streams assigned scans from R2, and reads and writes ratings in D1. The authenticated doctor response contains anonymous reports and that doctor's own ratings. Use the coordinator workspace for unblinding.

## Develop and verify

Use Node 22.13 or later, install the locked dependencies with `npm ci`, and configure `VITE_REVIEW_API_URL` before running `npm run dev`. The deployment guide includes the local Worker and database setup.

```sh
npm test
python -B -m unittest discover -s scripts -p test_prepare_blind_study.py
npm run build
```

For deployment, configure the repository Actions variable `REVIEW_API_URL` and enable GitHub Pages with GitHub Actions as its source. The Pages workflow publishes the application bundle. Import the clinical study using the private import tool separately.
