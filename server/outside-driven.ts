/** A webhook drove this conversation: its run, a payload posted into it, or a conversation that handed it the work. */
export function outsideDriven(threadId: string, records: {
  webhookRun(threadId: string): boolean;
  webhookPosted(threadId: string): boolean;
  handedFrom(threadId: string): Iterable<string>;
}): boolean {
  const driven = (id: string) => records.webhookRun(id) || records.webhookPosted(id);
  return driven(threadId) || [...records.handedFrom(threadId)].some(driven);
}
