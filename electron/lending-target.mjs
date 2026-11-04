/** Which server this computer is lent to: the server of the person's own their bots moved to (own-home-main.mjs), bound to
 * that server's identity (`own:<environment id>` as its account). `cloud(env)` is that sign-in as `env`'s lending checks it
 * (signed out for any other place, so lending to it ends), `environment()` that saved server, and `places()` it alone.
 * Security: never a server connected by hand that the person did not make their home. */
export function createLendingTarget({ environments, ownHome }) {
  const signedOut = { status: "signed-out", accountId: null, origin: null };
  const cloud = (env = null) => {
    const own = ownHome();
    if (!own || (env && env.origin !== own.origin)) return signedOut;
    return { status: "connected", accountId: `own:${own.environmentId}`, origin: own.origin };
  };
  const environment = () => {
    const own = ownHome();
    return own ? environments().find((entry) => entry.origin === own.origin) ?? null : null;
  };
  return {
    cloud,
    environment,
    places() {
      const home = environment();
      return home ? [home] : [];
    },
  };
}
