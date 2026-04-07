Our app needs an Events system. This document outlines the design and implementation of the Events system.

## Design
Currently, our app has a Calendar which supports light-weight events. This feature is unrelated to this new Events system. Both will exist in the app.

Here are some key details about Events:
- Events are non-recurring.
- Events have a capacity and can be registered for
- Events can require a registration fee
- An event is associated with one or more timespans and locations. The calendar will show events as a new source, similar to how leagues are shown.
- Events can be public (visible to all users) or internal. Internal events are further broken down to all active members and members with ice privileges.
- Events will have an associated article
- Events will belong to one or more categories
- Events will optionally support group registration (i.e. one user registers for multiple people)
- Events will optionally support a waitlist for when the event is full
- We will have an events manager role that will be able to create, edit, and delete events.
- Each event will have one or more owners, who will have permissions to manage that particular event.
- The events system will support many kinds email notifications: registration confirmation, registration reminder, event reminder, event cancelled, registration cancel confirmation, notification to the owner when there is a new registration, promoted from waitlist to registered, etc.

Detailed list of features:
- Article associated with event will share the event's title
- An event may feature an image, which can be displayed on an event listings page, event registration page, etc.
- The event's associated article will serve as the event's detail page/description.
- An event may have a registration start date and/or registration cutoff date. If not supplied, the event will be open for registration immediately and the cutoff date will be the event's start date.
- An event will have a location. These are the same locations supported by lightweight calendar events (sheets, warm room, exterior, etc.).
- An event will usually have a single start and end time. This may span multiple days. However, we should support events with multiple start and end times.
- An event will have a configurable capacity. If the capacity is reached, new registrants will be added to a waitlist (joining the waitlist is always free).
- An event will have a configurable registration fee. Registrants must pay before their spot is confirmed.
- The event manager will be able to create single-use special registration links. When creating these links, the manager will have the option to make this registration:
  - Free or reduced fee
  - Bypass capacity limits (when someone registers with one of these links, the event's capacity instantly increases by one to accommodate the new registrant)
  - Ignore the registration start or cutoff date
  Once the link is used to successfullyregister, the link is no longer valid.
  These links can be invalidated by the event manager.
- Events will support users to cancel their own registration and get a refund, as long as it is within the configured cancellation window.
- Events can link to an article for terms and conditions, which will be displayed on the event registration page.
- An event can specify the maximum number of registrants in group registration.
- Events will have a published state. When unpublished, the event is not visible and cannot be registered for.
- Events can be duplicated. Duplicated events are unpublished by default.

Registration:
- All events will collect a name and email address.
- Event managers can configure additional fields to collect from registrants.
- We should support multiple types of fields: text, number, checkbox, dropdown, and radio.
- For group registration, a field may apply to the entire group or to each individual registrant, and should be configurable.
- Fields may be marked as required or optional
- All registration data should be available to the event manager
