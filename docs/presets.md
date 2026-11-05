# Preset bots

A preset is a named starting point in the review that opens when you add a
ready-made bot from **Templates** (**New bot** itself makes a bot at once,
with no review). Choosing one under **Starting role** fills in the new bot's
name, title, description, standing instructions and look, and when you press
**Create bot** it also brings the preset's skills, playbooks and starter
notes. You can change every field before creating the bot.

Presets come only from files: a team file or a preset file someone sent you.
In that review's **Starting role** list, **Imported presets** come first
(newest first), then the built-in roles.

## What a preset holds

A preset is an allowlist. It can carry only:

- a name and a short description;
- the new bot's name, title, description and standing instructions;
- its look: colour, mascot and picture;
- playbooks;
- skills (the `SKILL.md` text only, never scripts);
- starter notes (`MEMORY.md` and topic notes).

It has no field for a model, a folder, a computer, an approval level,
connected apps, MCP servers, a browser, peers or routines. Whatever you have
chosen for those in the review (or in your New bot defaults) stays as it is, so
a preset can never widen what a bot may do. Every stored preset is read
through the same package parser as every import, so a hand-edited preset
still says only what a file may.

## Skills start switched off

A preset's skills are added **switched off**, like every skill in a shared
file; the review says so before you create the bot. Switch them on in the
bot's Skills settings after reading them. A preset's skills and starter notes
win over your New bot defaults' own skill or note of the same name. The bot
records where it came from (`installedPackage` with `presetKey`). The bot is
yours, not part of the package: it never keeps the package added, so a team
you deleted can be added again.

An imported preset can be removed with **Remove from New bot** under the
Starting role list (no confirmation step). Presets an older version saved
from an organization's release are kept and treated like imported ones: their
skills are added switched off and they can be removed the same way.

## Sharing presets

Two ways, both saving the same file format ([team-sharing.md](team-sharing.md)):

- **With your team.** In **Templates → Share → Share…**, tick **Include my New
  bot defaults as a preset**. It is off unless you tick it: your New bot
  defaults are yours until you share them. The **Include starter notes** box
  also decides whether the preset's notes go in.
- **On their own.** **Settings → General → Defaults for new bots → Share as
  preset…** saves a preset file: the preset and its skills, no team, no bots.
  Choose the preset's name, a description, the version and whether to include
  the picture and starter notes.

Either way the preset is made from your saved New bot defaults through the
allowlist above, and every text part passes through the same secret redaction
as a team file. The dialog lists what was removed or left out. There is no
confirmation step: **Save file** is the decision.

A preset file is added in **Templates → Import** like a team file. The
preview shows the preset bots and any skills the file only offers; **Add
presets** puts the presets in the review's **Starting role** list and changes nothing else. A file with
skills but no bots or presets has nothing to add here and is refused with a
sentence. Adding the same file twice offers its presets once.

## Where presets are kept

`org-library/presets.json` in the data folder (the folder keeps its old
name): one row per preset (which import it belongs to, the package name and
version, and the preset exactly as the file carried it), plus the skill and
playbook definitions those presets use, so a bot can be made from a preset
after the file is gone. What this installation last
shared as a preset file (its package id and version) is kept in
`published-library.json`, so the next share suggests the next version.

## HTTP

All admin scope.

- `GET /api/bot-presets` → `{presets: [{id, key, name, description?,
  packageName, release, bot, skills: [{name, description}], playbooks,
  notes}]}`, newest first.
- `DELETE /api/bot-presets/:id` removes a preset.
- `POST /api/bots` with `preset: "<id>"` adds the preset's playbooks, skills
  and starter notes to the new bot and stamps it. Name, look and instructions
  are the request's own fields, as for any bot.
- `POST /api/teams/export` with `includeDefaultsPreset: true` (and optionally
  `presetName`, `presetDescription`, `presetAvatar` as a data URL) adds the
  New bot defaults preset to a team file. With `kind: "library"`, it saves a
  preset file (`name`, `release`, `notes`, `includeMemory`, `dryRun` as for a
  team).
- `POST /api/teams/import` adds a preset file's presets and answers
  `{presets: [{id, key, name}], offeredSkills, bots: []}`.

See [verification/presets.md](verification/presets.md) for how this is tested.
