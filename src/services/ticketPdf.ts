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

const imageBytesCache = new Map<string, { at: number; data: { bytes: Uint8Array; kind: 'png' | 'jpg' } }>();

/** Optimize image URLs (e.g. Cloudinary, Unsplash) to lightweight dimensions suitable for mobile passes */
export function optimizeImageUrlForTicket(url?: string | null): string | null {
  if (!url?.trim()) return null;
  const clean = url.trim();

  // Cloudinary: transform to width 600, quality 75, JPEG format
  if (clean.includes('res.cloudinary.com') && clean.includes('/upload/')) {
    if (!clean.includes('/upload/w_')) {
      return clean.replace('/upload/', '/upload/w_600,c_fill,q_75,f_jpg/');
    }
  }

  // Unsplash: limit width to 600px and quality 75
  if (clean.includes('images.unsplash.com')) {
    const base = clean.split('?')[0];
    return `${base}?w=600&q=75&auto=format&fit=crop`;
  }

  return clean;
}

async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; kind: 'png' | 'jpg' } | null> {
  const optimized = optimizeImageUrlForTicket(url) || url.trim();
  const cleanUrl = optimized.trim();
  const cached = imageBytesCache.get(cleanUrl);
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) {
    return cached.data;
  }

  try {
    // 3.5s timeout prevents hanging on slow/blocked external hosts on serverless
    const res = await fetch(cleanUrl, { signal: AbortSignal.timeout(3500) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    let kind: 'png' | 'jpg' = 'jpg';
    if (ct.includes('png') || cleanUrl.toLowerCase().includes('.png')) {
      kind = 'png';
    } else if (ct.includes('jpeg') || ct.includes('jpg') || cleanUrl.toLowerCase().match(/\.jpe?g/)) {
      kind = 'jpg';
    }
    const data = { bytes: buf, kind };
    imageBytesCache.set(cleanUrl, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

export type PreloadedTicketImages = {
  bannerData?: { bytes: Uint8Array; kind: 'png' | 'jpg' } | null;
  logoData?: { bytes: Uint8Array; kind: 'png' | 'jpg' } | null;
};

/** Preload ticket banner and host logo once in parallel with strict timeout */
export async function preloadTicketImages(
  bannerUrl?: string | null,
  logoUrl?: string | null,
): Promise<PreloadedTicketImages> {
  const [bannerData, logoData] = await Promise.all([
    bannerUrl?.trim() ? fetchImageBytes(bannerUrl.trim()) : Promise.resolve(null),
    logoUrl?.trim() ? fetchImageBytes(logoUrl.trim()) : Promise.resolve(null),
  ]);
  return { bannerData, logoData };
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

async function drawTicketPassPage(
  doc: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  banner: PDFImage | null,
  logo: PDFImage | null,
  pass: TicketPdfPass,
) {
  // Compact vertical portrait pass matching mobile view (380×510)
  const W = 380;
  const H = 510;
  const splitY = 320; // Compact top photo banner (190px) + bottom stub (320px)

  const accentHex = resolveAccent(pass.ticketStyle, pass.accentColor);
  const accent = hexToRgb(accentHex);
  const onAccent = inkOn(accentHex);
  const { layout } = parseStyle(pass.ticketStyle);
  const copy = LAYOUT_COPY[layout] || LAYOUT_COPY.classic;
  const split = splitTitle(pass.eventTitle || 'Event');

  // 1. Top Section: Event Banner & Details (compact 190px height)
  drawCoverImage(page, banner, 0, splitY, W, H - splitY);

  // Dark overlays for contrast
  page.drawRectangle({
    x: 0,
    y: splitY,
    width: W,
    height: H - splitY,
    color: rgb(0, 0, 0),
    opacity: 0.65,
  });
  page.drawRectangle({
    x: 0,
    y: splitY,
    width: W,
    height: (H - splitY) * 0.7,
    color: rgb(0, 0, 0),
    opacity: 0.35,
  });

  const pad = 20;
  let y = H - pad - 8;

  // Headline + host logo
  page.drawText(copy.headline, {
    x: pad,
    y,
    size: 8.5,
    font: fontBold,
    color: rgb(0.75, 0.75, 0.78),
  });

  if (logo) {
    const logoSize = 28;
    const scale = Math.min(logoSize / logo.width, logoSize / logo.height);
    const lw = logo.width * scale;
    const lh = logo.height * scale;
    page.drawRectangle({
      x: W - pad - logoSize - 2,
      y: y - 6,
      width: logoSize + 4,
      height: logoSize + 4,
      color: rgb(1, 1, 1),
      borderColor: rgb(1, 1, 1),
      borderWidth: 0,
    });
    page.drawImage(logo, {
      x: W - pad - logoSize + (logoSize - lw) / 2,
      y: y - 5 + (logoSize - lh) / 2,
      width: lw,
      height: lh,
    });
  }

  y -= 26;

  // Event title: first word accent color, rest white
  const titleSize = 17;
  const maxTitleW = W - pad * 2 - (logo ? 34 : 0);
  const first = split.first.toUpperCase();
  const rest = split.rest ? split.rest.toUpperCase() : '';
  const firstW = fontBold.widthOfTextAtSize(first, titleSize);

  if (!rest) {
    page.drawText(truncate(first, fontBold, titleSize, maxTitleW), {
      x: pad,
      y,
      size: titleSize,
      font: fontBold,
      color: rgb(accent.r, accent.g, accent.b),
    });
  } else {
    const fullW = fontBold.widthOfTextAtSize(`${first} ${rest}`, titleSize);
    if (fullW <= maxTitleW) {
      page.drawText(first, {
        x: pad,
        y,
        size: titleSize,
        font: fontBold,
        color: rgb(accent.r, accent.g, accent.b),
      });
      page.drawText(` ${rest}`, {
        x: pad + firstW,
        y,
        size: titleSize,
        font: fontBold,
        color: rgb(1, 1, 1),
      });
    } else {
      // 2 lines: line 1 first word, line 2 rest
      page.drawText(truncate(first, fontBold, titleSize, maxTitleW), {
        x: pad,
        y,
        size: titleSize,
        font: fontBold,
        color: rgb(accent.r, accent.g, accent.b),
      });
      y -= 19;
      page.drawText(truncate(rest, fontBold, titleSize, maxTitleW), {
        x: pad,
        y,
        size: titleSize,
        font: fontBold,
        color: rgb(1, 1, 1),
      });
    }
  }

  y -= 20;
  page.drawText(copy.venueLabel, {
    x: pad,
    y,
    size: 7,
    font: fontBold,
    color: rgb(0.65, 0.65, 0.68),
  });
  y -= 12;
  page.drawText(truncate((pass.eventLocation || 'Venue TBA').toUpperCase(), fontBold, 9.5, W - pad * 2), {
    x: pad,
    y,
    size: 9.5,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  y -= 14;
  // Subtle divider line
  page.drawRectangle({
    x: pad,
    y: y + 4,
    width: W - pad * 2,
    height: 0.5,
    color: rgb(1, 1, 1),
    opacity: 0.2,
  });

  page.drawText('DATE', {
    x: pad,
    y,
    size: 6.5,
    font: fontBold,
    color: rgb(0.7, 0.7, 0.72),
  });
  y -= 11;
  page.drawText(truncate((pass.eventDate || 'TBA').toUpperCase(), fontBold, 9.5, pass.eventTime ? 160 : W - pad * 2), {
    x: pad,
    y,
    size: 9.5,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  if (pass.eventTime) {
    page.drawText('TIME', {
      x: pad + 175,
      y: y + 11,
      size: 6.5,
      font: fontBold,
      color: rgb(0.7, 0.7, 0.72),
    });
    page.drawText(truncate(pass.eventTime.toUpperCase(), fontBold, 9.5, 120), {
      x: pad + 175,
      y,
      size: 9.5,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
  }

  // 2. Perforation divider at splitY
  for (let dx = 18; dx < W - 18; dx += 9) {
    page.drawRectangle({
      x: dx,
      y: splitY - 0.75,
      width: 4.5,
      height: 1.5,
      color: rgb(1, 1, 1),
      opacity: 0.35,
    });
  }
  // Left and right ticket cutouts
  page.drawCircle({
    x: 0,
    y: splitY,
    size: 9,
    color: rgb(1, 1, 1),
  });
  page.drawCircle({
    x: W,
    y: splitY,
    size: 9,
    color: rgb(1, 1, 1),
  });

  // 3. Bottom Stub (Accent color section)
  page.drawRectangle({
    x: 0,
    y: 0,
    width: W,
    height: splitY,
    color: rgb(accent.r, accent.g, accent.b),
  });
  page.drawRectangle({
    x: 0,
    y: 0,
    width: W,
    height: splitY,
    color: rgb(0, 0, 0),
    opacity: 0.05,
  });

  const stubCx = W / 2;
  const ink = rgb(onAccent.r, onAccent.g, onAccent.b);
  const badgeBg =
    onAccent.r > 0.5 ? rgb(0.04, 0.04, 0.04) : rgb(1, 1, 1);
  const badgeFg =
    onAccent.r > 0.5 ? rgb(1, 1, 1) : rgb(0.04, 0.04, 0.04);

  // Ticket type badge pill
  const badgeLabel = truncate(
    (pass.ticketTypeName || 'General Admission').toUpperCase(),
    fontBold,
    8.5,
    W - 60,
  );
  const badgeW = fontBold.widthOfTextAtSize(badgeLabel, 8.5) + 24;
  const badgeH = 22;
  const badgeX = stubCx - badgeW / 2;
  const badgeY = splitY - 36;
  page.drawRectangle({
    x: badgeX,
    y: badgeY,
    width: badgeW,
    height: badgeH,
    color: badgeBg,
    borderColor: badgeBg,
    borderWidth: 0,
  });
  page.drawCircle({ x: badgeX, y: badgeY + badgeH / 2, size: badgeH / 2, color: badgeBg });
  page.drawCircle({
    x: badgeX + badgeW,
    y: badgeY + badgeH / 2,
    size: badgeH / 2,
    color: badgeBg,
  });
  page.drawText(badgeLabel, {
    x: stubCx - fontBold.widthOfTextAtSize(badgeLabel, 8.5) / 2,
    y: badgeY + 7,
    size: 8.5,
    font: fontBold,
    color: badgeFg,
  });

  // Large Scan-ready QR Code
  const qrDataUrl = await QRCode.toDataURL(pass.qrCode || `ticket-${pass.id}`, {
    margin: 1,
    width: 320,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  });
  const qrBytes = Buffer.from(qrDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
  const qrImage = await doc.embedPng(qrBytes);
  const qrPad = 10;
  const qrSize = 154;
  const qrBox = qrSize + qrPad * 2;
  const qrBoxX = stubCx - qrBox / 2;
  const qrBoxY = 76;
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

  // Security notice & sublabels
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
    x: stubCx - fontBold.widthOfTextAtSize(sub, 9.5) / 2,
    y: 36,
    size: 9.5,
    font: fontBold,
    color: ink,
  });

  const serial = `TKT-${String(pass.id).padStart(6, '0')}`;
  page.drawText(serial, {
    x: stubCx - font.widthOfTextAtSize(serial, 7.5) / 2,
    y: 18,
    size: 7.5,
    font,
    color: ink,
    opacity: 0.75,
  });
}

/**
 * Vertical portrait pass matching mobile view (380×510).
 */
export async function buildTicketPdf(
  pass: TicketPdfPass,
  preloaded?: PreloadedTicketImages,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([380, 510]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let banner: PDFImage | null = null;
  if (preloaded?.bannerData) {
    try {
      banner = preloaded.bannerData.kind === 'jpg'
        ? await doc.embedJpg(preloaded.bannerData.bytes)
        : await doc.embedPng(preloaded.bannerData.bytes);
    } catch {
      banner = null;
    }
  } else if (pass.eventImageUrl) {
    banner = await embedImage(doc, pass.eventImageUrl);
  }

  let logo: PDFImage | null = null;
  if (preloaded?.logoData) {
    try {
      logo = preloaded.logoData.kind === 'jpg'
        ? await doc.embedJpg(preloaded.logoData.bytes)
        : await doc.embedPng(preloaded.logoData.bytes);
    } catch {
      logo = null;
    }
  } else if (pass.organizerLogoUrl) {
    logo = await embedImage(doc, pass.organizerLogoUrl);
  }

  await drawTicketPassPage(doc, page, font, fontBold, banner, logo, pass);
  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Consolidated multi-page PDF containing all tickets for an order.
 * Embeds shared resources (banner image, logo, fonts) ONLY ONCE in the document.
 * Page size: vertical portrait [380, 510].
 */
export async function buildConsolidatedTicketPdf(passes: TicketPdfPass[]): Promise<Buffer> {
  const validPasses = passes.filter((p) => Boolean(p.qrCode));
  if (validPasses.length === 0) {
    const emptyDoc = await PDFDocument.create();
    return Buffer.from(await emptyDoc.save());
  }

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Pre-embed images once for the whole document
  const firstPass = validPasses[0];
  const banner = await embedImage(doc, firstPass.eventImageUrl);
  const logo = await embedImage(doc, firstPass.organizerLogoUrl);

  for (const pass of validPasses) {
    const page = doc.addPage([380, 510]);
    await drawTicketPassPage(doc, page, font, fontBold, banner, logo, pass);
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

/** Build ticket PDF attachments. Returns separate individual PDF files for each pass. */
export async function buildTicketPdfAttachments(
  passes: TicketPdfPass[],
  preloaded?: PreloadedTicketImages,
): Promise<Array<{ filename: string; content: Buffer; contentType: string }>> {
  const validPasses = passes.filter((p) => Boolean(p.qrCode));
  if (validPasses.length === 0) return [];

  const pre = preloaded || (await preloadTicketImages(validPasses[0]?.eventImageUrl, validPasses[0]?.organizerLogoUrl));

  const rendered = await Promise.all(
    validPasses.map(async (pass) => {
      const content = await buildTicketPdf(pass, pre);
      return {
        filename: `ticket-TKT-${String(pass.id).padStart(6, '0')}.pdf`,
        content,
        contentType: 'application/pdf',
      };
    })
  );

  return rendered;
}
