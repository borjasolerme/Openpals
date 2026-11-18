// macOS keeps Accessibility and Screen Recording for an app where it lives, and runs a downloaded app opened from
// Downloads from a hidden temporary copy. Lending this computer then fails silently, so a copy outside Applications
// offers, once per launch, to move itself there.

/** Asks to move a packaged Mac app that runs outside Applications; true when it is moving (and so relaunching). */
export async function offerMoveToApplications({ app, dialog, platform = process.platform, log = () => {} }) {
  if (platform !== "darwin" || !app.isPackaged || app.isInApplicationsFolder()) return false;
  const { response } = await dialog.showMessageBox({
    type: "question",
    message: "Move Openpals to Applications?",
    detail: "Openpals has to run from Applications so macOS keeps its screen permissions and updates work. It moves itself and opens again.",
    buttons: ["Move to Applications", "Not now"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return false;
  try {
    return app.moveToApplicationsFolder();
  } catch (error) {
    log(`move to Applications failed: ${error?.message ?? error}`);
    await dialog.showMessageBox({ type: "warning", message: "Couldn't move Openpals", detail: "Drag Openpals into Applications in Finder, then open it from there." });
    return false;
  }
}
