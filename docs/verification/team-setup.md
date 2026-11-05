# Reviewed Chief team setup

Use an isolated fixture, never the live app or workspace. The deterministic
integration recipe starts its own temporary server and installs only the
repository's fake Claude and fake Codex engines:

```sh
pnpm exec vitest run server/team-setup.e2e.test.ts
pnpm exec vitest run server/bot-deletion-write-failure.e2e.test.ts
pnpm exec vitest run server/team-setup-requests.test.ts server/store.test.ts
pnpm exec vitest run server/index.test.ts -t 'delet|Full and Custom bots'
pnpm typecheck
pnpm lint
```

The integration test retains a `.team-setup.json` evidence file beside its
printed server log, then removes its fixture data. It uses a real active-turn
capability to call the internal tools, not the owner bot-settings API. Model
planning is simulated in this deterministic test; provider authentication and
real-world task quality are not proven by fake engines.

## Sample requests

With Clive elected Chief of Staff, ask:

> Add Mira for research, Patch for engineering, and Quill for growth.
> Give each a concise specialist role and standing instructions. Use suitable
> models from the connected engines, including different providers where
> available. Show me one combined setup review.

Clive discovers the exact bot IDs, engines and models with `list_team_setup`,
then calls `propose_team_setup` once. A review combines all fields for each
bot. A name another bot already has is refused ("@Mira already exists").

After approval, try:

> Change Patch's default model to a suitable model from the other connected
> provider. Keep existing conversations and permissions.

Only the bot default changes, for new threads and group work. Existing
threads retain their models, approval levels and allowlists, including legacy
threads that previously inherited defaults. A provider incompatible with the
current permission level cancels the entire proposal; setup never silently
downgrades or elevates execution permissions. New specialists use Ask and
start with connected apps disabled. Existing peer allowlists remain in force.

Leadership setup accepts `fields.chiefOfStaff` for new or existing bots. There is one Chief: a plan that promotes another bot must include the current Chief's demotion ("There can be only one Chief. Include the current Chief's demotion in this plan."). Test explicit replacement in one batch, denial, a conflicting or newly elected Chief, and peer restrictions while the card is open. A Chief changes only the bots its own peers list allows. Verify reload and a failed `bots.json` write leave roles and the receipt consistent. `list_team_setup` shows which bot is the Chief.

For deletion, ask separately:

> Delete Patch. Show me the deletion confirmation first.

`propose_bot_deletion` produces a separate destructive review naming the exact
bot. Lifecycle guards reject active work. Before removing the bot, the server
discovers and deletes its exact managed Boat, VPS container, and per-bot Local
VM (including that VM's private workspace). A provider outage, unresolved ownership, unmanaged name collision, or
unconfirmed provider deletion keeps the bot so deletion can be retried. Bot
conversations, memory, instructions and skills are then removed; generated
project files remain. The Chief cannot delete itself.

## Assertions and failure boundaries

The deterministic scenario checks unknown models, spoofed caller identity,
coalescing, denial, approval, duplicate decisions, default-model changes,
stale target edits, separate deletion and exactly one
requester continuation per decision, unless the user stops the conversation.
For both direct tasks and rooms it denies while Clive is still running, then
presses Stop and checks that neither a fresh provider generation nor a reply
appears, including after a duplicate decision. It also verifies that forged Origin
headers from an active loopback bot cannot approve setup or deletion. A
trusted desktop or paired owner can review; headless local-browser approval
waits until every bot is idle. Denial is always safe to accept.

Domain and Store tests cover injected permission fields, hidden/unauthorized
targets, peer restrictions, busy/deleted/stale targets and source conversations,
closed cards, duplicate names, model incompatibility,
failed writes, receipt replay, and reload preservation of legacy task settings.
Stopping or deleting the requesting conversation does not resurrect its card.

All bot changes and the result receipt use one atomic `bots.json` write before
publishing bot mutations: if that write fails, no bot, model or Chief changes
are applied. Bot-record removal similarly saves its receipt before deleting bot data, but
external computers cannot join that file transaction. With several independent
providers, one owned computer can be removed before a later provider fails; the
bot stays, the completed cleanup is not rolled back, and a retry safely
rediscovers and removes what remains. The deletion write-failure fixture has no
owned external computer: it obstructs the exact temporary `bots.json`
destination, exercises the real DELETE lifecycle, and checks that the complete
bot, conversations, routines, webhooks and solo/shared calendar calls are
unchanged in memory and on disk. It restores that fixture file and retries
successfully; unrelated call guests remain. No production fault hook is used.
Later cleanup failure is reported distinctly from a failed/unapplied setup.

## Recorded app and real-model checks — 2026-09-13

The real renderer was driven through `control:omb ui` in an isolated fixture:
Clive's pending card displayed the exact Research/Mira setup;
Cancel received initial focus, Apply setup was the sole positive action, and
no Always allow option appeared. Clicking Apply setup created Mira, cleared
the pending composer, showed Team setup applied, and rendered one automatic
continuation. Screenshot and retained log were saved by the verification run.
This checks the shared React review UI, not native desktop packaging.

A separate isolated run with each of **real Codex gpt-5.6-luna** and
**gpt-5.6-sol** received an ordinary-language request (no tool instructions).
Each called `list_team_setup` and
`propose_team_setup` once, proposed exactly Mira/Research, Patch/Engineering and
Quill/Growth using a connected model, then reported success after one approval
without asking again. These are two dated model-following samples, not a guarantee
of every provider or task. The temporary authentication copy and fixture data
were removed after the run; only bounded result evidence was retained.

The combined main-based integration was repeated with real Luna after the
registry/import fixes: exactly one review created all three requested bots with
the selected model, then the Chief continued. Evidence:
`/tmp/omb-live-team-0913.MwRY2k/setup-gpt-5.6-luna-1789255036346/result.json`.
