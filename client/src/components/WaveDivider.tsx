import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { color } from '@/theme';

// dc-waves: three smooth sine bands from light to dark, each with its own wavelength and phase (as bundle.css).
const LAYERS = [
  { fill: color.cloud200, height: 56, wave: 360, amp: 20, offset: 0 },
  { fill: color.cloud300, height: 38, wave: 280, amp: 16, offset: 110 },
  { fill: color.cloud400, height: 20, wave: 220, amp: 12, offset: 50 },
];

function wavePath(width: number, total: number, { height, wave, amp, offset }: (typeof LAYERS)[number]) {
  const top = total - height;
  const y = (f: number) => top + f * amp;
  let x = (offset % wave) - wave;
  let d = `M${x} ${y(0.5)}`;
  for (; x < width; x += wave) {
    d += `C${x + wave / 6} ${y(0)} ${x + wave / 3} ${y(0)} ${x + wave / 2} ${y(0.5)}`;
    d += `S${x + (5 * wave) / 6} ${y(1)} ${x + wave} ${y(0.5)}`;
  }
  return `${d}V${total}H${(offset % wave) - wave}Z`;
}

export function WaveDivider({ height = 56 }: { height?: number }) {
  const [width, setWidth] = useState(0);
  return (
    <View aria-hidden style={{ height, overflow: 'hidden' }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Svg width={width} height={height}>
          {LAYERS.map((l) => <Path key={l.fill} d={wavePath(width, height, l)} fill={l.fill} />)}
        </Svg>
      )}
    </View>
  );
}
