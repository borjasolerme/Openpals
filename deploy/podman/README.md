# Self-host the full stack with rootless Podman

Run the OpenMausBot server and Caddy with one Podman
engine. Docker Engine, Docker Desktop, and Docker Compose are not required;
`podman-compose` provides the Compose commands. The existing
[`deploy/docker-compose.yml`](../docker-compose.yml) remains an independent option.

```text
Browser -> loopback Caddy :8080 -> OpenMausBot :8799
```

The server and Caddy use the Linux host network. On Windows, that host is the
Podman WSL2 machine. Data stays on its Linux filesystem, not a Windows bind mount.

## Windows x64 / WSL2

Install WSL2 and Podman (`winget install --exact --id RedHat.Podman`), then reopen
PowerShell. Podman Desktop is optional. Clone the repository on a Windows drive
that WSL can access through `/mnt/c`, `/mnt/d`, etc. From the repository root:

```powershell
.\deploy\podman\maus.ps1 setup
# Edit deploy/podman/.env. Set ENGINES to the npm CLI packages you want to use.
.\deploy\podman\maus.ps1 up -d --build
.\deploy\podman\maus.ps1 ps
```

Setup creates/starts a WSL2 machine named `openmausbot` (4 CPUs, 10 GiB RAM,
60 GiB requested disk), installs `podman-compose` inside it if missing, and
generates `.env`. WSL resource limits still apply.
It preserves an existing `.env`. Use `OMB_PODMAN_MACHINE` to select a different
machine. The wrapper refuses a stopped machine for normal Compose commands;
after a reboot, use `podman machine start openmausbot` before `up -d`.

Compose runs **inside** the machine, so bind paths have the same meaning there
as for the server. `OMB_PODMAN_ENV_FILE` selects an alternate
environment file (relative to `deploy/podman`), useful for an isolated fixture.

## Linux x64 / systemd

Install rootless Podman, `podman-compose`, and configure the user's subuid/subgid
ranges using your distribution's instructions. Run as a regular user:

```sh
cd deploy/podman
sh setup.sh
# Edit .env; for example ENGINES=@anthropic-ai/claude-code @openai/codex
PODMAN_COMPOSE_PROVIDER=podman-compose podman compose --env-file .env -f compose.yaml up -d --build
```

This recipe targets Podman 5.8.3 / podman-compose 1.6.0 and Linux x86_64. The
renderer and server both build from your checkout. Engine installation is opt-in through `ENGINES`; pin package versions
there when reproducibility is required. The live acceptance environment is a
Windows WSL2 machine. Native Linux, SELinux-enforcing systems, ARM64, macOS, and non-systemd
hosts need separate validation; the Containerfile explicitly rejects non-x86_64.
SELinux-enforcing systems need an appropriate bind policy, not blanket label
disabling. Reboot persistence on Linux additionally needs the user's linger and
Podman restart service configured according to the host's administration policy.

## Engines

Open <http://localhost:8080>. Sign the selected engines in inside the container,
for example `maus.ps1 exec omb claude`. Their logins persist under `OMB_DATA_ROOT`.
For the Linux commands, substitute the `podman compose --env-file .env -f
compose.yaml` prefix for `maus.ps1`.

## Access and trust boundary

Caddy listens on loopback only. To use Tailscale Serve, route the tailnet HTTPS
endpoint to `http://127.0.0.1:8080`, set `OMB_PUBLIC_URL` to that HTTPS URL and
`OMB_HTTPS_HOST` to its hostname, then recreate the services with `up -d`.
Mint a pairing code with `maus.ps1 exec omb node dist-server/openmausbot.js pair`.
The proxy forwards the client address and scheme so the server's pairing checks
remain in force. Do not publish the server or webhook listener directly. For public-domain HTTPS, use the existing Docker deployment or design
and verify an authenticated edge for this recipe.

Use a dedicated machine/user. This is not complete isolation of each agent CLI:
CLIs execute in the shared app container.

## Updates, backup, and coexistence

- Update the checkout and run `up -d --build`; there is no published Podman app
  image/update channel in this recipe.
- Data, chats, credentials, and workspaces live under `OMB_DATA_ROOT`.
  Stop the app before archiving that Linux directory. Do not
  copy a live SQLite database. Preserve ownership and the absolute path on restore.
- Docker deployments keep their existing commands, volumes, and files. This
  recipe does not migrate them. For side-by-side operation, use separate data
  roots and different app/webhook/proxy ports; never share a live data directory.
- For acceptance checks, follow the [isolated verification recipe](../../docs/verification/podman-self-hosting.md).
