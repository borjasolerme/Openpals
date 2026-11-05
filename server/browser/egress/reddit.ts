// Reddit blocks automated browsing from data-centre addresses and bans the accounts behind it, and its rules name AI
// agents, so a cloud computer, which browses from a data centre, never opens it.

/** Reddit's names. Each one covers its subdomains too: www, old, new, np, i, m, oauth, i.redd.it, v.redd.it… */
export const REDDIT_HOSTS = ["reddit.com", "redd.it", "redditmedia.com", "redditstatic.com", "reddit.app.link"] as const;

/** What a bot reads instead of a Reddit page. */
export const REDDIT_REFUSAL = "Reddit blocks bots that browse from cloud computers and can ban the person's account, so this browser doesn't open Reddit. Use the Reddit connected app if it's connected, or ask the person to do this on their own computer.";

/** Whether a host name is one of Reddit's names or under one. */
export function isRedditHost(name: string): boolean {
  const host = name.trim().toLowerCase().replace(/\.+$/u, "");
  return REDDIT_HOSTS.some((site) => host === site || host.endsWith(`.${site}`));
}

/** Whether an address a bot passed opens Reddit. A bare host means https, as the browser tools read it. */
export function isRedditAddress(raw: string): boolean {
  const text = raw.trim();
  try {
    return isRedditHost(new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(text) ? text : `https://${text}`).hostname);
  } catch {
    return false;
  }
}
