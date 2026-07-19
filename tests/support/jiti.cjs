const path = require("node:path");
const createJiti = require("jiti");

const rootDir = path.resolve(__dirname, "..", "..");

module.exports = createJiti(__filename, {
  interopDefault: true,
  alias: {
    "@": rootDir,
    // The real `server-only` package throws outside an RSC bundler; tests run
    // server modules in plain Node, so substitute an empty module.
    "server-only": path.join(__dirname, "server-only-stub.cjs"),
  },
});
