const DEFAULT_HEX = '#6366f1';

function byteToHex(value) {
  return Math.max(0, Math.min(255, Number(value) || 0)).toString(16).padStart(2, '0');
}

export function toHexColor(value, fallback = DEFAULT_HEX) {
  const text = String(value || '').trim();
  const shortHex = text.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    return `#${[...shortHex[1]].map((char) => `${char}${char}`).join('')}`.toLowerCase();
  }

  const longHex = text.match(/^#([0-9a-f]{6})$/i);
  if (longHex) return `#${longHex[1].toLowerCase()}`;

  const rgb = text.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgb) return `#${byteToHex(rgb[1])}${byteToHex(rgb[2])}${byteToHex(rgb[3])}`;

  return fallback;
}

export function groupColorsFromHex(value) {
  const hex = toHexColor(value);
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  return {
    color: `rgba(${red}, ${green}, ${blue}, 0.08)`,
    borderColor: `rgba(${red}, ${green}, ${blue}, 0.35)`,
  };
}
