# Independent threads and sidebar

Launch the real renderer and server with only an offline provider and a
disposable data directory:

```sh
node --experimental-strip-types scripts/verify-threads.ts
```

Open the printed `previewUrl`. The fixture seeds Pepper with three threads,
two different saved model choices, an optional Email folder, and a Launch team
group with separate histories. New turns deliberately remain running so that
switching and Stop can be exercised without a real provider or account.

## Check the real UI

Each bot has one chat in the app. Threads remain in the server's data model:
routine runs and bot-to-bot work run in internal threads, and their results
land in the bot's main chat. Rooms keep their own threads.

1. Click Pepper's row. It opens Pepper's main chat; the sidebar shows no thread
   tree, folder or **New thread** control, and the bot menu has no thread items.
2. Send a message and let it run. Stop it from the header (Advanced) or the
   composer (Simple); the turn stops and the chat stays where it is.
3. In the chat, change the model. The model picker defaults to **This bot**.
4. Request a synthetic approval in an internal thread (the `permission` recipe
   in `server/thread-capacity-api.test.ts` against the broker in a
   `<thread-id>.launch.json` receipt). The bot's row gains one warning row for
   that thread; it is the only row under a bot, and only while the thread waits
   on the person. Click it: the waiting card opens. Answer **Allow once** and
   check the broker receives it. Click the bot's row again: it returns to the
   main chat, and the thread it was left on keeps its unread mark.
5. Follow a notification for an internal thread: it opens that thread's card,
   the same way.
6. Expand Launch team and select its separate histories. A room keeps its thread
   list, **New thread** and **All threads**.
7. In **Settings → General → Parallel threads**, select one, then start work in
   two rooms' threads: the second shows **Queued** until the first stops.
8. An `openmausbot://bot/<id>` or `openmausbot://thread/<id>?bot=<id>` link opens
   the bot's main chat; a room's thread link opens that room thread.

Never publish a raw launch receipt: it contains short-lived fixture
capabilities. The offline CLI may report an interrupted subprocess when
stopped; these checks concern ownership, state and navigation, not
real-provider behavior, a native mobile device or real computer use.

## Permanent regression checks

```sh
pnpm exec vitest run server/independent-threads-api.test.ts server/paired-thread-targets-api.test.ts server/direct-screen-settlement-api.test.ts server/bot-projects-api.test.ts server/task-cwd-api.test.ts server/thread-capacity-api.test.ts src/components/SidebarBotActivity.test.ts src/components/ThreadConcurrencySettings.test.ts src/components/ComposerQueuedMessages.test.ts src/state/store.test.ts
```

These cover thread-pinned tools and permissions, stale legacy phone requests,
bounded final screenshots, late frame rejection, retained folder histories,
and background event isolation. Capacity tests run ten distinct fake-provider
processes concurrently, queue/cancel overflow, and exercise limit changes while
an approval is pending without revoking active capabilities. Folder tests cover
validated emoji persistence on the server, complete-order permutations and
failed saves.
Integration cases launch their own fixture and
print retained JSON evidence paths next to the server logs.

Stop the foreground launcher with Ctrl-C. It closes only its own UI/server
and deletes its disposable home; the printed server log remains available.
