# Login and review service

Cloudflare Workers + D1 stores server sessions and clinician reviews. The browser uses a short-lived opaque token and revalidates every route. The shared account is for prototype access; a typed doctor name is self-reported, not verified identity.

## Deployment

1. Create D1 `ct-report-reviews`; replace `REPLACE_AFTER_CREATION` in `wrangler.jsonc` with its ID.
2. Apply `schema.sql` to D1.
3. Set `PASSWORD_SALT` and `PASSWORD_HASH` as Worker secrets. Hash the chosen password with `passwordHash` from `worker.mjs`; do not put a password or hash in the client or Git repository.
4. Deploy `ct-report-review-api` with its DB binding. Stay on Workers Free.
5. Set GitHub Actions variable `REVIEW_API_URL` to the deployed Worker URL. The frontend workflow maps this to `VITE_REVIEW_API_URL`.
6. Configure `GOOGLE_CLIENT_ID` and the source-restricted `GOOGLE_PICKER_KEY` before testing Drive uploads.

`node --test backend/verify.mjs` runs API tests against an isolated SQLite database. No test comments are written to the live database.

Sessions last 12 hours. Ten login attempts per IP per 10-minute bucket are allowed. Logout revokes the token at the server. New comments are kept in D1 and can be exported on Results; GitHub Issues are not used for new reviews.

The website login does not make the public GitHub repository, public Pages data files, or public Drive sharing links private. The 300 GB CT dataset stays in Drive, not D1 or Workers.

## Upgrade to findings quality ratings

Before deploying the frontend, apply `migrations/0001_findings_rating.sql` to the existing D1 database, then deploy the updated Worker:

```sh
cd backend
npx wrangler d1 migrations apply ct-report-reviews --remote
npx wrangler deploy
```

New installations can apply `schema.sql` directly instead. The migration preserves review IDs, submission IDs, timestamps and legacy decisions. New reviews require a string value `1` through `5` in the existing `decision` API field, with optional comments. Legacy decisions remain visible with a Legacy label and are excluded from numeric rating counts. Editing a legacy review requires selecting a new rating. CSV includes separate `rating` and `legacy_decision` columns. Deploy the backend before merging the frontend change into main, which triggers Pages deployment.
