// Setting up an always-on server: reading what scripts/install-server.sh prints, wherever it runs (a Boat machine or a
// server over SSH).

/** The raw URL of the installer the app runs on a new server: what the GitHub repository's main branch holds. */
export const INSTALLER_URL = "https://raw.githubusercontent.com/borjasolerme/Openpals/main/scripts/install-server.sh";

const PAIRING_LINE = /^OPENPALS_PAIRING_LINK=(https:\/\/\S+)\s*$/m;
const STEP_LINE = /^==> (.+)$/;
const KEPT_BYTES = 64 * 1024;
const TAIL_LINES = 12;

/** The pairing link the installer prints on its own machine-readable line, or null. */
export function pairingLinkIn(output) {
  return PAIRING_LINE.exec(String(output))?.[1] ?? null;
}

/** Security: output shown to the person never carries a pairing code, in text or as the QR code that encodes the link. */
export function scrubbed(text) {
  return String(text)
    .split("\n")
    .filter((line) => !line.startsWith("OPENPALS_PAIRING_LINK=") && !/^\s*pairing code:/i.test(line) && !/^[\s▀▄█]*[▀▄█][\s▀▄█]*$/.test(line))
    .map((line) => line.replace(/([#?&]code=)[^\s&]+/gi, "$1…"))
    .join("\n");
}

/** The installer's last lines, scrubbed, for a failure the person reads. */
export function lastLines(output) {
  return scrubbed(output).trimEnd().split("\n").slice(-TAIL_LINES).join("\n");
}

/** Keeps a growing installer log to its end, where the pairing link and any error are. */
export function appendOutput(log, chunk) {
  const next = log + chunk;
  return next.length > KEPT_BYTES ? next.slice(-KEPT_BYTES) : next;
}

/** Collects output that arrives in chunks and reports each installer step ("==> Installing Node 24") once its line is
 * complete. */
export function createStepReader(onStep) {
  let partial = "";
  return (chunk) => {
    const lines = (partial + chunk).split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) {
      const step = STEP_LINE.exec(line.trimEnd())?.[1];
      if (step) onStep(scrubbed(step));
    }
  };
}
