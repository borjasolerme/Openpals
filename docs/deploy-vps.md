# Deploy Openpals on a VPS

From a blank Linux server to Openpals running on it around the clock, reachable from your laptop, the desktop app and your phone, with your bots working while every laptop is closed. It assumes nothing beyond being able to open a terminal and paste commands. About twenty minutes, most of it waiting.

Two ways to make the server reachable are covered. Pick one; the rest of the guide is the same.

| | You need | Who can reach it | Best for |
|---|---|---|---|
| **A. Your own domain** (Docker + Caddy) | a domain name, ports 80/443 | anyone with a pairing code, over HTTPS | a permanent address you own |
| **B. Your Tailscale network** (`serve --tailscale`) | Tailscale on the server and your devices | only your tailnet | the most private; nothing public at all |

Whichever you pick, the login is the same: you **pair** each device once with a short code and it stays signed in. A session lasts 30 days; using it with half that or less left renews it to a full 30, up to 180 days from pairing (`OMB_SESSION_TTL_DAYS` and `OMB_SESSION_MAX_DAYS` change both numbers). There is no password.

## The quick way: one command

The desktop app does this for you: in the welcome's "An always-on server" (or Settings → Where your bots live), paste
a Boat API key or your server's `user@address` and press Set up my server. To run it yourself on a fresh Ubuntu or
Debian server:

```sh
curl -fsSL https://raw.githubusercontent.com/borjasolerme/Openpals/main/scripts/install-server.sh \
  | bash -s -- [--public-url https://bots.example.com] [--label "My server"]
```

It installs Node 24, builds Openpals from this repository, runs it as the `openpals` systemd service and prints a
one-time pairing link (also on a line of its own, `OPENPALS_PAIRING_LINK=…`). Without `--public-url` it installs
Caddy and serves `https://<public-ip>.sslip.io` with a free certificate; ports 80 and 443 must be open. Pass
`--public-url` when an HTTPS address already reaches port 8799 (Boat's `boat host`, Tailscale, your own proxy).

Paste the link in the Openpals app under Where your bots live → Add a server → Pairing link. Run the command again to
update and get a new link. On a server with less than 6 GB of memory it adds a 4 GB swap file first, so the build fits.
The rest of this guide is the manual way, with the HTTPS options explained.

## What runs on a server, and what does not

Runs fully on the server: every engine CLI (Claude Code, Codex, Grok, custom ACP engines), chats, rooms, bot-to-bot coordination, routines, connected apps and custom MCP servers, webhooks, Company Brain, computer use on cloud or container computers, text-to-speech, and the web UI (the server serves it itself).

Needs the desktop app instead: dictation and controlling the server's own desktop. Bots browse on a server too, once the browser engine is installed (below).

## Before you start

1. **A server.** Any Linux VPS: Ubuntu 22.04 or 24.04, 2 CPUs and 4 GB of RAM is plenty. You need `sudo` or root. Hetzner, DigitalOcean, Lightsail, a Mac mini in a cupboard: all fine.
2. **Node 24 or newer and git** for path B (`node --version`). On Ubuntu:

   ```sh
   curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs git
   ```

   Path A uses Docker instead and needs no Node on the host. Openpals has no
   npm package: both paths run it from a clone of its source.
3. **Your engine accounts.** Bots run on the same engine CLIs you use on your laptop, with your subscriptions. You sign them in on the server once, the same way.

Connect to the server for everything below:

```sh
ssh root@YOUR_SERVER_IP
```

For path B, use the same unprivileged Linux account for setup and the
running service. The examples below use `maus` with home `/home/maus`. From an
administrator shell, create it if it does not already exist, then switch to it:

```sh
sudo useradd --create-home --shell /bin/bash maus
sudo -iu maus
```

The login shell also changes into `/home/maus`; run setup there, not from `/root`.
Run the Openpals commands and engine sign-ins below in this account. Keep a separate
administrator shell for system packages and systemd. If you already signed in as
root, sign in again as `maus`; those accounts have different homes and credentials.

## Path A: your own domain, with Docker

One container for the server plus Caddy for HTTPS at `https://maus.example.com`.

1. **Point a name at the server.** In your DNS provider add an **A record** (name `maus`, value the server's public IP). After a few minutes `ping maus.example.com` should answer with that IP. Ports 80 and 443 must be open; most providers open them by default.
2. **Install Docker:**

   ```sh
   curl -fsSL https://get.docker.com | sh
   docker compose version   # prints a version; if "command not found", log out and back in
   ```

3. **Get the deploy files and set the name:**

   ```sh
   git clone https://github.com/borjasolerme/Openpals.git && cd Openpals/deploy
   cp .env.example .env
   nano .env                # DOMAIN=maus.example.com ; ENGINES=@anthropic-ai/claude-code @openai/codex
   ```

   `ENGINES` lists the engine CLIs baked into your image, separated by spaces. Change it later and rebuild if you add one.

4. **Build and start it:**

   ```sh
   docker compose up -d --build
   docker compose ps        # omb "healthy", caddy "running"
   ```

   `--build` builds the image from the clone, with the engines from `ENGINES`.
   Do not use `docker compose pull`: there is no prebuilt Openpals image.

   Caddy requests the certificate on its own; give it a minute. Then `https://maus.example.com` shows a page asking for a pairing code. That is correct: nothing works until you pair.

In this path, every `node --experimental-strip-types server/openmausbot.ts …`
command below is run inside the container as `node dist-server/openmausbot.js …`
instead, from `Openpals/deploy`:

```sh
docker compose exec omb node dist-server/openmausbot.js pair --label "My MacBook"
```

## Path B: only your Tailscale network

From the administrator shell, install Tailscale on the server and sign in (`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`). Enable HTTPS certificates for your tailnet once in the admin console (DNS → HTTPS Certificates).

Then, from the `maus` shell, get Openpals, build its web UI and start it:

```sh
git clone https://github.com/borjasolerme/Openpals.git && cd Openpals
ELECTRON_SKIP_BINARY_DOWNLOAD=1 corepack pnpm install --frozen-lockfile
corepack pnpm exec vite build
node --experimental-strip-types server/openmausbot.ts serve --tailscale
```

- `corepack` comes with Node 24 and runs the pnpm version the project pins; say
  yes if it asks to download it.
- `ELECTRON_SKIP_BINARY_DOWNLOAD=1` skips the desktop app's Electron download,
  which a server never runs.
- `vite build` writes the web UI to `dist/`, which `serve` finds and serves
  itself. Without it the API runs but a browser gets no page.
- `serve` runs the server from its TypeScript source; Node 24 strips the types.
  `corepack pnpm omb serve --tailscale` is the same command.

Every `node --experimental-strip-types server/openmausbot.ts …` command below
runs from `~/Openpals` in the `maus` shell.

Tailscale terminates HTTPS with its own certificate and the pairing link uses the server's MagicDNS name (`https://maus.tail1234.ts.net`). Only devices on your tailnet can reach it, which is a very good property for a server that can run tools.

## Give the bots a browser (optional)

Bots can browse on a server. Docker (path A) ships the engine and Chrome in
the image. For path B, install Linux system libraries once from the
administrator shell:

```sh
sudo -H node --experimental-strip-types /home/maus/Openpals/server/openmausbot.ts browser install --with-deps
```

Then install the browser in the service account's home, from the `maus` shell
in `~/Openpals`:

```sh
node --experimental-strip-types server/openmausbot.ts browser install
```

The administrator's browser download is in a different home; it does not install
the service account's browser. Both commands must finish successfully.

On Ubuntu 24.04, AppArmor may also require [administrator sandbox setup](#ubuntu-2404-browser-sandbox).
The one-click installer downloads the browser; it does not grant these OS permissions.

Then turn the browser on under Settings → Computers, and per bot. Each bot
gets its own isolated session whose logins persist across restarts.

## Install and sign the engines in

Openpals does not install model engine CLIs. For path B,
install the engine you use in the service account, then sign it in. For example,
from the `maus` shell, for Claude:

```sh
npm install --global --prefix "$HOME/.local" @anthropic-ai/claude-code
export PATH="$HOME/.local/bin:$PATH"
claude
```

For Codex, use `@openai/codex` as the npm package and run `codex login --device-auth`
to sign in from a headless server. Complete the CLI's account flow in your browser. Repeat only for the
engines you use. For path A, run the installed CLI inside the container, for
example `docker compose exec omb claude`.

Engine logins belong to the service user's home (for example `~/.codex` and
`~/.claude`), separately from Openpals' own `~/.openmausbot`. Keep that home when
restarting or upgrading. The systemd example below includes `~/.local/bin` in PATH.

## Pair your first device

`serve` already printed a pairing link and QR code when it started. For another device later:

```sh
node --experimental-strip-types server/openmausbot.ts pair --label "Kitchen iPad"
```

```
pairing code:  RR8Y-BLR6-H939
expires:       10:59:45 AM (single use)
open or scan:  https://maus.example.com/pair#code=RR8Y-BLR6-H939
```

- **A browser:** open the link. The code is filled in; press **Connect**. That browser is paired for 30 days, renewed on use as above.
- **The desktop app:** copy the link, then in the app's **Server** menu choose **Connect to a Server from Copied Pairing Link…** (or paste it in **Settings → Remote access** and choose **Connect to server**). The window then shows the server and its bots. The app shows one server at a time: **Server → Disconnect from “name”…** forgets it and goes back to your own machine.
- **The phone:** scan the QR code from the iOS app's pairing screen, or paste the whole link into its address field. The phone can chat, approve, and read; creating bots, changing models, and connecting apps stay with you in the server's UI.

Worth knowing: a code works **once** and expires after **five minutes** (`--ttl 24h` keeps it open up to a day, for a device you set up later; it is still single use, and a server restart ends every open code); the link only works on that address (typing the code by hand: open `…/pair` and enter it); ten wrong codes in a minute from one address pause pairing for that address for a minute; `--client` mints a code for a device that may chat and approve but not change settings or pair others.

## Manage devices

Every paired device is a session:

```sh
node --experimental-strip-types server/openmausbot.ts sessions             # id, device, scope, last seen, expires
node --experimental-strip-types server/openmausbot.ts sessions revoke ID   # signs that device out and closes its stream at once
node --experimental-strip-types server/openmausbot.ts status               # what the server says about itself
```

## Keep it running

`serve` is a plain foreground process. For systemd (path B), stop the
foreground server with Ctrl-C before enabling the service. From the
administrator shell, save this as `/etc/systemd/system/openmausbot.service`:

```ini
# /etc/systemd/system/openmausbot.service
[Unit]
Description=Openpals server
After=network-online.target

[Service]
User=maus
WorkingDirectory=/home/maus/Openpals
Environment=HOME=/home/maus
Environment=PATH=/home/maus/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/node --experimental-strip-types /home/maus/Openpals/server/openmausbot.ts serve --tailscale --no-pair
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload && sudo systemctl enable --now openmausbot
journalctl -u openmausbot -f            # the server's log
```

This is path B. `--no-pair` skips printing a code at every restart; mint one with `node --experimental-strip-types server/openmausbot.ts pair` when you need it. Docker (path A) restarts on its own (`restart: unless-stopped`).

Adjust the account, home, checkout and PATH if yours differ. `/usr/bin/node` is
where the NodeSource package puts Node 24; `command -v node` prints yours. The
service runs the checkout as it is, so a restart never updates it.

## Update

- **Path B with the service above:** from the administrator shell, stop the
  service, update the checkout and rebuild the web UI as `maus`, then start it:

  ```sh
  sudo systemctl stop openmausbot
  sudo -iu maus sh -c 'cd ~/Openpals && git pull --ff-only && ELECTRON_SKIP_BINARY_DOWNLOAD=1 corepack pnpm install --frozen-lockfile && corepack pnpm exec vite build'
  sudo systemctl start openmausbot
  ```

  Check that each step succeeded before starting. To run a chosen version
  instead of the newest, `git checkout` its tag or commit in place of
  `git pull --ff-only`. A service restart by itself does not update anything.
- **Path A:** `cd Openpals && git pull --ff-only && cd deploy && docker compose up -d --build`.

Routines and queued work survive a restart. A teammate turn running at that moment runs again once at the next start, told to check what it already did, and the bot that asked for it is told. A person's own turn and a running routine are not run again: the conversation says it was interrupted. Update between runs where you can.

## Back up

Stop the server before copying its SQLite database: Ctrl-C for a foreground
process, or `sudo systemctl stop openmausbot` from the administrator shell for
the service above. Stop any engine processes and managed desktops still writing
files you intend to back up.

For path B, this backs up application state (bots, chats, routines and paired
sessions). Run it from the service account's shell:

```sh
umask 077
backup_dir=$(mktemp -d "$PWD/openmausbot-backup.XXXXXX")
tar czf "$backup_dir/openmausbot-data.tgz" -C "$HOME" .openmausbot
```

A full backup also needs your engine credential/configuration paths, such as
`~/.codex`, `~/.claude` and `~/.claude.json`, and browser session state under
`~/.agent-browser` if used. Include the paths that exist for your installed CLIs,
any configured home/data-directory overrides, and workspaces outside the app
directory. These are not included in the command above.

For path A, the whole `/data` volume includes the container's CLI homes. From
`Openpals/deploy`, stop the app before archiving; `deploy_data` is the default
volume name, so use your actual volume name if you changed the Compose project:

```sh
docker compose stop omb
backup_dir=$(mktemp -d "$PWD/openmausbot-backup.XXXXXX")
docker run --rm -v deploy_data:/data:ro -v "$backup_dir":/b alpine sh -c 'umask 077; tar czf /b/openmausbot-data.tgz -C /data .'
```

Each command creates a fresh private folder in the current directory, so it
cannot overwrite an older archive with more permissive access. Keep the
archive inside that folder privately on another machine. Restore with the server stopped,
using the same paths and original ownership. After backup or restore, start the
service with `sudo systemctl start openmausbot`, or `docker compose start omb`.

## The rules the setup relies on

Read this before putting anything else in front of the server.

- The server only ever listens on loopback (`127.0.0.1:8799`). Never publish that port yourself. Caddy and Tailscale each reach it from the same machine.
- A request that arrives through a proxy is treated as remote and needs a session, whatever headers it carries. A proxy of your own (nginx, Traefik, Cloudflare Tunnel) must forward the real `Host` and add `X-Forwarded-For` and `X-Forwarded-Proto`, must not buffer the event stream, and must **not** rewrite `Host` to `127.0.0.1`.
- Pairing is the login. Want a second wall in front of it? Path A's `Caddyfile` has a commented `basic_auth` block for a shared password.
- The session cookie is marked `Secure`; do not serve this over plain HTTP on the public internet.
- The one thing a stranger can read is `/.well-known/openmausbot/environment` (the server's id, label, version, capabilities) and `/api/health` (only the app name). Everything else answers "pair this device".

## Troubleshooting

**Path A: the page never loads or shows a certificate error.** Caddy could not get a certificate. Check that the name resolves to the server and that ports 80 and 443 are open; `docker compose logs caddy` shows the reason.

**"forbidden: pair this device to use the server remotely" / "this request came through a proxy".** Expected before pairing, and for tools that call the API without a session. Pair the device. Scripts send `Authorization: Bearer <token>` with the token from the pairing response instead of a cookie.

**Pairing code refused.** It expired (five minutes, or its `--ttl`) or was used. Mint a new one. "Too many failed pairing attempts" means wait a minute.

**A bot says the engine is not signed in.** Sign that engine in again on the server.

**What does the server think it is?** `https://<address>/.well-known/openmausbot/environment` is public and shows its id, label, version and capabilities; `node --experimental-strip-types server/openmausbot.ts status` prints the same on the server.

**Something else.** `journalctl -u openmausbot --since -10m` (or `docker compose logs omb --tail 100`) shows the server's startup lines. Paste them with your question in an issue at https://github.com/borjasolerme/Openpals/issues.

### Ubuntu 24.04 browser sandbox

If Chrome reports `No usable sandbox!` and `sudo journalctl -k --since -10m`
shows an AppArmor `DENIED` for `userns`, the browser download is installed but
Ubuntu is blocking its sandbox. [Chromium documents this restriction](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md).
Do not add `--no-sandbox` or disable `kernel.apparmor_restrict_unprivileged_userns` globally.

For path B, an administrator can allow only a trusted, root-owned Chrome
copy. Find the service user's downloaded executable:

```sh
find /home/maus/.agent-browser/browsers -type f -name chrome -executable
```

Use its actual `chrome-VERSION` directory in every path below; `VERSION` is a
placeholder, not a fixed Chrome release. Copy the whole directory, including its
libraries, to a new location that the service user cannot modify:

```sh
sudo install -d -o root -g root -m 0755 /opt/openmausbot-browser
sudo cp -R /home/maus/.agent-browser/browsers/chrome-VERSION /opt/openmausbot-browser/
sudo chown -R root:root /opt/openmausbot-browser/chrome-VERSION
sudo chmod -R go-w /opt/openmausbot-browser/chrome-VERSION
```

Save this as the root-owned `/etc/apparmor.d/openmausbot-chrome`, replacing
`VERSION` with the same value. Keep the exact executable path: a wildcard under
the writable service home would also allow replacement executables.

```text
abi <abi/4.0>,
include <tunables/global>

profile openmausbot-chrome /opt/openmausbot-browser/chrome-VERSION/chrome flags=(unconfined) {
  userns,
}
```

Load the profile:

```sh
sudo apparmor_parser -r /etc/apparmor.d/openmausbot-chrome
```

Add the following line under `[Service]` in the systemd unit above, again using
the exact installed version, then run `sudo systemctl daemon-reload` and
`sudo systemctl restart openmausbot`:

```ini
Environment=AGENT_BROWSER_EXECUTABLE_PATH=/opt/openmausbot-browser/chrome-VERSION/chrome
```

For a foreground server, export `AGENT_BROWSER_EXECUTABLE_PATH` to that same
path in the `maus` shell before starting `serve`. After a Chrome update, copy the
new version and update both the AppArmor profile and service environment; the
root-owned copy is not updated by the browser installer. Keep
`kernel.apparmor_restrict_unprivileged_userns=1`.
