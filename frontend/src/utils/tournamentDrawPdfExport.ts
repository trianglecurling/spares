/**
 * Client-side PDF export of the public tournament draw chart.
 *
 * Capture runs in a light-themed iframe so dark mode is not baked into the PDF
 * and so overflow/transform on the live pan-zoom shell cannot clip the chart.
 * Pages are US Letter landscape; whole event lanes stay together.
 */

import type { LaneBand } from './tournamentDrawBracketLayout';

/** PDF spec limit is 14,400pt; stay slightly under. */
export const PDF_MAX_PAGE_POINTS = 14_000;

export const CSS_PX_TO_PDF_PT = 72 / 96;

/** US Letter landscape. */
export const LETTER_LANDSCAPE_PT = { width: 792, height: 612 };

export const PRINT_PAGE_MARGIN_PT = 24;
export const PRINT_TITLE_BAND_PT = 16;

function chartPdfFilename(filenameBase: string, suffix: 'draw' | 'path'): string {
  const safe = filenameBase
    .trim()
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!safe) return `tournament-${suffix}.pdf`;
  return `${safe}-${suffix}.pdf`;
}

export function drawChartPdfFilename(filenameBase: string): string {
  return chartPdfFilename(filenameBase, 'draw');
}

export function pathChartPdfFilename(filenameBase: string): string {
  return chartPdfFilename(filenameBase, 'path');
}

export function pdfPageSizeForCssBox(
  widthPx: number,
  heightPx: number
): { width: number; height: number } {
  const wPx = Math.max(1, widthPx);
  const hPx = Math.max(1, heightPx);
  let width = wPx * CSS_PX_TO_PDF_PT;
  let height = hPx * CSS_PX_TO_PDF_PT;
  const longest = Math.max(width, height);
  if (longest > PDF_MAX_PAGE_POINTS) {
    const scale = PDF_MAX_PAGE_POINTS / longest;
    width *= scale;
    height *= scale;
  }
  return { width, height };
}

export function printChartContentBoxPt(): { width: number; height: number } {
  return {
    width: LETTER_LANDSCAPE_PT.width - PRINT_PAGE_MARGIN_PT * 2,
    height: LETTER_LANDSCAPE_PT.height - PRINT_PAGE_MARGIN_PT * 2 - PRINT_TITLE_BAND_PT,
  };
}

export function printChartContentBoxCss(): { width: number; height: number } {
  const pt = printChartContentBoxPt();
  return {
    width: pt.width / CSS_PX_TO_PDF_PT,
    height: pt.height / CSS_PX_TO_PDF_PT,
  };
}

export type PrintChartPage = {
  eventIds: string[];
  top: number;
  height: number;
};

function lanesOverlapVertically(a: LaneBand, b: LaneBand): boolean {
  return a.top < b.top + b.height && b.top < a.top + a.height;
}

/** Events that share a vertical band (including side-by-side neighbors). */
export function clusterPrintLaneRows(lanes: LaneBand[]): LaneBand[][] {
  const sorted = [...lanes].sort((a, b) => a.top - b.top || (a.left ?? 0) - (b.left ?? 0));
  const rows: LaneBand[][] = [];
  for (const lane of sorted) {
    const row = rows[rows.length - 1];
    if (row && row.some((other) => lanesOverlapVertically(other, lane))) {
      row.push(lane);
    } else {
      rows.push([lane]);
    }
  }
  return rows;
}

function rowBounds(
  row: LaneBand[],
  layoutWidth: number
): { top: number; height: number; width: number } {
  let top = Infinity;
  let bottom = -Infinity;
  let right = 0;
  let hasExplicitWidth = false;
  for (const lane of row) {
    top = Math.min(top, lane.top);
    bottom = Math.max(bottom, lane.top + lane.height);
    if (lane.width != null) {
      hasExplicitWidth = true;
      right = Math.max(right, (lane.left ?? 0) + lane.width);
    }
  }
  return {
    top,
    height: Math.max(1, bottom - top),
    width: hasExplicitWidth ? right : layoutWidth,
  };
}

/**
 * Pack whole event lanes onto pages. A lane is never split. Side-by-side lanes
 * stay on the same row. If one row is taller or wider than the content box, it
 * still gets its own page and is scaled later.
 */
export function packPrintChartPages(
  lanes: LaneBand[],
  layoutWidth: number,
  pageContentWidth: number,
  pageContentHeight: number
): PrintChartPage[] {
  if (lanes.length === 0) {
    return [{ eventIds: [], top: 0, height: 1 }];
  }

  const rows = clusterPrintLaneRows(lanes);
  const bounds = rows.map((row) => rowBounds(row, layoutWidth));

  const groupFits = (start: number, end: number): boolean => {
    const first = bounds[start]!;
    const last = bounds[end]!;
    const height = last.top + last.height - first.top;
    let usedWidth = 0;
    for (let i = start; i <= end; i++) {
      usedWidth = Math.max(usedWidth, bounds[i]!.width);
    }
    const widthScale = Math.min(1, pageContentWidth / Math.max(1, usedWidth));
    return height * widthScale <= pageContentHeight;
  };

  const pages: PrintChartPage[] = [];
  let start = 0;
  while (start < rows.length) {
    let end = start;
    while (end + 1 < rows.length && groupFits(start, end + 1)) {
      end += 1;
    }
    const first = bounds[start]!;
    const last = bounds[end]!;
    pages.push({
      eventIds: rows.slice(start, end + 1).flatMap((row) => row.map((lane) => lane.eventId)),
      top: first.top,
      height: Math.max(1, last.top + last.height - first.top),
    });
    start = end + 1;
  }
  return pages;
}

/** Conservative one-side limit used by several browsers. */
export const MAX_CAPTURE_CANVAS_SIDE = 8192;
/** Stay under older Safari’s ~16MP canvas area cap. */
export const MAX_CAPTURE_CANVAS_AREA = 16_777_216;

/**
 * Highest integer scale that still fits the canvas cap. Typical letter pages
 * get 4× (~300–380 dpi); a full stacked chart is no longer captured at once.
 */
export function capturePixelRatio(widthPx: number, heightPx: number): number {
  const w = Math.max(1, widthPx);
  const h = Math.max(1, heightPx);
  for (const ratio of [4, 3, 2, 1]) {
    const cw = w * ratio;
    const ch = h * ratio;
    if (
      cw <= MAX_CAPTURE_CANVAS_SIDE &&
      ch <= MAX_CAPTURE_CANVAS_SIDE &&
      cw * ch <= MAX_CAPTURE_CANVAS_AREA
    ) {
      return ratio;
    }
  }
  return 1;
}

function blobFromBytes(bytes: Uint8Array, type: string): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type });
}

function openPdfBlobInTab(blob: Blob): void {
  const objectUrl = URL.createObjectURL(blob);
  const opened = window.open(objectUrl, '_blank', 'noopener');
  if (!opened) {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

function copyStyleSheets(sourceDoc: Document, targetDoc: Document): HTMLLinkElement[] {
  const pendingLinks: HTMLLinkElement[] = [];
  for (const node of sourceDoc.querySelectorAll('link[rel="stylesheet"], style')) {
    if (node instanceof HTMLLinkElement) {
      const link = targetDoc.createElement('link');
      link.rel = 'stylesheet';
      link.href = node.href;
      pendingLinks.push(link);
      targetDoc.head.appendChild(link);
      continue;
    }
    targetDoc.head.appendChild(node.cloneNode(true));
  }
  return pendingLinks;
}

function waitForStyleSheets(links: HTMLLinkElement[]): Promise<void> {
  if (links.length === 0) return Promise.resolve();
  return Promise.all(
    links.map(
      (link) =>
        new Promise<void>((resolve) => {
          if (link.sheet) {
            resolve();
            return;
          }
          link.addEventListener('load', () => resolve(), { once: true });
          link.addEventListener('error', () => resolve(), { once: true });
        })
    )
  ).then(() => undefined);
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 32);
  });
}

function fitTextToWidth(
  text: string,
  widthOf: (value: string) => number,
  maxWidth: number
): string {
  if (widthOf(text) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && widthOf(`${t}…`) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t.length > 0 ? `${t}…` : '…';
}

async function captureRegionPng(
  idoc: Document,
  sceneSource: HTMLElement,
  cssWidth: number,
  top: number,
  height: number,
  toBlob: (node: HTMLElement, options?: Record<string, unknown>) => Promise<Blob | null>
): Promise<Blob> {
  const regionHeight = Math.max(1, height);
  const clip = idoc.createElement('div');
  clip.style.cssText = [
    'overflow:hidden',
    `width:${cssWidth}px`,
    `height:${regionHeight}px`,
    'position:relative',
    'background:#ffffff',
  ].join(';');
  const shifted = sceneSource.cloneNode(true) as HTMLElement;
  shifted.style.position = 'relative';
  shifted.style.transform = `translateY(${-Math.max(0, top)}px)`;
  clip.appendChild(shifted);
  idoc.body.appendChild(clip);
  try {
    await nextPaint();
    const pixelRatio = capturePixelRatio(cssWidth, regionHeight);
    const blob = await toBlob(clip, {
      pixelRatio,
      backgroundColor: '#ffffff',
      cacheBust: true,
      width: cssWidth,
      height: regionHeight,
    });
    if (!blob) {
      throw new Error('Could not render the draw chart.');
    }
    return blob;
  } finally {
    clip.remove();
  }
}

export type ExportPrintScenePdfOptions = {
  sceneElement: HTMLElement;
  layout: { width: number; height: number };
  pages: PrintChartPage[];
  title: string;
  subject?: string;
};

export type ExportTournamentDrawChartPdfOptions = {
  sceneElement: HTMLElement;
  layout: { width: number; height: number; lanes: LaneBand[] };
  title: string;
  filenameBase: string;
};

export type ExportTournamentPathChartPdfOptions = {
  sceneElement: HTMLElement;
  layout: { width: number; height: number };
  title: string;
  filenameBase: string;
};

/**
 * Rasterize a compact print scene and place cropped regions on letter-landscape pages.
 */
export async function exportPrintScenePdf({
  sceneElement,
  layout,
  pages,
  title,
  subject,
}: ExportPrintScenePdfOptions): Promise<void> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.cssText =
    'position:fixed;left:-10000px;top:0;border:0;opacity:0;pointer-events:none;background:#fff;';
  document.body.appendChild(iframe);

  try {
    const idoc = iframe.contentDocument;
    if (!idoc) {
      throw new Error('Could not create export frame.');
    }

    idoc.open();
    idoc.write('<!DOCTYPE html><html><head></head><body></body></html>');
    idoc.close();
    idoc.documentElement.style.colorScheme = 'light';
    idoc.body.style.margin = '0';
    idoc.body.style.background = '#ffffff';
    idoc.body.style.color = '#111827';

    const pendingLinks = copyStyleSheets(document, idoc);
    await waitForStyleSheets(pendingLinks);
    if (idoc.fonts?.ready) {
      await idoc.fonts.ready;
    }

    const root = idoc.createElement('div');
    root.style.cssText = 'background:#ffffff;color:#111827;width:max-content;';
    const sceneClone = sceneElement.cloneNode(true) as HTMLElement;
    sceneClone.style.transform = 'none';
    sceneClone.style.position = 'relative';
    root.appendChild(sceneClone);
    idoc.body.appendChild(root);

    iframe.style.width = `${Math.ceil(Math.max(root.scrollWidth, layout.width))}px`;
    iframe.style.height = `${Math.ceil(Math.max(root.scrollHeight, layout.height))}px`;
    await nextPaint();

    const [{ toBlob }, { PDFDocument, StandardFonts, rgb }] = await Promise.all([
      import('html-to-image'),
      import('pdf-lib'),
    ]);

    const cssWidth = Math.max(1, layout.width);
    const cssHeight = Math.max(1, layout.height);
    const contentPt = printChartContentBoxPt();
    const pageRegions = pages.length > 0 ? pages : [{ eventIds: [], top: 0, height: cssHeight }];

    const pdfDoc = await PDFDocument.create();
    const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pageFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const titleText = title.trim() || 'Draw';
    pdfDoc.setTitle(titleText);
    pdfDoc.setSubject(subject ?? 'Tournament draw');

    const pageCount = pageRegions.length;
    for (let i = 0; i < pageCount; i++) {
      const region = pageRegions[i]!;
      const pageBlob = await captureRegionPng(
        idoc,
        sceneClone,
        cssWidth,
        region.top,
        region.height,
        toBlob
      );
      const png = await pdfDoc.embedPng(new Uint8Array(await pageBlob.arrayBuffer()));

      const page = pdfDoc.addPage([LETTER_LANDSCAPE_PT.width, LETTER_LANDSCAPE_PT.height]);
      const titleY = LETTER_LANDSCAPE_PT.height - PRINT_PAGE_MARGIN_PT - 11;
      const pageLabel = pageCount > 1 ? `${i + 1} / ${pageCount}` : '';
      const pageLabelWidth = pageLabel ? pageFont.widthOfTextAtSize(pageLabel, 9) : 0;
      const titleMaxWidth = contentPt.width - (pageLabelWidth > 0 ? pageLabelWidth + 12 : 0);
      page.drawText(
        fitTextToWidth(titleText, (value) => titleFont.widthOfTextAtSize(value, 12), titleMaxWidth),
        {
          x: PRINT_PAGE_MARGIN_PT,
          y: titleY,
          size: 12,
          font: titleFont,
          color: rgb(0.07, 0.09, 0.15),
        }
      );
      if (pageLabel) {
        page.drawText(pageLabel, {
          x: LETTER_LANDSCAPE_PT.width - PRINT_PAGE_MARGIN_PT - pageLabelWidth,
          y: titleY,
          size: 9,
          font: pageFont,
          color: rgb(0.42, 0.45, 0.5),
        });
      }

      const naturalW = region.height > 0 ? cssWidth * CSS_PX_TO_PDF_PT : contentPt.width;
      const naturalH = region.height * CSS_PX_TO_PDF_PT;
      const fit = Math.min(1, contentPt.width / naturalW, contentPt.height / naturalH);
      const drawW = naturalW * fit;
      const drawH = naturalH * fit;
      const chartTop = LETTER_LANDSCAPE_PT.height - PRINT_PAGE_MARGIN_PT - PRINT_TITLE_BAND_PT;
      page.drawImage(png, {
        x: PRINT_PAGE_MARGIN_PT,
        y: chartTop - drawH,
        width: drawW,
        height: drawH,
      });
    }

    const pdfBytes = await pdfDoc.save();
    openPdfBlobInTab(blobFromBytes(pdfBytes, 'application/pdf'));
  } finally {
    iframe.remove();
  }
}

/**
 * Rasterize the compact print scene and place event lanes on letter-landscape pages.
 */
export async function exportTournamentDrawChartPdf({
  sceneElement,
  layout,
  title,
}: ExportTournamentDrawChartPdfOptions): Promise<void> {
  const contentCss = printChartContentBoxCss();
  const pages = packPrintChartPages(
    layout.lanes,
    layout.width,
    contentCss.width,
    contentCss.height
  );
  await exportPrintScenePdf({
    sceneElement,
    layout,
    pages,
    title,
    subject: 'Tournament draw',
  });
}

/**
 * Rasterize a team bracket path. The whole path stays on one page and scales
 * to letter landscape if needed (arrows cross columns, so the path is not split).
 */
export async function exportTournamentPathChartPdf({
  sceneElement,
  layout,
  title,
}: ExportTournamentPathChartPdfOptions): Promise<void> {
  await exportPrintScenePdf({
    sceneElement,
    layout,
    pages: [{ eventIds: [], top: 0, height: Math.max(1, layout.height) }],
    title,
    subject: 'Bracket path',
  });
}
