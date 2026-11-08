# Openpals

**Your own team of AI bots, in one simple chat app, running on your own server.**

Openpals is an open-source alternative to Grok Bot, Meta Muse, OpenAI dots and Cue by Manus: a roster of AI
bots you talk to like contacts. Each bot has its own personality, memory, skills, routines and connected apps,
and runs on the AI subscriptions you already have (Claude Code, Codex).

Openpals is a fork of [OpenMausBot](https://github.com/milind-soni/OpenMausBot) by Milind Soni, simplified to feel
like a messaging app.

## How it differs from OpenMausBot

- **One place.** Your bots live in one place: this computer, or one always-on server (for example a small cloud VM)
  that the desktop app connects to with a one-time pairing link and shows as its window. On a server your bots keep
  working when your computer is closed. Disconnecting goes back to this computer.
- **One chat per bot.** No thread lists, conversation switching or separate routine run pages: routine results
  and bot replies arrive in the bot's single chat.
- **A flat list of bots.** No departments or sidebar sections.
- **No hosted cloud, plans or upstream services.** No MausBot Cloud, billing, promos, telemetry or built-in
  auto-updater. Everything runs on machines you control, with your own keys.
- **A guided first run.** Choose where your bots live (this computer or an always-on server), sign in to your AI,
  bring your bots over from Grok Bot, and connect your apps through Composio (project or personal key).

Removed features are deleted from the code, not hidden.

## Run it

Requirements: **Node 24+**, **pnpm**, and at least one agent CLI ([`claude`](https://claude.com/claude-code) or
[`codex`](https://github.com/openai/codex)) installed and signed in.

On your machine, from source:

```sh
git clone https://github.com/borjasolerme/Openpals && cd Openpals
pnpm install

pnpm dev:server    # server → 127.0.0.1:8799
pnpm dev           # app → http://127.0.0.1:5199
```

For bots that keep working while your laptop is closed, the desktop app sets up an always-on server for you: paste
a [Boat](https://boat.dev) API key, or the `user@address` of your own Ubuntu/Debian server (it logs in with your SSH
key), and press one button. Underneath it runs one command, which you can also run yourself on a server:

```sh
curl -fsSL https://raw.githubusercontent.com/borjasolerme/Openpals/main/scripts/install-server.sh | bash -s --
```

Without `--public-url` it serves `https://<public-ip>.sslip.io` through Caddy (ports 80 and 443 open); with
`--public-url https://your-address` it uses an HTTPS address you already have. It installs Openpals as a service and
prints a pairing link to paste into the app. For other HTTPS options (Tailscale) see
[docs/deploy-vps.md](docs/deploy-vps.md). Package the desktop app with `pnpm package:mac` or `pnpm package:linux`.

## Credits

Built on [OpenMausBot](https://github.com/milind-soni/OpenMausBot) © 2026 Milind Soni and OpenMausBot
contributors, and the third-party work listed in [NOTICE](NOTICE). Changes in this fork © 2026 Borja Soler.

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attributions and [LICENSING.md](LICENSING.md) for
details. OpenMausBot's source-available `enterprise/` folder is not part of Openpals.

Packaged Cua Driver components keep their upstream MIT, SIL OFL 1.1, MPL-2.0 and other terms; their notices,
license texts and SBOM are in [`third_party/cua-driver/`](third_party/cua-driver/).

Openpals is an independent project. It is not affiliated with or endorsed by Milind Soni or the OpenMausBot
project, xAI, Meta, OpenAI or Manus. "OpenMausBot", "MausBot", "Grok", "Muse", "dots" and "Cue" are trademarks
of their respective owners.
