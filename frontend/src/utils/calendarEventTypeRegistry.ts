/**
 * Color and icon registry for calendar event types, shared by every surface that renders
 * scheduled ice (the calendar views and the ice booking picker).
 *
 * Light pastels with dark text for the light theme, saturated with white text for dark.
 */

import type { IconType } from 'react-icons';
import {
  HiAcademicCap,
  HiClipboardDocumentList,
  HiOutlineCalendar,
  HiOutlineCalendarDays,
  HiRectangleGroup,
  HiSparkles,
  HiStar,
  HiSun,
  HiUserGroup,
  HiWrench,
} from 'react-icons/hi2';
import { IoTrophyOutline } from 'react-icons/io5';

/** Event type definition - eventually user/admin-configurable */
export interface CalendarEventType {
  id: string;
  label: string;
  color: string; // Tailwind classes: bg + text for light/dark, e.g. 'bg-slate-100 text-gray-900 dark:bg-slate-600 dark:text-white'
  icon: IconType;
}

export const DEFAULT_EVENT_TYPES: CalendarEventType[] = [
  {
    id: 'maintenance',
    label: 'Maintenance',
    color:
      'bg-red-100 text-red-900 border-red-900/50 dark:bg-red-600 dark:text-white dark:border-white/25',
    icon: HiWrench,
  },
  {
    id: 'leagues',
    label: 'Leagues',
    color:
      'bg-cyan-100 text-cyan-950 border-cyan-900/40 dark:bg-cyan-700 dark:text-white dark:border-white/25',
    icon: HiRectangleGroup,
  },
  {
    id: 'bonspiel',
    label: 'Bonspiel',
    color:
      'bg-violet-200 text-violet-900 border-violet-900/50 dark:bg-violet-500 dark:text-white dark:border-white/25',
    icon: IoTrophyOutline,
  },
  {
    id: 'juniors',
    label: 'Juniors',
    color:
      'bg-fuchsia-100 text-fuchsia-900 border-fuchsia-900/50 dark:bg-fuchsia-600 dark:text-white dark:border-white/25',
    icon: HiSparkles,
  },
  {
    id: 'practice',
    label: 'Practice',
    color:
      'bg-amber-100 text-amber-900 border-amber-900/50 dark:bg-amber-500 dark:text-white dark:border-white/25',
    icon: HiOutlineCalendar,
  },
  {
    id: 'group-event',
    label: 'Group Event',
    color:
      'bg-orange-100 text-orange-900 border-orange-900/50 dark:bg-orange-500 dark:text-white dark:border-white/25',
    icon: HiUserGroup,
  },
  {
    id: 'clinic',
    label: 'Clinic',
    color:
      'bg-sky-100 text-sky-900 border-sky-900/50 dark:bg-sky-500 dark:text-white dark:border-white/25',
    icon: HiAcademicCap,
  },
  {
    id: 'social',
    label: 'Social',
    color:
      'bg-rose-100 text-rose-900 border-rose-900/50 dark:bg-rose-500 dark:text-white dark:border-white/25',
    icon: HiUserGroup,
  },
  {
    id: 'board-committee',
    label: 'Board & Committee',
    color:
      'bg-indigo-100 text-indigo-900 border-indigo-900/50 dark:bg-indigo-600 dark:text-white dark:border-white/25',
    icon: HiClipboardDocumentList,
  },
  {
    id: 'learn-to-curl',
    label: 'Learn to Curl',
    color:
      'bg-teal-100 text-teal-900 border-teal-900/50 dark:bg-teal-600 dark:text-white dark:border-white/25',
    icon: HiAcademicCap,
  },
  {
    id: 'off-season',
    label: 'Off-Season',
    color:
      'bg-orange-100 text-orange-900 border-orange-900/50 dark:bg-orange-500 dark:text-white dark:border-white/25',
    icon: HiSun,
  },
  {
    id: 'other',
    label: 'Other',
    color:
      'bg-gray-200 text-gray-900 border-gray-900/50 dark:bg-gray-500 dark:text-white dark:border-white/25',
    icon: HiOutlineCalendarDays,
  },
  {
    id: 'member-ice',
    label: 'Member booking',
    color:
      'bg-teal-100 text-teal-900 border-teal-900/50 dark:bg-primary-teal-solid dark:text-white dark:border-white/25',
    icon: HiStar,
  },
];

const FALLBACK_EVENT_TYPE = DEFAULT_EVENT_TYPES.find((t) => t.id === 'other')!;

export function getCalendarEventType(typeId: string): CalendarEventType {
  return DEFAULT_EVENT_TYPES.find((t) => t.id === typeId) ?? FALLBACK_EVENT_TYPE;
}
