require("dotenv").config();
const path = require("path");

module.exports = {
  port: process.env.PORT || 3000,
  sessionDir: path.resolve(process.env.SESSION_DIR || "./storage/sessions"),
};
