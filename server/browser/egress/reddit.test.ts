import { describe, expect, it } from "vitest";

import { isRedditAddress, isRedditHost, REDDIT_HOSTS } from "./reddit.ts";

const REDDIT_NAMES = [
  ...REDDIT_HOSTS,
  "www.reddit.com", "old.reddit.com", "new.reddit.com", "np.reddit.com", "i.reddit.com", "m.reddit.com", "oauth.reddit.com",
  "i.redd.it", "v.redd.it", "preview.redd.it", "external-preview.redd.it", "www.redditmedia.com", "www.redditstatic.com",
  "a.thumbs.redditmedia.com", "go.reddit.app.link",
  // As Chrome or a person may write them.
  "WWW.Reddit.COM", "www.reddit.com.",
];
const LOOKALIKES = [
  "notreddit.com", "reddit.com.evil.test", "reddit.co", "redditt.com", "myredd.it", "redd.it.evil.test",
  "notredditmedia.com", "evilreddit.app.link", "app.link", "example.com", "",
];

describe("Reddit's names", () => {
  it.each(REDDIT_NAMES)("%s is Reddit's", (name) => {
    expect(isRedditHost(name)).toBe(true);
  });

  it.each(LOOKALIKES)("%s is not", (name) => {
    expect(isRedditHost(name)).toBe(false);
  });

  it("reads an address as the browser tools do, a bare host meaning https", () => {
    for (const address of [
      "https://www.reddit.com/r/test/", "old.reddit.com/r/test", "reddit.com", "http://i.redd.it/a.png", "HTTPS://V.REDD.IT/x",
      "https://reddit.com./", "https://someone@reddit.com/", "https://reddit.com:443/r/x", "wss://www.reddit.com/socket",
      // URL parsing maps full-width letters and dots to ASCII.
      "https://ｒｅｄｄｉｔ。ｃｏｍ/",
    ]) expect(isRedditAddress(address), address).toBe(true);
    for (const address of [
      "https://reddit.com@evil.test/", "https://evil.test/?next=https://www.reddit.com/", "https://notreddit.com/",
      "https://reddit.com.evil.test/", "about:blank", "data:text/html,reddit.com", "not an address", "",
    ]) expect(isRedditAddress(address), address).toBe(false);
  });
});
