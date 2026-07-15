import { processVolunteerReminders } from './volunteeringService.js';

let processorStarted = false;

export function startVolunteerReminderProcessor(): void {
  if (processorStarted) return;
  processorStarted = true;
  setInterval(() => {
    processVolunteerReminders().catch((error) => {
      console.error('Error in volunteer reminder processor:', error);
    });
  }, 5 * 60 * 1000);
  console.log('Volunteer reminder processor started (checking every 5 minutes)');
}
