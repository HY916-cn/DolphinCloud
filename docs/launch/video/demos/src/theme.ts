// Values from design-system/project/tokens.json and motion.md, so the frame around a demo speaks the product's language.
import { useEffect, useState } from "react";
import { continueRender, delayRender, Easing } from "remotion";
import "@fontsource-variable/nunito-sans";
// The client's own copy of Noto Sans SC (the font the app ships), so the callouts match the screens.
import "../../../../../client/node_modules/@fontsource-variable/noto-sans-sc/index.css";

export const color = {
  surface: "#f4f7ff",
  raised: "#ffffff",
  cloud100: "#e2e9fc",
  cloud200: "#c9d6f8",
  dolphin: "#1f5ff5",
  dolphinDeep: "#1546c4",
  ink: "#13285c",
  inkMuted: "#4a5b85",
  line: "#d6e0fa",
  success: "#0b6e4c",
  successSoft: "#dcf5ea",
};

export const font = '"Nunito Sans Variable", "Noto Sans SC Variable", sans-serif';

// Holds the frame until the fonts for `text` are loaded (the Chinese font comes in slices by unicode-range).
export const useFonts = (text: string) => {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    Promise.all(["700", "800"].map((w) => document.fonts.load(`${w} 40px ${font}`, text))).then(() => continueRender(handle));
  }, [handle, text]);
};

// --ease-out and --ease-bounce from motion.md.
export const easeOut = Easing.bezier(0.22, 1, 0.36, 1);
export const easeBounce = Easing.bezier(0.34, 1.56, 0.64, 1);

export const FPS = 30;
export const WIDTH = 3840;
export const HEIGHT = 2160;
