// What every demo shares. A device floats in a soft cloud-coloured space (CSS 3D), its screen playing a real
// recording; the parts being talked about lift out of the screen as layers cut from the same recording, so they
// keep moving; the camera tilts, turns and pushes in slowly; callouts ring what to look at. One take can feed
// several clips: `from` is where in the recording a clip starts.
import { createContext, useContext, type ReactNode } from "react";
import { AbsoluteFill, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { color, easeOut, font, FPS, HEIGHT, WIDTH } from "./theme";

export type Rect = { x: number; y: number; width: number; height: number };
export type Marker = { label: string; t: number; x?: number; y?: number; rects?: Record<string, Rect> };
export type Capture = { width: number; height: number; scale: number; durationMs: number; markers: Marker[] };

export const marker = (capture: Capture, label: string, nth = 0) => {
  const m = capture.markers.filter((x) => x.label === label)[nth];
  if (!m) throw new Error(`no marker ${label}#${nth}`);
  return m;
};

// A device's screen in the recording's CSS pixels, drawn at `scale` frame pixels per CSS pixel, centred in the frame.
export type Screen = { width: number; height: number; scale: number };
type Take = { src: string; capture: Capture; screen: Screen; from: number };
const TakeContext = createContext<Take | null>(null);
const useTake = () => useContext(TakeContext)!;

// Milliseconds into the recording at the current frame.
export const useT = () => {
  const { from } = useTake();
  return from + (useCurrentFrame() / FPS) * 1000;
};

// `a` may be Infinity for "never".
const ease = (t: number, a: number, b: number, from: number, to: number, easing = easeOut) =>
  Number.isFinite(a) ? interpolate(t, [a, b], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing }) : from;

// Where the camera looks (a point on the screen, CSS px), how far it has pushed in, and how the device is turned
// (degrees). A move starts at `at` (ms of the recording) and lasts `ms`, with the design system's ease-out.
export type Shot = { at: number; ms: number; x: number; y: number; zoom: number; rx: number; ry: number };
type View = Omit<Shot, "at" | "ms">;

const mix = (a: View, b: View, p: number): View => ({
  x: a.x + (b.x - a.x) * p,
  y: a.y + (b.y - a.y) * p,
  // Zoom moves evenly in scale space, so a push-in and a pull-back feel the same speed.
  zoom: a.zoom * Math.pow(b.zoom / a.zoom, p),
  rx: a.rx + (b.rx - a.rx) * p,
  ry: a.ry + (b.ry - a.ry) * p,
});

const viewAt = (start: View, shots: Shot[], t: number): View => {
  let v = start;
  for (const s of shots) {
    if (t < s.at) break;
    v = mix(v, s, ease(t, s.at, s.at + s.ms, 0, 1));
  }
  return v;
};

// The scene: background, floor shadow, and a 3D world holding the device and its layers.
export const Scene = ({ take, start, shots, children, overlay }: {
  take: Take; start: View; shots: Shot[]; children?: ReactNode; overlay?: ReactNode;
}) => (
  <TakeContext.Provider value={take}>
    <SceneInner start={start} shots={shots} overlay={overlay}>{children}</SceneInner>
  </TakeContext.Provider>
);

const SceneInner = ({ start, shots, children, overlay }: { start: View; shots: Shot[]; children?: ReactNode; overlay?: ReactNode }) => {
  const { screen } = useTake();
  const v = viewAt(start, shots, useT());
  // Keep the view on the screen: centred on an axis where it is wider than the screen, else not past its edges.
  const fit = (p: number, half: number, size: number) => (half >= size / 2 ? size / 2 : Math.min(Math.max(p, half), size - half));
  const x = fit(v.x, WIDTH / 2 / (screen.scale * v.zoom), screen.width);
  const y = fit(v.y, HEIGHT / 2 / (screen.scale * v.zoom), screen.height);
  const cx = (WIDTH - screen.width * screen.scale) / 2 + x * screen.scale;
  const cy = (HEIGHT - screen.height * screen.scale) / 2 + y * screen.scale;
  const tilt = Math.min(1, (Math.abs(v.rx) + Math.abs(v.ry)) / 20);
  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${color.surface} 0%, ${color.cloud100} 100%)`, overflow: "hidden" }}>
      {/* The floor shadow: softer and wider the more the device is turned. */}
      <div
        style={{
          position: "absolute",
          left: WIDTH / 2 - (screen.width * screen.scale * 0.42) / v.zoom,
          width: (screen.width * screen.scale * 0.84) / v.zoom,
          top: HEIGHT / 2 + (screen.height * screen.scale * 0.5 + 140) * Math.min(v.zoom, 1.2) - 60,
          height: 120,
          borderRadius: "50%",
          background: "rgba(19, 40, 92, 0.16)",
          filter: `blur(${60 + tilt * 40}px)`,
          opacity: Math.max(0, 1.4 - v.zoom),
        }}
      />
      <AbsoluteFill style={{ perspective: 5200, perspectiveOrigin: "50% 45%" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            transformStyle: "preserve-3d",
            transformOrigin: "0 0",
            transform: `translate(${WIDTH / 2}px, ${HEIGHT / 2}px) scale(${v.zoom}) rotateX(${v.rx}deg) rotateY(${v.ry}deg) translate(${-cx}px, ${-cy}px)`,
          }}
        >
          {children}
        </div>
      </AbsoluteFill>
      {overlay}
    </AbsoluteFill>
  );
};

const screenLeft = (s: Screen) => (WIDTH - s.width * s.scale) / 2;
const screenTop = (s: Screen) => (HEIGHT - s.height * s.scale) / 2;

// The recording, frame-accurate. A copy cropped to `rect` is what a lifted layer shows.
const Footage = ({ rect }: { rect?: Rect }) => {
  const { src, screen, from } = useTake();
  return (
    <OffthreadVideo
      src={staticFile(src)}
      muted
      trimBefore={Math.round((from / 1000) * FPS)}
      style={{
        position: "absolute",
        left: -(rect?.x ?? 0) * screen.scale,
        top: -(rect?.y ?? 0) * screen.scale,
        width: screen.width * screen.scale,
        height: screen.height * screen.scale,
      }}
    />
  );
};

// iPad (landscape): an even dark bezel with rounded corners. `dim` (0–1) shades the screen a little while layers
// float above it, so they read as nearer.
export const Ipad = ({ dim = 0, children }: { dim?: number; children?: ReactNode }) => {
  const { screen } = useTake();
  const bezel = 20 * screen.scale;
  const radius = 18 * screen.scale;
  const w = screen.width * screen.scale;
  const h = screen.height * screen.scale;
  return (
    <div
      style={{
        position: "absolute",
        left: screenLeft(screen) - bezel,
        top: screenTop(screen) - bezel,
        width: w + 2 * bezel,
        height: h + 2 * bezel,
        borderRadius: radius + bezel,
        background: "#1d2230",
        boxShadow: `0 0 0 ${0.8 * screen.scale}px #4b5266 inset, 0 ${30 * screen.scale}px ${70 * screen.scale}px rgba(19, 40, 92, 0.2)`,
      }}
    >
      <div style={{ position: "absolute", left: bezel, top: bezel, width: w, height: h, borderRadius: radius, overflow: "hidden", background: color.surface }}>
        <Footage />
        <div style={{ position: "absolute", inset: 0, background: color.ink, opacity: dim * 0.1 }} />
        {children}
      </div>
    </div>
  );
};

// A part of the screen lifted towards the viewer by `lift` (0–1) to `z` frame px, cut from the live recording with
// the component's own corner radius (radius-lg) and the floating shadow (shadow-float).
export const Layer = ({ rect, lift, z, radius = 28 }: { rect: Rect; lift: number; z: number; radius?: number }) => {
  const { screen } = useTake();
  if (lift <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: screenLeft(screen) + rect.x * screen.scale,
        top: screenTop(screen) + rect.y * screen.scale,
        width: rect.width * screen.scale,
        height: rect.height * screen.scale,
        borderRadius: radius * screen.scale,
        overflow: "hidden",
        transform: `translateZ(${lift * z}px)`,
        boxShadow: `0 ${lift * 40}px ${lift * 110}px rgba(31, 95, 245, ${0.22 * lift}), 0 ${lift * 10}px ${lift * 24}px rgba(19, 40, 92, ${0.12 * lift})`,
      }}
    >
      <Footage rect={rect} />
    </div>
  );
};

// How far a layer has lifted: up over 1350 ms from `up`, back down over 900 ms from `down`.
export const useLift = (up: number, down = Infinity) => {
  const t = useT();
  return Math.min(ease(t, up, up + 1350, 0, 1), ease(t, down, down + 900, 1, 0, easeOut));
};

// A ring around `rect` (CSS px of the screen) and a short label beside it, floating at `z`. They come in like
// dc-enter (12 px up and fade, 240 ms), the ring settling from 1.04.
export const Callout = ({ rect, at, until = Infinity, text, side = "top", z = 0, pad = 8 }: {
  rect: Rect; at: number; until?: number; text: string; side?: "top" | "bottom" | "left" | "right"; z?: number; pad?: number;
}) => {
  const { screen } = useTake();
  const t = useT();
  const k = Math.min(ease(t, at, at + 240, 0, 1), ease(t, until, until + 160, 1, 0));
  if (k <= 0) return null;
  const s = screen.scale;
  const r = { x: (rect.x - pad) * s, y: (rect.y - pad) * s, w: (rect.width + 2 * pad) * s, h: (rect.height + 2 * pad) * s };
  const label: React.CSSProperties = {
    position: "absolute",
    whiteSpace: "nowrap",
    padding: `${10 * s}px ${20 * s}px`,
    borderRadius: 999,
    background: color.dolphin,
    color: "#ffffff",
    font: `700 ${22 * s}px/${30 * s}px ${font}`,
    boxShadow: `0 ${5 * s}px 0 ${color.dolphinDeep}`,
    translate: `0 ${(1 - k) * 12 * s}px`,
    ...(side === "top" && { left: r.w / 2, bottom: r.h + 18 * s, transform: "translateX(-50%)" }),
    ...(side === "bottom" && { left: r.w / 2, top: r.h + 18 * s, transform: "translateX(-50%)" }),
    ...(side === "left" && { right: r.w + 18 * s, top: r.h / 2, transform: "translateY(-50%)" }),
    ...(side === "right" && { left: r.w + 18 * s, top: r.h / 2, transform: "translateY(-50%)" }),
  };
  return (
    <div
      style={{
        position: "absolute",
        left: screenLeft(screen) + r.x,
        top: screenTop(screen) + r.y,
        width: r.w,
        height: r.h,
        transform: `translateZ(${z + 2}px)`,
        opacity: k,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: (28 + pad) * s,
          border: `${4 * s}px solid ${color.dolphin}`,
          boxShadow: `0 0 0 ${3 * s}px rgba(255, 255, 255, 0.85)`,
          scale: String(1 + (1 - k) * 0.04),
        }}
      />
      <div style={label}>{text}</div>
    </div>
  );
};

// A soft ring where a finger touched the screen: it appears with the touch and fades over 500 ms. Drawn on the
// device, or on a lifted layer when `rect` and `z` say which (only touches inside it).
export const Touches = ({ rect, z = 0, lift = 1 }: { rect?: Rect; z?: number; lift?: number }) => {
  const { capture, screen } = useTake();
  const t = useT();
  const s = screen.scale;
  return (
    <>
      {capture.markers
        .filter((m) => m.x !== undefined && t >= m.t - 60 && t < m.t + 500)
        .filter((m) => !rect || (m.x! >= rect.x && m.x! <= rect.x + rect.width && m.y! >= rect.y && m.y! <= rect.y + rect.height))
        .map((m, i) => {
          const k = ease(t, m.t - 60, m.t + 500, 0, 1, (x) => x);
          const size = 44 * s;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: (rect ? screenLeft(screen) : 0) + m.x! * s - size / 2,
                top: (rect ? screenTop(screen) : 0) + m.y! * s - size / 2,
                width: size,
                height: size,
                borderRadius: "50%",
                background: "rgba(19, 40, 92, 0.16)",
                border: `${1.5 * s}px solid rgba(255, 255, 255, 0.7)`,
                transform: rect ? `translateZ(${lift * z + 1}px)` : undefined,
                opacity: interpolate(k, [0, 0.12, 1], [0, 1, 0]),
                scale: String(interpolate(k, [0, 0.12, 1], [0.7, 1, 1.25])),
              }}
            />
          );
        })}
    </>
  );
};
