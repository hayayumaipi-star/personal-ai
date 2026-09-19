/* Metro は .html をそのままでは同梱しないので、資産として扱わせる。
   これが無いと `require("./assets/app.html")` が通らない。 */
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push("html");
module.exports = config;
