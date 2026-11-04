# X (Twitter) card

The X card in Apps shows whether bots can search and read X: the person's own
treg key. The card reads `GET /api/x/status`, which resolves the credential with
the same function as the X tools' own routes.

## Isolated browser verification

Use an installed Playwright module and Chromium executable, as for the
[Whop fixture](whop.md), then run:

```sh
OMB_UI_EVIDENCE_DIR=/tmp/omb-x-connector-evidence \
  node --experimental-strip-types scripts/verify-x-connector.ts
```

It starts a fake-engine server with a loopback stand-in for treg
(`OMB_TREG_URL`). It drives the real Apps pop-up and checks:

- Without a key, the card asks for a treg key and links to treg.to.
- Saving a key tests it at once ("treg is working ✓ Balance: $4.25."), and
  **Remove key** takes the card back.
- At 390 px wide the pop-up does not scroll sideways.

It saves a screenshot of each state. No real treg key or account is used.
