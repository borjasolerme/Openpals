# Desktop server connection

The desktop app shows the bots of exactly one place: this computer's own
server, or one paired always-on server (a VPS or Boat machine running
`openmausbot serve`). These checks cover connecting to that server with a
one-time pairing link and disconnecting to go back to this computer.

```sh
node --test electron/place-main.node-test.mjs electron/environments.node-test.mjs
pnpm exec vitest run src/lib/place.test.ts src/components/RemoteComputerSection.dom.test.ts \
  src/components/RemoteComputerSection.test.ts src/components/SettingsModal.serverPairing.test.ts
```

`electron/place-main.node-test.mjs` runs main's own connect and disconnect
code with Electron faked. It checks:

- Connect refuses anything but a server address or a pairing link with its
  code after `#` (never in the query), and asks nothing.
- The server is shown only after the person confirms its host in a native
  dialog ("Connect to bots.example.com?"); the app then opens the server's
  pairing page. Cancel saves nothing.
- Connecting to another server signs this app out of the one it showed and
  clears that server's cookies and storage.
- Disconnect forgets the server, signs out, clears its cookies and storage and
  goes back to this computer's page, even when the server does not answer. It
  keeps the cookies of a host this app still uses (this computer's own
  `127.0.0.1` server). On this computer it changes nothing. From the menu it
  asks first ("Disconnect from “VPS”?").
- Main answers the `place:*` channels only for the main window's own page. A
  server's page can read `place.current()`, but connect and disconnect need
  the person's click.

The renderer tests mount the real **Settings → Remote access** section with a
faked `window.ogb.place` bridge: a full pairing link reaches
`place.connect` unchanged, a link without its code is refused before the app is
asked, a refusal from the app is shown as the alert, and a connected app names
the server and offers **Disconnect and use this computer**.

These tests fake Electron's dialogs, navigation and session. They do not prove
public DNS/TLS or an authenticated session on a real server.

## User flow

On the server, run `npx openmausbot pair` (or `pnpm pair --label "My desktop"`
in a checkout) to create a fresh, single-use pairing link. Treat the link as a
secret.

In the desktop app, either copy the link and choose **Server → Connect to a
Server from Copied Pairing Link…**, or open **Settings → Remote access**, paste
the full link (including its 12-character code) and choose **Connect to
server**. Confirm the host in the native dialog, then finish pairing on the
server's page. The app now shows that server's own UI and bots.

To go back to this computer, choose **Server → Disconnect from “name”…** or
**Disconnect and use this computer** in Settings → Remote access. This signs
the desktop out and forgets the server; the server's bots and data stay on the
server, which keeps running by itself. Pair again to reconnect.
