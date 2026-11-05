// The one place's file (environments.json), written whole through a temporary file so a crash never leaves half of it.
import environmentsModule from "./environments.cjs";

const { LOCAL_PLACE, parsePlace, serializePlace } = environmentsModule;

/**
 * @param {{ file(): string, fs: typeof import("node:fs"), path: typeof import("node:path"), log?(line: string): void }} deps
 */
export function createPlaceFile({ file, fs, path, log = () => {} }) {
  return {
    read() {
      try {
        return parsePlace(fs.readFileSync(file(), "utf8"));
      } catch {
        return LOCAL_PLACE;
      }
    },
    write(state) {
      const target = file();
      const temporary = `${target}.${process.pid}.tmp`;
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(temporary, serializePlace(state), { mode: 0o600 });
        fs.renameSync(temporary, target);
      } catch (error) {
        try { fs.rmSync(temporary, { force: true }); } catch {}
        log(`environments save failed: ${error?.message ?? error}`);
        throw new Error("Could not save the server connection on this computer. Please try again.");
      }
    },
  };
}
