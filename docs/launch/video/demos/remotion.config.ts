// Captures (recorded by capture/*.mjs, not in Git) are the public folder, so staticFile('demo1.mp4') reads them.
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setOverwriteOutput(true);
Config.setPublicDir("captures");
