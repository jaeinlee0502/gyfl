// These assignments belong to this named Hangul equation font, not Unicode
// private-use characters in general. Keep every unknown glyph untouched.
const equationGlyphs: Readonly<Record<string, string>> = {
  '\ue034': '1', '\ue035': '2', '\ue036': '3', '\ue037': '4', '\ue038': '5',
  '\ue039': '6', '\ue03a': '7', '\ue03b': '8', '\ue03c': '9', '\ue03d': '0',
  '\ue046': '−', '\ue047': '=', '\ue048': '+', '\ue05c': '√',
  '\ue0fc': 'x', '\ue0fd': 'y', '\ue0c8': '°',
}

export const hasPrivateUseCharacters = (text: string) => /[\ue000-\uf8ff]/.test(text)

export function normalizeKnownEquationText(text: string, fontName: unknown) {
  if (typeof fontName !== 'string' || !/^(?:[A-Z]{6}\+)?HyhwpEQ$/i.test(fontName)) return text
  return text.replace(/[\ue000-\uf8ff]/g, glyph => equationGlyphs[glyph] ?? glyph)
}
