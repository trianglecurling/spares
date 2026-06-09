export type WebhookEventType =
  | 'payment.received'
  | 'payment.refunded'
  | 'event_registration.received';

export type WebhookEventRegistryEntry = {
  eventType: WebhookEventType;
  label: string;
  description: string;
};

export const WEBHOOK_EVENT_REGISTRY: WebhookEventRegistryEntry[] = [
  {
    eventType: 'payment.received',
    label: 'Payment received',
    description: 'Fires when any payment order succeeds (donation, membership, event registration, or curling registration).',
  },
  {
    eventType: 'payment.refunded',
    label: 'Refund issued',
    description: 'Fires when a payment order is fully or partially refunded.',
  },
  {
    eventType: 'event_registration.received',
    label: 'Event registration received',
    description: 'Fires when an event registration is confirmed by payment.',
  },
];

const byEventType = new Map(WEBHOOK_EVENT_REGISTRY.map((entry) => [entry.eventType, entry]));

export function getWebhookEventRegistry(): WebhookEventRegistryEntry[] {
  return WEBHOOK_EVENT_REGISTRY;
}

export function isKnownWebhookEventType(value: string): value is WebhookEventType {
  return byEventType.has(value as WebhookEventType);
}

export function getWebhookEventDocumentation(eventType: string): WebhookEventRegistryEntry | undefined {
  return byEventType.get(eventType as WebhookEventType);
}
