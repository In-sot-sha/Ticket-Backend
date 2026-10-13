import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont, type PDFImage } from 'pdf-lib';
import QRCode from 'qrcode';

export type TicketPdfPass = {
  id: number;
  qrCode: string;
  ticketTypeName: string;
  eventTitle: string;
  eventDate: string;
  eventLocation: string;
  eventTime?: string | null;
  eventImageUrl?: string | null;
  accentColor?: string | null;
  ticketStyle?: string | null;
  organizerLogoUrl?: string | null;
};

const ACCENT_HEX: Record<string, string> = {
  rose: '#d85060',
  gold: '#c49a1a',
  emerald: '#059669',
  purple: '#6d5a9a',
  midnight: '#1e293b',
  ocean: '#0284c7',
};

const LAYOUT_COPY: Record<string, { headline: string; sublabel: string; venueLabel: string }> = {
  classic: { headline: 'COME AND JOIN', sublabel: 'Admit one', venueLabel: 'LIVE AT' },
  boarding: { headline: "YOU'RE INVITED", sublabel: 'First class', venueLabel: 'VENUE' },
  stub: { headline: 'LIVE SHOW', sublabel: 'Admit one', venueLabel: 'LIVE AT' },
  cinema: { headline: 'NOW SHOWING', sublabel: 'Admit one', venueLabel: 'SCREEN' },
  folio: { headline: 'EXHIBITION', sublabel: 'Admit one', venueLabel: 'VENUE' },
};

function parseStyle(raw?: string | null): { layout: string; accentId: string } {
  const value = (raw || '').trim().toLowerCase();
  if (!value) return { layout: 'classic', accentId: 'rose' };
  const match = value.match(/^([a-z]+)-([a-z]+)$/);
  if (match) return { layout: match[1], accentId: match[2] };
  if (ACCENT_HEX[value]) return { layout: 'classic', accentId: value };
  return { layout: 'classic', accentId: 'rose' };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace('#', '');
  if (raw.length < 6) return { r: 0.85, g: 0.31, b: 0.38 };
  return {
    r: parseInt(raw.slice(0, 2), 16) / 255,
    g: parseInt(raw.slice(2, 4), 16) / 255,
    b: parseInt(raw.slice(4, 6), 16) / 255,
  };
}

function inkOn(hex: string): { r: number; g: number; b: number } {
  const { r, g, b } = hexToRgb(hex);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma > 0.55 ? { r: 0.04, g: 0.04, b: 0.04 } : { r: 1, g: 1, b: 1 };
}

function resolveAccent(ticketStyle?: string | null, accentColor?: string | null): string {
  if (accentColor && /^#[0-9a-fA-F]{6}$/.test(accentColor.trim())) return accentColor.trim();
  const { accentId } = parseStyle(ticketStyle);
  return ACCENT_HEX[accentId] || ACCENT_HEX.rose;
}

function splitTitle(title: string): { first: string; rest: string } {
  const parts = (title || 'Event').trim().split(/\s+/);
  if (parts.length <= 1) return { first: parts[0] || 'Event', rest: '' };
  return { first: parts[0], rest: parts.slice(1).join(' ') };
}

function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; kind: 'png' | 'jpg' } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('png') || url.toLowerCase().includes('.png')) return { bytes: buf, kind: 'png' };
    if (ct.includes('jpeg') || ct.includes('jpg') || url.toLowerCase().match(/\.jpe?g/)) {
      return { bytes: buf, kind: 'jpg' };
    }
    if (ct.includes('webp')) return null;
    return { bytes: buf, kind: 'jpg' };
  } catch {
    return null;
  }
}

async function embedImage(
  doc: PDFDocument,
  url?: string | null,
): Promise<PDFImage | null> {
  if (!url?.trim()) return null;
  const img = await fetchImageBytes(url.trim());
  if (!img) return null;
  try {
    return img.kind === 'jpg' ? await doc.embedJpg(img.bytes) : await doc.embedPng(img.bytes);
  } catch {
    try {
      return img.kind === 'jpg' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    } catch {
      return null;
    }
  }
}

function drawCoverImage(
  page: PDFPage,
  image: PDFImage | null,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (!image) {
    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      color: rgb(0.09, 0.09, 0.11),
    });
    return;
  }
  const scale = Math.max(w / image.width, h / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  const offsetX = x + (w - drawW) / 2;
  const offsetY = y + (h - drawH) / 2;
  page.drawImage(image, { x: offsetX, y: offsetY, width: drawW, height: drawH });
}

/**
 * Landscape pass matching the frontend EventTicketCard (photo + accent stub + QR).
 * Page size mirrors the PNG capture (~840×320).
 */
export async function buildTicketPdf(pass: TicketPdfPass): Promise<Buffer> {
  const W = 840;
  const H = 320;
  const stubW = 280;
  const photoW = W - stubW;

  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const accentHex = resolveAccent(pass.ticketStyle, pass.accentColor);
  const accent = hexToRgb(accentHex);
  const onAccent = inkOn(accentHex);
  const { layout } = parseStyle(pass.ticketStyle);
  const copy = LAYOUT_COPY[layout] || LAYOUT_COPY.classic;
  const split = splitTitle(pass.eventTitle || 'Event');

  const banner =
    (await embedImage(doc, pass.eventImageUrl)) ||
    (await embedImage(
      doc,
      'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80',
    ));
  const logo = await embedImage(doc, pass.organizerLogoUrl);

  // Photo panel
  drawCoverImage(page, banner, 0, 0, photoW, H);
  // Dark overlays (left-heavy + bottom), approximating frontend gradients
  page.drawRectangle({
    x: 0,
    y: 0,
    width: photoW,
    height: H,
    color: rgb(0, 0, 0),
    opacity: 0.55,
  });
  page.drawRectangle({
    x: 0,
    y: 0,
    width: photoW * 0.72,
    height: H,
    color: rgb(0, 0, 0),
    opacity: 0.35,
  });

  const pad = 28;
  let y = H - pad - 10;

  // Headline + host logo
  page.drawText(copy.headline, {
    x: pad,
    y,
    size: 9,
    font: fontBold,
    color: rgb(0.7, 0.7, 0.72),
  });

  if (logo) {
    const logoSize = 36;
    const scale = Math.min(logoSize / logo.width, logoSize / logo.height);
    const lw = logo.width * scale;
    const lh = logo.height * scale;
    page.drawRectangle({
      x: photoW - pad - logoSize - 2,
      y: y - 8,
      width: logoSize + 4,
      height: logoSize + 4,
      color: rgb(1, 1, 1),
      borderColor: rgb(1, 1, 1),
      borderWidth: 0,
    });
    // Rounded look approximated with white square behind logo
    page.drawImage(logo, {
      x: photoW - pad - logoSize + (logoSize - lw) / 2,
      y: y - 6 + (logoSize - lh) / 2,
      width: lw,
      height: lh,
    });
  }

  y -= 36;

  // Title: first word accent, rest white
  const titleSize = 28;
  const first = truncate(split.first.toUpperCase(), fontBold, titleSize, photoW - pad * 2 - 40);
  page.drawText(first, {
    x: pad,
    y,
    size: titleSize,
    font: fontBold,
    color: rgb(accent.r, accent.g, accent.b),
  });
  if (split.rest) {
    const firstW = fontBold.widthOfTextAtSize(first, titleSize);
    const rest = truncate(
      ` ${split.rest.toUpperCase()}`,
      fontBold,
      titleSize,
      photoW - pad * 2 - firstW - 8,
    );
    page.drawText(rest, {
      x: pad + firstW,
      y,
      size: titleSize,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
  }

  y -= 32;
  page.drawText(copy.venueLabel, {
    x: pad,
    y,
    size: 8,
    font: fontBold,
    color: rgb(0.65, 0.65, 0.68),
  });
  y -= 16;
  page.drawText(truncate((pass.eventLocation || 'Venue TBA').toUpperCase(), fontBold, 12, photoW - pad * 2), {
    x: pad,
    y,
    size: 12,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  y -= 36;
  // Divider
  page.drawRectangle({
    x: pad,
    y: y + 10,
    width: photoW - pad * 2,
    height: 0.75,
    color: rgb(1, 1, 1),
    opacity: 0.15,
  });

  page.drawText('DATE', {
    x: pad,
    y,
    size: 7,
    font: fontBold,
    color: rgb(0.7, 0.7, 0.72),
  });
  y -= 14;
  page.drawText(truncate((pass.eventDate || 'TBA').toUpperCase(), fontBold, 11, 260), {
    x: pad,
    y,
    size: 11,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  if (pass.eventTime) {
    page.drawText('TIME', {
      x: pad + 220,
      y: y + 14,
      size: 7,
      font: fontBold,
      color: rgb(0.7, 0.7, 0.72),
    });
    page.drawText(truncate(pass.eventTime.toUpperCase(), fontBold, 11, 160), {
      x: pad + 220,
      y,
      size: 11,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
  }

  // Perforation
  const dashYTop = H - 16;
  const dashYBottom = 16;
  for (let dy = dashYBottom; dy < dashYTop; dy += 10) {
    page.drawRectangle({
      x: photoW - 0.75,
      y: dy,
      width: 1.5,
      height: 5,
      color: rgb(1, 1, 1),
      opacity: 0.35,
    });
  }
  page.drawCircle({
    x: photoW,
    y: H,
    size: 10,
    color: rgb(1, 1, 1),
  });
  page.drawCircle({
    x: photoW,
    y: 0,
    size: 10,
    color: rgb(1, 1, 1),
  });

  // Accent stub
  page.drawRectangle({
    x: photoW,
    y: 0,
    width: stubW,
    height: H,
    color: rgb(accent.r, accent.g, accent.b),
  });
  page.drawRectangle({
    x: photoW,
    y: 0,
    width: stubW,
    height: H,
    color: rgb(0, 0, 0),
    opacity: 0.06,
  });

  const stubCx = photoW + stubW / 2;
  const ink = rgb(onAccent.r, onAccent.g, onAccent.b);
  const badgeBg =
    onAccent.r > 0.5 ? rgb(0.04, 0.04, 0.04) : rgb(1, 1, 1);
  const badgeFg =
    onAccent.r > 0.5 ? rgb(1, 1, 1) : rgb(0.04, 0.04, 0.04);

  const badgeLabel = truncate(
    (pass.ticketTypeName || 'General Admission').toUpperCase(),
    fontBold,
    9,
    stubW - 48,
  );
  const badgeW = fontBold.widthOfTextAtSize(badgeLabel, 9) + 24;
  const badgeH = 22;
  const badgeX = stubCx - badgeW / 2;
  const badgeY = H - 48;
  page.drawRectangle({
    x: badgeX,
    y: badgeY,
    width: badgeW,
    height: badgeH,
    color: badgeBg,
    borderColor: badgeBg,
    borderWidth: 0,
  });
  // Soft pill: rounded corners approximated
  page.drawCircle({ x: badgeX, y: badgeY + badgeH / 2, size: badgeH / 2, color: badgeBg });
  page.drawCircle({
    x: badgeX + badgeW,
    y: badgeY + badgeH / 2,
    size: badgeH / 2,
    color: badgeBg,
  });
  page.drawText(badgeLabel, {
    x: stubCx - fontBold.widthOfTextAtSize(badgeLabel, 9) / 2,
    y: badgeY + 7,
    size: 9,
    font: fontBold,
    color: badgeFg,
  });

  const qrDataUrl = await QRCode.toDataURL(pass.qrCode || `ticket-${pass.id}`, {
    margin: 1,
    width: 220,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  });
  const qrBytes = Buffer.from(qrDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
  const qrImage = await doc.embedPng(qrBytes);
  const qrPad = 10;
  const qrSize = 150;
  const qrBox = qrSize + qrPad * 2;
  const qrBoxX = stubCx - qrBox / 2;
  const qrBoxY = 78;
  page.drawRectangle({
    x: qrBoxX,
    y: qrBoxY,
    width: qrBox,
    height: qrBox,
    color: rgb(1, 1, 1),
  });
  page.drawImage(qrImage, {
    x: qrBoxX + qrPad,
    y: qrBoxY + qrPad,
    width: qrSize,
    height: qrSize,
  });

  const scan = 'DO NOT SHARE TICKET';
  page.drawText(scan, {
    x: stubCx - fontBold.widthOfTextAtSize(scan, 8) / 2,
    y: 52,
    size: 8,
    font: fontBold,
    color: ink,
    opacity: 0.9,
  });
  const sub = copy.sublabel.toUpperCase();
  page.drawText(sub, {
    x: stubCx - fontBold.widthOfTextAtSize(sub, 10) / 2,
    y: 34,
    size: 10,
    font: fontBold,
    color: ink,
  });

  const serial = `TKT-${String(pass.id).padStart(6, '0')}`;
  page.drawText(serial, {
    x: stubCx - font.widthOfTextAtSize(serial, 7) / 2,
    y: 16,
    size: 7,
    font,
    color: ink,
    opacity: 0.7,
  });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

/** Build one PDF attachment per pass (filename + buffer). */
export async function buildTicketPdfAttachments(
  passes: TicketPdfPass[],
): Promise<Array<{ filename: string; content: Buffer; contentType: string }>> {
  const out: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  for (const pass of passes) {
    if (!pass.qrCode) continue;
    const content = await buildTicketPdf(pass);
    out.push({
      filename: `ticket-TKT-${String(pass.id).padStart(6, '0')}.pdf`,
      content,
      contentType: 'application/pdf',
    });
  }
  return out;
}
