/**
 * Scrapes articles from trianglecurling.com and saves them as markdown JSON files.
 * Excludes: Home, Calendar, Event Listings, Live Stream, Merch Store.
 * Run: bun run src/scripts/scrape-articles.ts (from backend dir)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { load } from 'cheerio';
import { NodeHtmlMarkdown } from 'node-html-markdown';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://trianglecurling.com';
const OUTPUT_DIR = path.resolve(__dirname, '../../data/scraped-articles');
const FETCH_DELAY_MS = 500;

type ArticleEntry = {
  url: string;
  slug: string;
  category: string;
};

const ARTICLES: ArticleEntry[] = [
  // Leagues
  { url: '/index.php/leagues/membership-and-leagues-faq', slug: 'membership-and-leagues-faq', category: 'leagues' },
  { url: '/index.php/leagues/day-curling', slug: 'day-curling', category: 'leagues' },
  { url: '/index.php/leagues/league-info', slug: 'league-info', category: 'leagues' },
  { url: '/index.php/leagues/membership', slug: 'membership', category: 'leagues' },
  // About Curling
  { url: '/index.php/curling/about-curling/links-to-curling-associations-information', slug: 'links-to-curling-associations-information', category: 'about-curling' },
  { url: '/index.php/curling/about-curling/equipment-maintenance', slug: 'equipment-maintenance', category: 'about-curling' },
  { url: '/index.php/curling/about-curling/how-to-curl', slug: 'how-to-curl', category: 'about-curling' },
  { url: '/index.php/curling/about-curling/what-is-curling', slug: 'what-is-curling', category: 'about-curling' },
  // Events & Bonspiels
  { url: '/index.php/events/gncc-open-championship', slug: 'gncc-open-championship', category: 'events-bonspiels' },
  { url: '/index.php/events/triangle-junior-bonspiel', slug: 'triangle-junior-bonspiel', category: 'events-bonspiels' },
  { url: '/index.php/events/carolina-classic', slug: 'carolina-classic', category: 'events-bonspiels' },
  { url: '/index.php/events/over-under-spiel', slug: 'over-under-spiel', category: 'events-bonspiels' },
  { url: '/index.php/events/mixed-doubles-bonspiel', slug: 'mixed-doubles-bonspiel', category: 'events-bonspiels' },
  { url: '/index.php/events/bonspiels', slug: 'bonspiels', category: 'events-bonspiels' },
  // About Us
  { url: '/index.php/about/links', slug: 'about-links', category: 'about-us' },
  { url: '/index.php/about/sponsorship', slug: 'sponsorship', category: 'about-us' },
  { url: '/index.php/about/donate', slug: 'donate', category: 'about-us' },
  { url: '/index.php/about/diversity', slug: 'diversity', category: 'about-us' },
  { url: '/index.php/about/address-contact-information', slug: 'facility-contact-info', category: 'about-us' },
  // Other
  { url: '/index.php/private-events', slug: 'team-building-group-events', category: 'about-us' },
  { url: '/index.php/curling/try-curling', slug: 'try-curling', category: 'about-curling' },
];

function cleanContent(content: string): string {
  // Strip boilerplate: content from "---" + "#### Member Login" onward
  const boilerplateMarker = '\n---\n\n#### Member Login';
  const idx = content.indexOf(boilerplateMarker);
  if (idx !== -1) {
    content = content.slice(0, idx);
  }
  // Also try alternate pattern
  const altMarker = '\n---\n#### Member Login';
  const altIdx = content.indexOf(altMarker);
  if (altIdx !== -1 && (idx === -1 || altIdx < idx)) {
    content = content.slice(0, altIdx);
  }
  // Replace email obfuscation placeholder
  content = content.replace(
    /This email address is being protected from spambots\. You need JavaScript enabled to view it\./gi,
    '[contact email]'
  );
  return content.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeArticle(entry: ArticleEntry): Promise<{ title: string; slug: string; content: string; category: string } | null> {
  const fullUrl = BASE_URL + entry.url;
  try {
    const res = await fetch(fullUrl);
    if (!res.ok) {
      console.error(`  Failed to fetch ${fullUrl}: ${res.status}`);
      return null;
    }
    const html = await res.text();
    const $ = load(html);

    // Extract main content - Joomla typically uses article.item-page or #content
    let mainHtml = $('article.item-page').html() || $('.item-page').html() || $('#content .item-page').html();
    if (!mainHtml) {
      mainHtml = $('article').first().html() || $('.content').html() || $('main').html() || $('body').html() || '';
    }
    if (!mainHtml?.trim()) {
      console.error(`  No content found for ${fullUrl}`);
      return null;
    }

    const title = $('h1').first().text().trim() || $('article h1').first().text().trim() || $('title').text().replace(/ - Triangle Curling$/, '').trim() || entry.slug;

    const nhm = new NodeHtmlMarkdown();
    let content = nhm.translate(mainHtml);
    content = cleanContent(content);

    return {
      title: title || entry.slug.replace(/-/g, ' '),
      slug: entry.slug,
      content,
      category: entry.category,
    };
  } catch (err) {
    console.error(`  Error fetching ${fullUrl}:`, err);
    return null;
  }
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log(`Scraping ${ARTICLES.length} articles from ${BASE_URL}...`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < ARTICLES.length; i++) {
    const entry = ARTICLES[i];
    process.stdout.write(`[${i + 1}/${ARTICLES.length}] ${entry.slug}... `);

    const article = await scrapeArticle(entry);
    if (article) {
      const outPath = path.join(OUTPUT_DIR, `${entry.slug}.json`);
      fs.writeFileSync(outPath, JSON.stringify(article, null, 2), 'utf-8');
      console.log('OK');
      success++;
    } else {
      console.log('FAILED');
      failed++;
    }

    if (i < ARTICLES.length - 1) {
      await sleep(FETCH_DELAY_MS);
    }
  }

  console.log(`\nDone. ${success} success, ${failed} failed. Output: ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error('Scrape failed:', err);
  process.exit(1);
});
