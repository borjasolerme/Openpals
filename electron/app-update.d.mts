/** The commit this app was built from and when; both empty in a development run. */
export type AppBuild = { commit: string; builtAt: string };

/** What Settings → General's update row shows. Never a file path. */
export type AppUpdateState = {
  state: "idle" | "checking" | "current" | "available" | "downloading" | "verifying" | "installing" | "error";
  current: AppBuild;
  /** The latest release, once a check reached GitHub. */
  latest?: { commit: string; publishedAt: string; url: string };
  /** Update and restart is possible: the packaged macOS app, and the release carries the macOS zip. */
  canInstall: boolean;
  /** The release page, for installing by hand. */
  downloadPage: string;
  /** While downloading, when the size is known. */
  percent?: number;
  /** check: GitHub could not be reached; unpackaged: a development run; verify: the download's signature was refused;
   * install: downloading or replacing the app failed. */
  error?: "check" | "unpackaged" | "verify" | "install";
};

export declare const LATEST_RELEASE_API: string;
export declare const RELEASES_PAGE: string;
export declare const MAC_ASSET: string;
export declare const BUILD_INFO_FILE: string;
