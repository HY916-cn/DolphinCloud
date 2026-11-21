// Design-system values for video. Colors, radii, the font stack and component styles
// come from the generated client theme; easings mirror bundle.css (--ease-*).
import "../../../../../client/src/theme/tokens.css";
// Real dc- component styles, so P5 shows the actual components.
import "../../../../../client/src/theme/bundle.css";
import "./still.css";
import { continueRender, delayRender, Easing, interpolate, staticFile } from "remotion";

export const easeOut = Easing.bezier(0.22, 1, 0.36, 1); // --ease-out
export const easeIn = Easing.bezier(0.4, 0, 1, 1); // --ease-in

export const font = "var(--font-sans)";

// fonts.css points at /fonts/…; rewrite to wherever Remotion serves the public dir.
const fontCss = fetch(staticFile("fonts/fonts.css"))
  .then((r) => r.text())
  .then((css) => {
    const style = document.createElement("style");
    style.textContent = css.replaceAll("url(/fonts/", `url(${staticFile("fonts/")}`);
    document.head.appendChild(style);
  });

// Load the unicode-range subsets a composition needs before its first frame.
export const loadFonts = (text: string) => {
  const handle = delayRender(`fonts: ${text.slice(0, 20)}`);
  fontCss
    .then(() =>
      Promise.all(
        ["400", "500", "600", "700", "800"].flatMap((w) =>
          ["Nunito Sans Variable", "Noto Sans SC Variable"].map((f) =>
            document.fonts.load(`${w} 40px "${f}"`, text),
          ),
        ),
      ),
    )
    .then(() => continueRender(handle));
};

// Fade from `from` over `length` frames with --ease-out, clamped to 0…1.
export const fade = (frame: number, from: number, length: number) =>
  interpolate(frame, [from, from + length], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
