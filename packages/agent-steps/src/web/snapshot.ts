// agent-browser's accessibility snapshot, read as elements: `- link "Billing" [ref=e5]`, nested by indentation, frames
// below an `iframe` line. Refs change with every snapshot, so a step keeps the role and name and finds the ref again.

export interface SnapshotNode {
  ref?: string;
  role: string;
  name: string;
  /** The closest heading or landmark above it with a name. */
  near?: string;
  frame?: true;
}

const LINE = /^(\s*)- ([^\s"[\]:]+)(?: "((?:[^"\\]|\\.)*)")?/u;
const REF = /\bref=(e\d+)\b/u;
const LANDMARKS = new Set(["heading", "main", "navigation", "banner", "contentinfo", "region", "form", "dialog", "alertdialog", "complementary", "search"]);

const unquote = (name: string): string => {
  try {
    return JSON.parse(`"${name}"`) as string;
  } catch {
    return name;
  }
};

/** The elements of every snapshot in `text`, in page order. A text without one snapshot line gives none. */
export function readSnapshot(text: string): SnapshotNode[] {
  const nodes: SnapshotNode[] = [];
  const frames: number[] = [];
  let near: string | undefined;
  for (const line of text.split("\n")) {
    const item = LINE.exec(line);
    if (!item) continue;
    const indent = item[1]!.length;
    while (frames.length && frames.at(-1)! >= indent) frames.pop();
    const role = item[2]!;
    const name = unquote(item[3] ?? "").trim();
    const ref = REF.exec(line)?.[1];
    if (ref) nodes.push({ ref, role, name, ...(near !== undefined ? { near } : {}), ...(frames.length ? { frame: true as const } : {}) });
    if (role.toLowerCase() === "iframe") frames.push(indent);
    if (LANDMARKS.has(role.toLowerCase()) && name) near = name;
  }
  return nodes;
}

/** `@e12`, `e12`: a snapshot ref. Anything else (a CSS selector) is not one. */
export function refOf(selector: unknown): string | undefined {
  return typeof selector === "string" ? /^@?(e\d+)$/u.exec(selector.trim())?.[1] : undefined;
}

/** The page as a step keeps it: origin and path, without query or fragment. */
export function pageOf(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? `${parsed.origin}${parsed.pathname}` : undefined;
  } catch {
    return undefined;
  }
}

const sameFrame = (node: SnapshotNode, frame: true | undefined) => (node.frame === true) === (frame === true);

/** Elements with this role and name (and, when given, the same heading or landmark above), in the same kind of frame. */
export function matching(nodes: readonly SnapshotNode[], target: { role: string; name: string; near?: string; frame?: true }): SnapshotNode[] {
  return nodes.filter((node) => node.role === target.role && node.name === target.name && sameFrame(node, target.frame)
    && (target.near === undefined || node.near === target.near));
}
