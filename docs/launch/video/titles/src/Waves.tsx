import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";

// The WaveDivider shape (bundle.css .dc-waves): tile path
// "M0 12C40 0 80 0 120 12S200 24 240 12" in a 240×24 box, three layers
// cloud-200 → cloud-400. Sizes below are the CSS values × `scale`.
const LAYERS = [
  { color: "var(--cloud-200)", height: 56, tileW: 360, tileH: 20, phase: 0, period: 24 },
  { color: "var(--cloud-300)", height: 38, tileW: 280, tileH: 16, phase: 110, period: 14 },
  { color: "var(--cloud-400)", height: 20, tileW: 220, tileH: 12, phase: 50, period: 9 },
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
  // Frame each layer starts rising from below the frame; omit to show them settled.
  riseFrom?: number;
  // Drift sideways like .dc-waves.is-drifting (one tile per 24 s / 14 s / 9 s).
  drift?: boolean;
  // Override the drift speed so a loop of `loopSeconds` wraps seamlessly.
  loopSeconds?: number;
};

export const Waves: React.FC<Props> = ({ scale, riseFrom, drift = true, loopSeconds }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;

  return (
    <AbsoluteFill>
      {LAYERS.map((l, i) => {
        const h = l.height * scale;
        // Extra fill below the frame so the overshoot never shows a gap.
        const below = 40 * scale;
        const w = l.tileW * scale;
        // Whole tiles per loop keep a loop seamless; otherwise use the CSS period.
        const tilesPerSecond = loopSeconds
          ? Math.max(1, Math.round(loopSeconds / l.period)) / loopSeconds
          : 1 / l.period;
        const offset = drift ? ((l.phase * scale + t * tilesPerSecond * w) % w) : l.phase * scale;
        // Back layer leads, front layers follow 4 frames apart and settle a touch later.
        const rise =
          riseFrom === undefined
            ? 1
            : spring({
                frame: frame - riseFrom - i * 4,
                fps,
                config: { damping: 8, mass: 1 + i * 0.15, stiffness: 30 },
              });
        return (
          <svg
            key={l.color}
            width={width}
            height={h + below}
            style={{
              position: "absolute",
              left: 0,
              bottom: -below,
              translate: `0 ${(1 - rise) * (h + below)}px`,
            }}
          >
            <path d={wavePath(width, h + below, w, l.tileH * scale, offset)} fill={l.color} />
          </svg>
        );
      })}
    </AbsoluteFill>
  );
};
