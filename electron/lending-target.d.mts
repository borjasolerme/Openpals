export function createLendingTarget<E extends { origin: string }>(deps: {
  environments: () => E[];
  /** A server of the person's own their bots moved to, while home is there. */
  ownHome: () => { origin: string; environmentId: string } | null;
}): {
  /** The home's sign-in as `env`'s lending checks it: signed out for any place that is not the home. */
  cloud(env?: E | null): { status: string; accountId: string | null; origin: string | null };
  environment(): E | null;
  /** The saved server that is the person's bots' home, if any. */
  places(): E[];
};
