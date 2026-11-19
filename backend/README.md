# Study API

The Cloudflare Worker uses D1 for individual accounts, blinded report assignments and ratings, and the private R2 binding `IMAGES` for CT objects. The server checks the role and assigned case for each request.

Sessions last 12 hours. Login throttling allows ten attempts per username and IP address per ten-minute window. A successful login clears that account’s attempt counter. Sixty failed sign-ins from the same IP in one window also temporarily block attempts across accounts. Successful sign-ins do not use this shared failure budget.

Use the [deployment and import guide](../docs/BLIND_STUDY.md) to migrate an existing database or initialize a new one, create personal accounts and deploy. Existing historical reviews can be read by an authenticated administrator through `GET /reviews`.

Run the isolated functional tests from the repository root:

```sh
node --test backend/verify.mjs backend/blind-roles.test.mjs
```
