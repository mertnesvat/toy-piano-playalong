// Canvas paths for the toy's key marks.
import type { ToyKey } from './mapping';

export function drawShape(g: CanvasRenderingContext2D, shape: ToyKey['shape'], x: number, y: number, r: number, color: string) {
  g.save();
  g.fillStyle = color;
  g.beginPath();
  const poly = (n: number, rot: number, rad = r) => {
    for (let i = 0; i < n; i++) {
      const a = rot + (i * 2 * Math.PI) / n;
      g.lineTo(x + rad * Math.cos(a), y + rad * Math.sin(a));
    }
    g.closePath();
  };
  switch (shape) {
    case 'circle': g.arc(x, y, r, 0, Math.PI * 2); break;
    case 'square': g.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7); break;
    case 'triangle': poly(3, -Math.PI / 2, r * 1.1); break;
    case 'hexagon': poly(6, 0); break;
    case 'diamond': poly(4, -Math.PI / 2, r * 1.05); break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.45 : r * 1.1;
        g.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
      }
      g.closePath();
      break;
    case 'heart':
      g.moveTo(x, y + r * 0.9);
      g.bezierCurveTo(x - r * 1.4, y - r * 0.1, x - r * 0.6, y - r * 1.2, x, y - r * 0.4);
      g.bezierCurveTo(x + r * 0.6, y - r * 1.2, x + r * 1.4, y - r * 0.1, x, y + r * 0.9);
      break;
    case 'moon':
      g.arc(x, y, r, Math.PI * 0.35, Math.PI * 1.65);
      g.arc(x + r * 0.55, y, r * 0.8, Math.PI * 1.45, Math.PI * 0.55, true);
      break;
    default: g.arc(x, y, r * 0.5, 0, Math.PI * 2);
  }
  g.fill();
  g.restore();
}

/** A key mark as an <img> tag, for HTML lists. */
export function shapeImg(shape: ToyKey['shape'], color = '#000', size = 18): string {
  const c = document.createElement('canvas');
  c.width = c.height = size * 2;
  drawShape(c.getContext('2d')!, shape, size, size, size * 0.7, color);
  return `<img alt="" width="${size}" height="${size}" src="${c.toDataURL()}">`;
}
