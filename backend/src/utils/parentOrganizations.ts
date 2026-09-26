export const PARENT_ORG_URLS = {
  usaCurling: 'https://www.usacurling.org/',
  usaCurlingMembership: 'https://usacurling.org/membership',
  gncc: 'https://www.gncc.org/',
  uswca: 'https://www.uswca.org/',
} as const;

/** Exact club value required by the USA Curling roster template. */
export const USA_CURLING_CLUB_VALUE = 'Triangle Curling Club (NC - 689401)';

/** USA Curling Youth membership type when age is strictly less than this on the roster date. */
export const USA_CURLING_YOUTH_UNDER_AGE = 18;
