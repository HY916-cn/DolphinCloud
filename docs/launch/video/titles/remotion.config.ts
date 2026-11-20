// Renders use `npx remotion render`; the Node APIs ignore this file.
import { Config } from "@remotion/cli/config";

Config.setRspack(true);
Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
Config.setDefaultPremountInSeconds(2);
// Compositions are laid out at 1920×1080 and rendered at 2× = 3840×2160.
Config.setScale(2);
// Fonts and the logo come straight from the client's self-hosted copies.
Config.setPublicDir("../../../../client/public");
