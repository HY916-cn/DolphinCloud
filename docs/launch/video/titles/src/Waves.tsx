import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

// The WaveDivider shape (bundle.css .dc-waves): tile path
// "M0 12C40 0 80 0 120 12S200 24 240 12" in a 240×24 box, three layers
// cloud-200 → cloud-400. Sizes below are the CSS values × `scale`.
// `depth` is the parallax factor: the back layer moves least, the front most.
const LAYERS = [
  { color: "var(--cloud-200)", height: 56, tileW: 360, tileH: 20, phase: 0, period: 24, depth: 0.5 },
  { color: "var(--cloud-300)", height: 38, tileW: 280, tileH: 16, phase: 110, period: 14, depth: 0.75 },
  { color: "var(--cloud-400)", height: 20, tileW: 220, tileH: 12, phase: 50, period: 9, depth: 1 },
];

const wavePath = (width: number, height: number, w: number, a: number, offset: number) => {
  let d = `M${offset - w} ${a / 2}`;
  for (let x = offset - w; x < width; x += w) {
    d += `C${x + w / 6} 0 ${x + w / 3} 0 ${x + w / 2} ${a / 2}`;
    d += `C${x + (2 * w) / 3} ${a} ${x + (5 * w) / 6} ${a} ${x + w} ${a / 2}`;
  }
  return `${d}V${height}H${offset - w}Z`;
};

type Props = {
  scale: number;
  // Camera height in px: positive pushes the sea down out of frame, scaled per layer by depth.
  camY?: number;
  // Camera dolly toward the frame centre, as extra scale on the front layer (0.06 = 6%).
  dolly?: number;
  // Blur of the front layer in px (the back layer stays sharp).
  focusBlur?: number;
  // Drift sideways like .dc-waves.is-drifting (one tile per 24 s / 14 s / 9 s).
  drift?: boolean;
  // Override the drift speed so a loop of `loopSeconds` wraps seamlessly.
  loopSeconds?: number;
};

export const Waves: React.FC<Props> = ({ scale, camY = 0, dolly = 0, focusBlur = 0, drift = true, loopSeconds }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;

  return (
    <AbsoluteFill>
      {LAYERS.map((l, i) => {
        const h = l.height * scale;
        const w = l.tileW * scale;
        // Extra fill below the frame so a dolly never shows the bottom edge.
        const below = 60 * scale;
        // Whole tiles per loop keep a loop seamless; otherwise use the CSS period.
        const tilesPerSecond = loopSeconds
          ? Math.max(1, Math.round(loopSeconds / l.period)) / loopSeconds
          : 1 / l.period;
        const offset = drift ? (l.phase * scale + t * tilesPerSecond * w) % w : l.phase * scale;
        return (
          <AbsoluteFill
            key={l.color}
            style={{
              translate: `0 ${camY * l.depth}px`,
              scale: 1 + dolly * l.depth,
              // Each layer casts a soft shade on the one behind it; the focus sits beyond the
              // sea, so nearer layers are slightly softer (depth of field).
              filter: i
                ? `drop-shadow(0 ${-2 * scale}px ${6 * scale}px rgba(19, 40, 92, 0.1)) blur(${(l.depth - 0.5) * focusBlur}px)`
                : undefined,
            }}
          >
            <svg width={width} height={h + below} style={{ position: "absolute", left: 0, bottom: -below }}>
              <path d={wavePath(width, h + below, w, l.tileH * scale, offset)} fill={l.color} />
            </svg>
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};
