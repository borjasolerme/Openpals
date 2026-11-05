# Preset bots

What it covers: presets in **New bot** (from imported files only),
**Include my New bot defaults as a preset** in Share team, **Share as
preset…** (a preset file: skills and presets, no team), and adding a preset
file back through **Templates → Import**. The product behaviour is described
in [../presets.md](../presets.md).

## HTTP round trip

```sh
pnpm exec vitest run server/presets.e2e.test.ts --silent=false
```

This launches and cleans its own fake-engine fixture through
`launchVerificationServer` (no live URL, no user data). Through the public API
it saves New bot defaults that carry things a preset must never hold (Auto
approval, connected apps, a command allowlist, a routine) plus a password in
the standing instructions, then checks:

- `POST /api/teams/export` with `kind: "library"`: a dry run counts one
  preset and one skill and writes no `published-library.json`; saving writes
  `support-agent-1.0.0.openmaus.json` with the preset (name, look, picture,
  standing instructions, skill, starter notes), reports the redacted
  instructions, contains no password, approval, connected-app, model or
  routine field, and the next save suggests `1.0.1`;
- a team export includes the defaults preset only with
  `includeDefaultsPreset: true`;
- importing the preset file adds a preset and no bot or team, and
  `GET /api/bot-presets` lists it;
- `POST /api/bots` with that `preset` adds its skill switched off, its
  starter notes and the `installedPackage.presetKey` stamp, at the default
  Full access level; with the saved defaults applied too, the preset's skill
  wins over the defaults';
- a row an older version saved from an organization's release (written into
  `org-library/presets.json` with its old `source`, publisher and ref) is
  listed like any other preset with none of those fields, its skill is added
  switched off, and it can be removed;
- an unknown or malformed preset, and a file with skills but no presets, are
  refused without creating anything; both presets can be removed, and a
  second removal answers `404`.

The printed JSON line names the fixture's data directory and server log.

## Units

```sh
pnpm exec vitest run server/presets.test.ts server/routes/bot-presets.test.ts server/package-import.test.ts server/package-export.test.ts shared/package-format.test.ts
```

- `server/presets.test.ts` imports into a real store, skill store and memory
  in a throwaway home: team and library files store their presets (once per
  identical file), a failure after the presets were stored removes them, a
  hand-edited row cannot add an approval level or model and a row with a
  daily log is refused, a row an organization once added reads as an
  ordinary preset (no publisher, skills added off, removable); a bot made
  from a preset gets its skills off, its playbooks and starter notes; the
  defaults preset keeps only the allowlist; a team file's preset never
  pushes out a team skill of the same name; the preset file round-trips.
- `server/routes/bot-presets.test.ts` drives the two routes through the
  route table.

## Renderer

```sh
pnpm exec vitest run src/lib/bot-presets.test.ts src/components/SharePresetDialog.test.ts src/lib/team-import.test.ts src/lib/team-share.test.ts src/components/ShareTeamDialog.test.ts src/components/NewBotDialog.test.ts src/lib/create-configured-bot.test.ts
OMB_UI_E2E=1 pnpm exec vitest run scripts/testing/presets-ui.e2e.test.ts --silent=false
```

The first command covers the Starting role list, the draft fields a preset
fills (never the model, computer, approval or connected apps), the picture,
the summary lines, creation passing the preset and leaving its skills and
notes to the server, the share request, part names, the preset file's
contents list and its import preview. The second owns a disposable
`control-omb ui` app: **Settings → Share as preset…** shows the counts and
saves `sky-1.0.0.openmaus.json` (captured in the page); **Templates →
Import** of that file shows "Preset bots and skills · no team" and **Add
presets** adds it; **Share team** shows no preset until **Include my New bot
defaults as a preset** is ticked; then the review behind **Templates → Add
Scout, Researcher** lists **Imported presets** and **Built-in roles** under
**Starting role**, and a bot made from a preset gets its skill off and its
notes. Screenshots go to
`.omb-scratch/verify-evidence/presets-*.png`. CI runs it in the advisory
renderer smoke job next to the Share team recipe.

## History

The 2026-09-24 runs recorded here (PR #1773 and its follow-up) also covered
presets from an organization library. Openpals has no organization library;
those records went with it. Rerun the commands above to verify presets now.
