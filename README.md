# CT Report Review

Doctors open `#/doctor`, enter their name and select a case from the scrollable, numerically ordered **Case workspace**. The viewer shows loading progress for the CT. Each scan has four anonymous reports (A–D), displayed and downloaded in the original English. For a public study, the reader can open the images without a Google sign-in. Each reader's current tab holds the session used to save and resume ratings.

## Prepare the study

Follow the [deployment and import guide](docs/BLIND_STUDY.md) to set up D1 and create the first administrator. Sign in at `#/admin` and open **Upload Case** to verify the study archives. For cases approved for public release, select a dedicated Google Drive folder with **Anyone with the link · Viewer**, confirm public sharing and publish. Readers see the same cases and A–D reports. Administrators can edit a case before its first rating. Under **Results**, review completed cases and individual ratings, reveal the model names for each case or remove a reader and their ratings.

## Application

GitHub Pages serves the React application. The Cloudflare Worker stores assignments, file references and ratings in D1. Drive controls access to the image files. The doctor workspace provides the assigned file link, anonymous reports and that doctor's own ratings. Coordinators can unblind the results. Sites with an existing private R2 binding can also serve scans from that bucket.

The viewer requests each public CT directly from Drive in one download. If the connection stalls or breaks, the viewer keeps the bytes it has received and requests the remainder in ranges through the review Worker. It verifies the complete file against the study checksum before displaying the scan. Set the Worker's `DRIVE_MEDIA_KEY` secret to a Drive API key that permits server-side reads of public files. The Worker uses the reader's case assignment and the study's public-access setting to authorize each request.

## Develop and verify

Use Node 22.13 or later, install the locked dependencies with `npm ci`, and configure `VITE_REVIEW_API_URL` before running `npm run dev`. The deployment guide includes the local Worker and database setup.

```sh
npm test
python -B -m unittest discover -s scripts -p test_prepare_blind_study.py
npm run build
```

For deployment, configure the repository Actions variable `REVIEW_API_URL` and enable GitHub Pages with GitHub Actions as its source. The Pages workflow publishes the application bundle. Import the clinical study using the private import tool separately.
