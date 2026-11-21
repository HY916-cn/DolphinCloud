// A real screen (or an icon, for jobs with no screen) on a design-system card,
// floating in 3D: surface-raised, radius-lg, a thick `line` bottom and a soft float shadow.
import { Img } from "remotion";
import { font } from "./brand";
import type { Shot } from "./shots";

export const CARD_W = 760;

export const cardHeight = (shot?: Shot, width = CARD_W) =>
  shot ? Math.round((width * shot.crop[3] * shot.h) / (shot.crop[2] * shot.w)) : Math.round(width / 1.7);

type Props = {
  shot?: Shot;
  icon?: string;
  label?: string;
  labelOpacity?: number;
  // World position of the card centre and its turn toward the camera.
  x: number;
  y: number;
  z: number;
  rotY?: number;
  opacity?: number;
  blur?: number;
  width?: number;
};

export const Card: React.FC<Props> = ({ shot, icon, label, labelOpacity = 1, x, y, z, rotY = 0, opacity = 1, blur = 0, width = CARD_W }) => {
  const h = cardHeight(shot, width);
  // Show only the crop: scale the screenshot so the crop fills the card, then shift it.
  const imgW = shot ? width / shot.crop[2] : 0;
  const imgH = shot ? h / shot.crop[3] : 0;
  return (
    <div
      style={{
        position: "absolute",
        left: -width / 2,
        top: -h / 2,
        width,
        transform: `translate3d(${x}px, ${y}px, ${z}px) rotateY(${rotY}deg)`,
        opacity,
        filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
      }}
    >
      <div
        style={{
          width,
          height: h,
          borderRadius: "var(--radius-lg)",
          background: "var(--surface-raised)",
          border: "3px solid var(--line)",
          boxShadow: "0 12px 0 var(--line), 0 40px 80px rgba(19, 40, 92, 0.14)",
          overflow: "hidden",
          position: "relative",
          display: "grid",
          placeItems: "center",
        }}
      >
        {shot ? (
          <Img
            src={shot.src}
            style={{ position: "absolute", width: imgW, height: imgH, left: -shot.crop[0] * imgW, top: -shot.crop[1] * imgH }}
          />
        ) : null}
        {icon ? <Img src={icon} style={{ width: 200, height: 200 }} /> : null}
      </div>
      {label ? (
        <div
          style={{
            marginTop: 44,
            textAlign: "center",
            font: `800 64px/1.2 ${font}`,
            letterSpacing: "0.08em",
            color: "var(--ink)",
            opacity: labelOpacity,
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
};
