import { createCanvas, loadImage, registerFont } from 'canvas';
import path from 'path';

const FONT_FAMILY = 'ArialVN';
try {
  registerFont(path.join(process.cwd(), 'fonts', 'arialbd.ttf'), { family: FONT_FAMILY, weight: 'bold' });
} catch { /* font already registered or missing — fall back to system ${FONT_FAMILY}, sans-serif */ }

export async function generateStockImageServer(
  displayCode: string,
  imageUrl: string | null,
  variants: Array<{ color: string; size: string; stock: number | null }>
): Promise<string> {
  const W = 800, H = 1000;
  const canvas = createCanvas(W, H);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = canvas.getContext('2d') as any;

  let imgLoaded = false;
  if (imageUrl) {
    try {
      const img = await loadImage(imageUrl);
      const iw = img.width;
      const ih = img.height;
      if (iw > 0 && ih > 0) {
        const scale = Math.max(W / iw, H / ih);
        const dx = (W - iw * scale) / 2;
        const dy = (H - ih * scale) / 2;
        ctx.drawImage(img, dx, dy, iw * scale, ih * scale);
        imgLoaded = true;
      }
    } catch { /* fall through to gradient */ }
  }
  if (!imgLoaded) {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#fce4ec');
    grad.addColorStop(1, '#e8eaf6');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  const colorMap = new Map<string, { color: string; items: Array<{ size: string; stock: number | null }> }>();
  for (const v of variants) {
    const key = v.color || '__';
    if (!colorMap.has(key)) colorMap.set(key, { color: v.color, items: [] });
    colorMap.get(key)!.items.push({ size: v.size, stock: v.stock });
  }
  const groups = [...colorMap.values()];

  const RED = '#C8001A';
  const WHITE = '#FFFFFF';
  const PAD = 20, RADIUS = 18;
  const COLOR_FONT = 34, STOCK_FONT = 44, LINE_H = 54;
  const MARGIN = 28;

  function roundRect(x: number, y: number, w: number, h: number) {
    ctx.beginPath();
    ctx.moveTo(x + RADIUS, y);
    ctx.lineTo(x + w - RADIUS, y);
    ctx.arcTo(x + w, y, x + w, y + RADIUS, RADIUS);
    ctx.lineTo(x + w, y + h - RADIUS);
    ctx.arcTo(x + w, y + h, x + w - RADIUS, y + h, RADIUS);
    ctx.lineTo(x + RADIUS, y + h);
    ctx.arcTo(x, y + h, x, y + h - RADIUS, RADIUS);
    ctx.lineTo(x, y + RADIUS);
    ctx.arcTo(x, y, x + RADIUS, y, RADIUS);
    ctx.closePath();
  }

  const corners: [number, number, boolean, boolean][] = [
    [MARGIN, 110, false, false],
    [W - MARGIN, 110, true, false],
    [MARGIN, H - MARGIN, false, true],
    [W - MARGIN, H - MARGIN, true, true],
  ];

  groups.slice(0, 4).forEach((group, i) => {
    const [ax, ay, alignRight, alignBottom] = corners[i];

    ctx.font = `bold ${STOCK_FONT}px ${FONT_FAMILY}, sans-serif`;
    const maxStockW = Math.max(...group.items.map((it: { stock: number | null; size: string }) => ctx.measureText(`${it.stock ?? '?'} ${it.size}`).width));
    ctx.font = `bold ${COLOR_FONT}px ${FONT_FAMILY}, sans-serif`;
    const colorW = group.color ? ctx.measureText(group.color).width : 0;
    const boxW = Math.max(maxStockW, colorW) + PAD * 2;
    const boxH = PAD + (group.color ? COLOR_FONT + 10 : 0) + group.items.length * LINE_H + PAD;
    const boxX = alignRight ? ax - boxW : ax;
    const boxY = alignBottom ? ay - boxH : ay;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = RED;
    roundRect(boxX, boxY, boxW, boxH);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = WHITE;
    ctx.textAlign = alignRight ? 'right' : 'left';
    const textX = alignRight ? boxX + boxW - PAD : boxX + PAD;
    let textY = boxY + PAD;

    if (group.color) {
      ctx.font = `bold ${COLOR_FONT}px ${FONT_FAMILY}, sans-serif`;
      textY += COLOR_FONT;
      ctx.fillText(group.color, textX, textY);
      textY += 10;
    }
    ctx.font = `bold ${STOCK_FONT}px ${FONT_FAMILY}, sans-serif`;
    for (const it of group.items) {
      textY += LINE_H;
      ctx.fillText(`${it.stock ?? '?'} ${it.size}`, textX, textY);
    }
  });

  // Product code badge (top-left)
  const CODE_FONT = 50;
  ctx.font = `bold ${CODE_FONT}px ${FONT_FAMILY}, sans-serif`;
  const codeLabelW = ctx.measureText(displayCode).width + 32;
  const codeLabelH = CODE_FONT + 24;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = RED;
  roundRect(16, 16, codeLabelW, codeLabelH);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'left';
  ctx.font = `bold ${CODE_FONT}px ${FONT_FAMILY}, sans-serif`;
  ctx.fillText(displayCode, 32, 16 + CODE_FONT + 6);

  // MeiT watermark (top-right) — use serif fallback, Georgia unavailable on server
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.textAlign = 'right';
  ctx.font = `italic bold 42px ${FONT_FAMILY}, serif`;
  ctx.fillText('MeiT', W - 20, 66);
  ctx.restore();

  return canvas.toDataURL('image/png').replace('data:image/png;base64,', '');
}

export async function stitchIntoCompositeServer(base64Images: string[]): Promise<string> {
  const COLS = 3;
  const GAP = 6;
  const CELL_W = 560;
  const CELL_H = 700;
  const rowCount = Math.ceil(base64Images.length / COLS);
  const usedCols = Math.min(base64Images.length, COLS);
  const totalW = usedCols * CELL_W + (usedCols - 1) * GAP;
  const totalH = rowCount * CELL_H + (rowCount - 1) * GAP;

  const canvas = createCanvas(totalW, totalH);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = canvas.getContext('2d') as any;
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, totalW, totalH);

  await Promise.all(
    base64Images.map(async (b64, i) => {
      try {
        const img = await loadImage(`data:image/png;base64,${b64}`);
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = col * (CELL_W + GAP);
        const y = row * (CELL_H + GAP);
        ctx.drawImage(img, x, y, CELL_W, CELL_H);
      } catch { /* skip failed image */ }
    })
  );

  return canvas.toDataURL('image/jpeg', 0.92).replace('data:image/jpeg;base64,', '');
}
