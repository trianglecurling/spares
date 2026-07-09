import type { SearchDocument } from './types.js';

type StaticPageDefinition = {
  id: string;
  title: string;
  url: string;
  description: string;
  keywords: string;
};

const STATIC_PAGES: StaticPageDefinition[] = [
  {
    id: 'calendar',
    title: 'Calendar',
    url: '/calendar/public',
    description: 'View the club calendar with ice times, draws, leagues, and upcoming events.',
    keywords: 'schedule draw times ice sheet availability',
  },
  {
    id: 'donate',
    title: 'Donate',
    url: '/donate',
    description: 'Support Triangle Curling Club with a tax-deductible donation.',
    keywords: 'donation give support nonprofit 501c3 charity',
  },
  {
    id: 'contact',
    title: 'Contact',
    url: '/contact',
    description: 'Get in touch with Triangle Curling Club by email or phone.',
    keywords: 'email phone address reach club staff volunteers',
  },
  {
    id: 'dues',
    title: 'Membership dues estimator',
    url: '/dues',
    description: 'Estimate annual membership and league dues for the current season.',
    keywords: 'membership fees cost pricing league ice time',
  },
  {
    id: 'events',
    title: 'Events',
    url: '/events',
    description: 'Browse upcoming bonspiels, learn-to-curl sessions, and club events.',
    keywords: 'bonspiel learn to curl registration upcoming',
  },
  {
    id: 'leagues-public',
    title: 'Leagues',
    url: '/leagues/public',
    description: 'Learn about Triangle Curling Club league play and how to join.',
    keywords: 'league play teams competitive recreational curling',
  },
  {
    id: 'feedback',
    title: 'Feedback',
    url: '/feedback',
    description: 'Share feedback about the club website or member tools.',
    keywords: 'suggestions comments report issue help',
  },
];

export function buildStaticPageDocuments(): SearchDocument[] {
  const now = Date.now();
  return STATIC_PAGES.map((page) => {
    const plainText = `${page.description} ${page.keywords}`.trim();
    return {
      id: `page:${page.id}`,
      type: 'page',
      title: page.title,
      url: page.url,
      content: page.description,
      keywords: page.keywords,
      snippet: page.description,
      plainText,
      recencyMs: now,
    };
  });
}
