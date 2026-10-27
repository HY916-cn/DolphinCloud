import { color, fallbackFonts, radius, shadow, space, type } from './tokens';

export { color, radius, shadow, space };

// Nunito Sans is bundled per weight (see app/_layout.tsx); Chinese falls back to the system faces in tokens.json.
const nunito = {
  400: 'NunitoSans_400Regular',
  500: 'NunitoSans_500Medium',
  600: 'NunitoSans_600SemiBold',
  700: 'NunitoSans_700Bold',
  800: 'NunitoSans_800ExtraBold',
} as const;
export type Weight = keyof typeof nunito;

// shortcut: a CSS font stack in fontFamily only works on web, which is the only platform in phase 1.
export const font = (weight: Weight) => ({
  fontFamily: `${nunito[weight]}, ${fallbackFonts}`,
  fontWeight: String(weight) as `${Weight}`,
});

type Style = (typeof type)[keyof typeof type];
const textStyle = (s: Style) => ({ ...s, ...font(s.fontWeight as Weight) });

export const text = {
  display: textStyle(type.display),
  title: textStyle(type.title),
  heading: textStyle(type.heading),
  amount: { ...textStyle(type.amount), fontVariant: ['tabular-nums' as const] },
  bodyLg: textStyle(type.bodyLg),
  body: textStyle(type.body),
  caption: textStyle(type.caption),
};
