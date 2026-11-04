export interface ChatLinkAddress {
  /** A bot's or a room's id. */
  botId?: string;
  threadId?: string;
}

const THREAD_URL_PREFIX = "openmausbot://thread/";
const BOT_URL_PREFIX = "openmausbot://bot/";
const ID_LIMIT = 256;

const plainId = (value: string): string | null => {
  // oxlint-disable-next-line no-control-regex -- an id never carries control characters
  if (!value || value.length > ID_LIMIT || /[\u0000-\u001f]/.test(value)) return null;
  return value;
};

function chatUrl(value: string, prefix: string, host: string): { url: URL; id: string } | null {
  const raw = value.trim();
  if (!raw.toLowerCase().startsWith(prefix)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.port || url.hash) return null;
  if (url.hostname.toLowerCase() !== host) return null;
  let id: string;
  try {
    id = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return null;
  }
  if (!id || id.includes("/") || url.pathname.slice(1) !== encodeURIComponent(id)) return null;
  const plain = plainId(id);
  return plain ? { url, id: plain } : null;
}

/** openmausbot://thread/<thread-id>?bot=<owner-id> and openmausbot://bot/<owner-id>, the links Electron forwards. */
export function parseChatLink(value: string): ChatLinkAddress | null {
  const bot = chatUrl(value, BOT_URL_PREFIX, "bot");
  if (bot) return [...bot.url.searchParams.keys()].length ? null : { botId: bot.id };
  const thread = chatUrl(value, THREAD_URL_PREFIX, "thread");
  if (!thread) return null;
  const keys = [...thread.url.searchParams.keys()];
  if (keys.some((key) => key !== "bot") || keys.length > 1) return null;
  const owner = thread.url.searchParams.get("bot");
  if (owner === null) return { threadId: thread.id };
  const botId = plainId(owner);
  return botId ? { threadId: thread.id, botId } : null;
}
