/** A webhook drove this conversation: its record, its run, a payload posted into it, or a conversation that handed it the work. */
export function outsideDriven(threadId: string, records: {
  /** The durable record, kept once the run or hand-off that brought the work has ended. */
  marked(threadId: string): boolean;
  webhookRun(threadId: string): boolean;
  webhookPosted(threadId: string): boolean;
  handedFrom(threadId: string): Iterable<string>;
}): boolean {
  const driven = (id: string) => records.marked(id) || records.webhookRun(id) || records.webhookPosted(id);
  return driven(threadId) || [...records.handedFrom(threadId)].some(driven);
}
