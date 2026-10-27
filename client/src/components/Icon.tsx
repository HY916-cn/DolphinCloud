import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { color as palette } from '@/theme';
import { icons, type IconName } from '@/theme/icons';

export type { IconName };

// The design system's Lucide icons: 24 grid, 2px round strokes, colour following the text (dolphin by default).
export function Icon({ name, size = 24, color = palette.dolphin }: { name: IconName; size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {icons[name].map((el, i) => {
        const { tag, ...attrs } = el as { tag: string } & Record<string, string>;
        if (tag === 'circle') return <Circle key={i} {...attrs} />;
        if (tag === 'rect') return <Rect key={i} {...attrs} />;
        return <Path key={i} d={attrs.d} />;
      })}
    </Svg>
  );
}
