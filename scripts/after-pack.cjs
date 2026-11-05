const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");

module.exports = async (context) => {
  if (context.electronPlatformName !== "darwin") return;
  // Desktop/Finder can attach resource-fork metadata during extraction. Clean
  // only this freshly generated bundle before codesign, never source files.
  const bundle = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  // The bundled JRE ships read-only license files. Make only the new staging
  // copy owner-writable before stripping Finder metadata and signing it.
  await promisify(execFile)("/bin/chmod", ["-R", "u+w", bundle]);
  await promisify(execFile)("/usr/bin/xattr", ["-cr", bundle]);
};
