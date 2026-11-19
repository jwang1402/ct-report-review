# CT Report Review

Doctors open `#/doctor`, enter their name and rate four anonymous reports per CT. For studies opened to the public, the viewer loads the approved images without a Google sign-in. Each reader's current tab holds the session used to save and resume ratings. Coordinators sign in to `#/admin` to publish studies and see ratings, comments and model names.

## Prepare the study

Follow [四模型盲审部署与病例导入](docs/BLIND_STUDY.md) to set up D1 and create the first administrator. For cases approved for public release, create a dedicated Google Drive folder with **Anyone with the link · Viewer**. On **Upload Case**, verify the study archives, confirm public sharing and publish. Readers see the same cases and A–D reports. Administrators can edit a case before its first rating. **Results** shows completed cases and individual ratings by reader. **Show model names** reveals the mapping for each case.

## Application

GitHub Pages serves the React application. The Cloudflare Worker stores assignments, file references and ratings in D1. Drive controls access to the image files. The doctor workspace provides the assigned file link, anonymous reports and that doctor's own ratings. Coordinators can unblind the results. Sites with an existing private R2 binding can also serve scans from that bucket.

## Develop and verify

Use Node 22.13 or later, install the locked dependencies with `npm ci`, and configure `VITE_REVIEW_API_URL` before running `npm run dev`. The deployment guide includes the local Worker and database setup.

```sh
npm test
python -B -m unittest discover -s scripts -p test_prepare_blind_study.py
npm run build
```

For deployment, configure the repository Actions variable `REVIEW_API_URL` and enable GitHub Pages with GitHub Actions as its source. The Pages workflow publishes the application bundle. Import the clinical study using the private import tool separately.
