const path = require("node:path");
const createJiti = require("jiti");

const rootDir = path.resolve(__dirname, "..", "..");

module.exports = createJiti(__filename, {
  interopDefault: true,
  alias: {
    "@": rootDir,
  },
});
