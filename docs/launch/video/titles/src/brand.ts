// Design-system values for video. Colors, radii and the font stack come from the
// generated client theme (tokens.css); easings mirror bundle.css (--ease-*).
import "../../../../../client/src/theme/tokens.css";
import { continueRender, delayRender, Easing, staticFile } from "remotion";

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
