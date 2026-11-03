# Question cards

A bot doing work another bot handed it asks the person with a card: a decision with a few set answers through its
engine's question tool, the bot's own choices as buttons, and any other question as the same card with a reply field in
place of its `NEEDS INPUT:` line. An answer, by tap or in the person's own words, reaches the bot. Contract:
[`docs/runtime-contract.md`](../runtime-contract.md) §2 and §4.

## Replies and follow-ups from the bot that handed the work on

```sh
pnpm exec vitest run server/teammate-follow-ups.e2e.test.ts
```

One server of the person's own with the scripted fake engine: Clive, a Chief of
Staff, hands Mira work. Expected:

- On "Ask me first", Mira's `NEEDS INPUT:` question resumes Clive with it. Clive's reply to her thread in a later turn,
  without `answers`, answers it: Mira's next turn reads `@Clive answered: "…"`, her card says Clive answered, no second
  job starts, and her one result resumes Clive.
- The card Mira's ask tool waits on is answered the same way by Clive's later reply; her turn carries on with it.
- A correction Clive sends while Mira works on what he handed her reaches her running turn (receipt `injected`, a line
  from Clive in her thread) and her one result carries it.
- `thread` set to the id of one of the threads Clive opened on Mira sends his follow-up there, and its result comes back to
  him; the id of a thread he did not open on her is refused with where thread ids come from.
- Two assignments Clive hands Mira in one turn stay two jobs, though the first is already running when he sends the
  second.
- A question Mira's ask tool puts to the person in their own chat with her is listed in Clive's next turn (thread id and
  question). As her Chief, Clive sends the answer with that thread id: it answers the card for the person (receipt
  `injected`), her turn carries on with `@Clive answered for the person: …`, the card says Clive answered, and no work is
  handed out. When Clive is not her Chief, the same thread id is refused as above and the question stays the person's.
  When a webhook starts Clive's turn, the question is not listed either. The person can still change Clive's
  answer on the card, and Mira gets a new turn with it.

Unit tests for the relay's rules (which thread, which sender, sign-ins, work handed out this turn, an engine that cannot
take a message mid-turn) are in `server/host/question-routing.test.ts`.

The fake clock: `server/runtime-coordinator.test.ts` keeps a question waiting past 30 minutes and three days on the
server's own limits. Relay rules, the Full-access answer for an ask tool, and sign-in settling are in
`server/host/question-routing.test.ts` and `server/host/sign-in-settle.test.ts`.

Unit tests: `server/host/ask-cards.test.ts` (the card a parked question becomes, its stopped and expired states, the
chip that stays out of the inbox, typed answers), `server/runtime/envelope.test.ts` (the ask line with and without a
card tool), `src/components/QuestionCard.test.ts`, `src/components/QuestionCard.answer.test.ts` and
`src/components/AskCard.test.ts` (the card family, its buttons and settled lines).
