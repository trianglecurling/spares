import { describe, expect, test } from 'bun:test';
import {
  LETTER_LANDSCAPE_PT,
  PDF_MAX_PAGE_POINTS,
  capturePixelRatio,
  drawChartPdfFilename,
  packPrintChartPages,
  pathChartPdfFilename,
  pdfPageSizeForCssBox,
} from './tournamentDrawPdfExport';

describe('drawChartPdfFilename', () => {
  test('sanitizes the event slug and adds a draw suffix', () => {
    expect(drawChartPdfFilename('spring-bonspiel')).toBe('spring-bonspiel-draw.pdf');
    expect(drawChartPdfFilename('Spring Bonspiel 2026')).toBe('Spring-Bonspiel-2026-draw.pdf');
  });

  test('falls back when the base is empty or punctuation-only', () => {
    expect(drawChartPdfFilename('')).toBe('tournament-draw.pdf');
    expect(drawChartPdfFilename('   ')).toBe('tournament-draw.pdf');
    expect(drawChartPdfFilename('***')).toBe('tournament-draw.pdf');
  });
});

describe('pathChartPdfFilename', () => {
  test('sanitizes the base and adds a path suffix', () => {
    expect(pathChartPdfFilename('spring-bonspiel-hammer-time')).toBe(
      'spring-bonspiel-hammer-time-path.pdf'
    );
    expect(pathChartPdfFilename('Hammer Time')).toBe('Hammer-Time-path.pdf');
  });

  test('falls back when the base is empty or punctuation-only', () => {
    expect(pathChartPdfFilename('')).toBe('tournament-path.pdf');
  });
});

describe('pdfPageSizeForCssBox', () => {
  test('converts CSS pixels at 96dpi', () => {
    const size = pdfPageSizeForCssBox(96, 96);
    expect(size.width).toBe(72);
    expect(size.height).toBe(72);
  });

  test('scales down so the long side stays within the PDF page limit', () => {
    const size = pdfPageSizeForCssBox(80_000, 10_000);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(PDF_MAX_PAGE_POINTS);
    expect(size.width / size.height).toBeCloseTo(8, 5);
  });
});

describe('capturePixelRatio', () => {
  test('uses 4x for a letter-sized page slice', () => {
    expect(capturePixelRatio(992, 731)).toBe(4);
  });

  test('uses 3x when 4x would exceed the canvas area cap', () => {
    expect(capturePixelRatio(1600, 900)).toBe(3);
  });

  test('drops to 1x when higher scales would exceed the canvas cap', () => {
    expect(capturePixelRatio(6000, 4000)).toBe(1);
  });
});

describe('packPrintChartPages', () => {
  test('keeps multiple short events on one page', () => {
    const pages = packPrintChartPages(
      [
        { eventId: 'a', top: 0, height: 200 },
        { eventId: 'b', top: 206, height: 200 },
      ],
      800,
      992,
      731
    );
    expect(pages).toEqual([{ eventIds: ['a', 'b'], top: 0, height: 406 }]);
  });

  test('starts a new page instead of splitting an event', () => {
    const pages = packPrintChartPages(
      [
        { eventId: 'a', top: 0, height: 500 },
        { eventId: 'b', top: 506, height: 400 },
      ],
      800,
      992,
      731
    );
    expect(pages.map((page) => page.eventIds)).toEqual([['a'], ['b']]);
    expect(pages[1]).toEqual({ eventIds: ['b'], top: 506, height: 400 });
  });

  test('gives an oversized event its own page rather than cropping it', () => {
    const pages = packPrintChartPages([{ eventId: 'tall', top: 0, height: 1200 }], 800, 992, 731);
    expect(pages).toEqual([{ eventIds: ['tall'], top: 0, height: 1200 }]);
  });

  test('still stacks short events when the chart is a bit too wide', () => {
    const pages = packPrintChartPages(
      [
        { eventId: 'a', top: 0, height: 200 },
        { eventId: 'b', top: 206, height: 200 },
      ],
      1200,
      992,
      731
    );
    expect(pages.map((page) => page.eventIds)).toEqual([['a', 'b']]);
  });

  test('keeps a short event beside a taller one instead of a new sheet', () => {
    const pages = packPrintChartPages(
      [
        { eventId: 'b', top: 0, height: 500, left: 0, width: 768 },
        { eventId: 'c', top: 506, height: 500, left: 0, width: 768 },
        { eventId: 'd', top: 506, height: 80, left: 780, width: 210 },
      ],
      990,
      992,
      731
    );
    expect(pages.map((page) => page.eventIds)).toEqual([['b'], ['c', 'd']]);
    expect(pages[1]?.height).toBe(500);
  });

  test('letter landscape is wider than it is tall', () => {
    expect(LETTER_LANDSCAPE_PT.width).toBeGreaterThan(LETTER_LANDSCAPE_PT.height);
    expect(LETTER_LANDSCAPE_PT.width).toBe(792);
    expect(LETTER_LANDSCAPE_PT.height).toBe(612);
  });
});
