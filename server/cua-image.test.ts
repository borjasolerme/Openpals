import { describe, expect, it } from "vitest";

import {
  BASE_IMAGE,
  BASE_IMAGE_DIGEST,
  BASE_IMAGE_LABEL,
  CUA_DRIVER_VERSION,
  CUA_EXECUTABLE,
  CUA_SOCKET,
  DRIVER_LABEL,
  IMAGE_LAYER_LABEL,
  IMAGE_LAYER_VERSION,
  MANAGED_LABEL,
  cuaExecArgs,
  imageLabelsMatch,
  managedImageDockerfile,
  wholeScreenshot,
} from "./cua-image.ts";

describe("Cua desktop image", () => {
  it("builds an exact, checksum-verified Cua Driver 0.37.0 image", () => {
    const dockerfile = managedImageDockerfile();
    expect(BASE_IMAGE).toMatch(/@sha256:[a-f0-9]{64}$/);
    expect(dockerfile).toContain(`FROM ${BASE_IMAGE}`);
    expect(dockerfile).toContain("cua_driver-0.37.0-py3-none-manylinux_2_31_x86_64.whl");
    expect(dockerfile).toContain("cua_driver-0.37.0-py3-none-manylinux_2_31_aarch64.whl");
    expect(dockerfile).not.toContain("/tmp/cua-driver.whl");
    expect(dockerfile).toContain("sha256sum -c -");
    expect(dockerfile).toContain(`install -D -m 0755 "$driver_bin" ${CUA_EXECUTABLE}`);
    expect(dockerfile).toContain(`cua-driver ${CUA_DRIVER_VERSION}`);
    expect(dockerfile).toContain(`serve --socket ${CUA_SOCKET} --permission-mode standard`);
    expect(dockerfile).toContain("CUA_DRIVER_RS_TELEMETRY_ENABLED=0");
    // 0.37.0 waits 800 ms after every foreground key, click or scroll for a window it might open, and glides its agent cursor
    // for about 0.6 s before each pixel action; plain logs feed desktop_error.
    expect(dockerfile).toContain(`CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS=200 NO_COLOR=1 ${CUA_EXECUTABLE} serve`);
    expect(dockerfile).toContain(`--permission-mode standard --cursor-reduced-motion on'`);
    expect(dockerfile).toContain("prepare-openmausbot-workspace.sh");
    expect(dockerfile).toContain('if ! chmod 0700 "$workspace"');
    expect(dockerfile).toContain('test -r "$directory" && test -w "$directory" && test -x "$directory"');
    expect(dockerfile).toContain('migrate_profile "$HOME/.config/google-chrome" google-chrome');
    expect(dockerfile).toContain('migrate_profile "$HOME/.config/chromium" chromium');
    expect(dockerfile).toContain('migrate_profile "$HOME/.mozilla" mozilla');
    expect(dockerfile).toContain("SingletonLock");
    expect(dockerfile).toContain(`${IMAGE_LAYER_LABEL}="${IMAGE_LAYER_VERSION}"`);
    expect(dockerfile).toContain("did not become ready within 45 seconds");
    expect(dockerfile).not.toContain("while ! DISPLAY=:1 xset q");
  });

  it("installs checksum-pinned Japanese fonts and their license before the desktop starts", () => {
    const dockerfile = managedImageDockerfile();
    expect(dockerfile).toContain("NotoSansCJKjp-Regular.otf");
    expect(dockerfile).toContain("68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5");
    expect(dockerfile).toContain("6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2");
    expect(dockerfile).toContain("/usr/local/share/licenses/noto-cjk/OFL.txt");
    expect(dockerfile).toContain("fc-cache -f");
    expect(IMAGE_LAYER_VERSION).toBe("8");
  });

  it("starts the driver's Chrome without its own sandbox inside the hardened container", () => {
    // Without it Chrome exits with code 21 ("Failed to move to new namespace"): see the start-script comment.
    const dockerfile = managedImageDockerfile();
    const exec = dockerfile.split("\n").find((line) => line.includes(`${CUA_EXECUTABLE} serve`));
    expect(exec).toContain("exec env CUA_DRIVER_BROWSER_NO_SANDBOX=1 ");
  });

  it("rejects a zero-byte OpenSSL base image before the wheel download needs curl", () => {
    const dockerfile = managedImageDockerfile();
    expect(dockerfile).toContain('"/lib/$lib_triplet/libssl.so.3"');
    expect(dockerfile).toContain('"/lib/$lib_triplet/libcrypto.so.3"');
    expect(dockerfile).toContain("[ ! -s \"$ssl_lib\" ]");
    expect(dockerfile).toContain("is zero bytes, so curl cannot start");
    const gate = dockerfile.indexOf('[ ! -s "$ssl_lib" ]');
    const fetch = dockerfile.indexOf("curl -fsSL");
    expect(gate).toBeGreaterThan(-1);
    expect(fetch).toBeGreaterThan(gate);
  });

  it("accepts only an image carrying every current label", () => {
    const labels = {
      [MANAGED_LABEL]: "1",
      [DRIVER_LABEL]: CUA_DRIVER_VERSION,
      [BASE_IMAGE_LABEL]: BASE_IMAGE_DIGEST,
      [IMAGE_LAYER_LABEL]: IMAGE_LAYER_VERSION,
    };
    expect(imageLabelsMatch(labels)).toBe(true);
    expect(imageLabelsMatch({ ...labels, [IMAGE_LAYER_LABEL]: "7" })).toBe(false);
    expect(imageLabelsMatch(undefined)).toBe(false);
  });

  it("runs Cua Driver as the desktop's own user in the named container", () => {
    expect(cuaExecArgs(["mcp", "--socket", CUA_SOCKET], { container: "box", interactive: true })).toEqual([
      "exec", "-i", "-u", "cua", "-e", "HOME=/home/cua", "-e", "DISPLAY=:1",
      "-e", "CUA_DRIVER_INSTALL_CHANNEL=python_package", "-e", "CUA_DRIVER_RS_TELEMETRY_ENABLED=0",
      "box", CUA_EXECUTABLE, "mcp", "--socket", CUA_SOCKET,
    ]);
  });

  it("never treats a truncated screenshot as a frame", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(600), Buffer.from("IEND", "ascii")]);
    expect(wholeScreenshot(png)).toEqual({ ok: true, mime: "image/png" });
    expect(wholeScreenshot(png.subarray(0, 590))).toEqual({ ok: false, mime: "image/png" });
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(600), Buffer.from([0xff, 0xd9])]);
    expect(wholeScreenshot(jpeg)).toEqual({ ok: true, mime: "image/jpeg" });
  });
});
