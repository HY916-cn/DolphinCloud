// The stopwatch in the corner of the counter demos: it starts on the teller's first key and stops when the deposit
// is booked, both read from the recording's markers, so it shows the time the business really took.
import { interpolate } from "remotion";
import { useT } from "./stage";
import { color, easeBounce, easeOut, font } from "./theme";

// Lucide clock and check, as in design-system/project/assets/Icons.
const Clock = () => (
  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke={color.dolphin} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);
const Check = () => (
  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke={color.success} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const Timer = ({ start, stop, show = start - 400 }: { start: number; stop: number; show?: number }) => {
  const t = useT();
  const elapsed = Math.min(Math.max(t - start, 0), stop - start);
  const done = t >= stop;
  // The check pops in 320 ms with --ease-bounce, as dc-pop does.
  const pop = interpolate(t, [stop, stop + 320], [0.6, 1], { ...clamp, easing: easeBounce });
  const k = interpolate(t, [show, show + 240], [0, 1], { ...clamp, easing: easeOut });
  return (
    <div
      style={{
        position: "absolute",
        top: 120,
        right: 140,
        display: "flex",
        alignItems: "center",
        gap: 28,
        padding: "26px 52px 26px 40px",
        borderRadius: 999,
        background: done ? color.successSoft : color.raised,
        boxShadow: `0 10px 0 ${done ? "#b9e6d2" : color.line}, 0 24px 60px rgba(31, 95, 245, 0.14)`,
        fontFamily: font,
        color: done ? color.success : color.ink,
        opacity: k,
        translate: `0 ${(1 - k) * 12}px`,
      }}
    >
      <div style={{ width: 64, height: 64 }}>{done ? <div style={{ scale: String(pop) }}><Check /></div> : <Clock />}</div>
      <div style={{ fontSize: 76, fontWeight: 800, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>
        {(elapsed / 1000).toFixed(1)}
        <span style={{ fontSize: 48, fontWeight: 700, marginLeft: 14, color: done ? color.success : color.inkMuted }}>秒</span>
      </div>
    </div>
  );
};
