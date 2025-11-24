# Manual Test Plan - Triangle Curling Spares

## Table of Contents
1. [Authentication & User Management](#authentication--user-management)
2. [First Login & Profile Setup](#first-login--profile-setup)
3. [Availability Management](#availability-management)
4. [Spare Request Creation](#spare-request-creation)
5. [Responding to Spare Requests](#responding-to-spare-requests)
6. [Dashboard & Request Management](#dashboard--request-management)
7. [Member Directory](#member-directory)
8. [Administrator - League Management](#administrator---league-management)
9. [Administrator - Member Management](#administrator---member-management)
10. [Security & Access Control](#security--access-control)

---

## Authentication & User Management

### Test Case 1.1: Initial Login Flow
**Objective:** Verify users can log in with email or phone number

**Prerequisites:**
- User account exists in the system
- User has not completed first login

**Steps:**
1. Navigate to login page
2. Enter email address or phone number
3. Click "Send login code"
4. Check email/SMS for verification code
5. Enter verification code
6. Click "Verify code"

**Expected Results:**
- Login code is sent successfully
- User receives code via email/SMS
- After entering correct code, user is redirected to first login page
- User is authenticated and session is maintained

**Negative Cases:**
- Invalid email/phone format shows error
- Invalid verification code shows error
- Expired verification code shows error

---

### Test Case 1.2: Welcome Email Token Login
**Objective:** Verify welcome email link automatically logs user in

**Prerequisites:**
- Admin has sent welcome email to a member
- User has not completed first login

**Steps:**
1. Admin sends welcome email to member
2. User clicks link in welcome email
3. Verify user is automatically logged in
4. Verify user is redirected to first login page

**Expected Results:**
- Token in URL automatically authenticates user
- No manual login required
- User proceeds directly to profile setup

---

### Test Case 1.3: Logout
**Objective:** Verify users can log out successfully

**Steps:**
1. While logged in, click "Logout" button in navigation
2. Verify user is logged out
3. Verify user is redirected to login page
4. Attempt to access protected route (e.g., /dashboard)
5. Verify user is redirected to login page

**Expected Results:**
- User session is terminated
- User cannot access protected routes after logout
- User must log in again to access the app

---

## First Login & Profile Setup

### Test Case 2.1: Complete First Login Profile Setup
**Objective:** Verify first-time users can set up their profile

**Prerequisites:**
- User is logged in for the first time
- User is on first login page

**Steps:**
1. Verify "Welcome to Triangle Curling Spares!" message is displayed
2. Enter name in "Your name" field (required)
3. Enter email address in "Email address" field (required)
4. Optionally enter phone number
5. Check/uncheck "Make my email address visible to other club members"
6. Check/uncheck "Make my phone number visible to other club members"
7. Optionally check "Opt in to text messages"
8. Click "Continue"
9. On step 2, verify success message
10. Click "Set my availability"

**Expected Results:**
- All required fields are validated
- Email format is validated
- Profile is saved successfully
- User proceeds to availability setup page
- Privacy settings are saved correctly

**Negative Cases:**
- Empty name field shows validation error
- Invalid email format shows validation error
- Missing required fields prevent submission

---

### Test Case 2.2: Profile Privacy Settings
**Objective:** Verify privacy settings affect directory visibility

**Prerequisites:**
- User has completed first login
- Another user exists to view directory

**Steps:**
1. User A sets email visible = true, phone visible = false
2. User B views member directory
3. Verify User A's email is visible
4. Verify User A's phone shows as "—"
5. User A updates phone visible = true
6. User B refreshes directory
7. Verify User A's phone is now visible

**Expected Results:**
- Privacy settings immediately affect directory visibility
- Hidden information shows as "—" not "Hidden"
- Changes persist after refresh

---

## Availability Management

### Test Case 3.1: Set League Availability
**Objective:** Verify users can set availability for leagues

**Prerequisites:**
- User is logged in
- At least one league exists
- User navigates to "My availability" page

**Steps:**
1. Navigate to "My availability" page
2. Verify all leagues are displayed
3. Toggle availability for League A to "on"
4. Verify green checkmark appears: "✓ You're available to spare for this league"
5. Toggle availability for League A to "off"
6. Verify checkmark disappears
7. Toggle availability for multiple leagues
8. Refresh page
9. Verify all toggles persist

**Expected Results:**
- Toggles work smoothly without layout shift
- Availability status saves automatically
- Status persists after page refresh
- Visual feedback (green border, checkmark) appears/disappears correctly

---

### Test Case 3.2: Set Skip Availability
**Objective:** Verify users can indicate skip comfort level

**Steps:**
1. Navigate to "My availability" page
2. Locate "Comfortable skipping?" toggle
3. Toggle to "on"
4. Verify toggle state changes
5. Refresh page
6. Verify toggle state persists

**Expected Results:**
- Skip availability saves automatically
- State persists after refresh

---

### Test Case 3.3: Availability Display in Request Flow
**Objective:** Verify available members appear when creating private requests

**Prerequisites:**
- User A has set availability for League X
- User B is creating a private spare request for League X

**Steps:**
1. User B navigates to "Request a spare"
2. Select League X
3. Select request type "Private"
4. Verify "Members available during [League X]" box appears
5. Verify User A appears in available members list
6. Click "+" next to User A
7. Verify User A appears in selected members pills
8. Verify User A no longer appears in available members list

**Expected Results:**
- Only members with availability for selected league appear
- Available members list updates when members are selected
- Current user is excluded from available members

---

## Spare Request Creation

### Test Case 4.1: Create Public Spare Request
**Objective:** Verify users can create public spare requests

**Prerequisites:**
- User is logged in
- At least one league exists with upcoming games

**Steps:**
1. Navigate to "Request a spare" page
2. Enter name in "Person who needs the spare" field
3. Select a league from dropdown
4. Verify "Game date & time" dropdown populates with upcoming games
5. Select a game date & time
6. Optionally select a position (lead, second, vice, skip)
7. Optionally enter message in "Any additional details" field
8. Select "Public" request type
9. Click "Submit request"

**Expected Results:**
- Request is created successfully
- User is redirected to dashboard or success page
- Request appears in "Outstanding spare requests" section
- All members can see the request

**Negative Cases:**
- Missing required fields show validation errors
- Selecting league without games shows appropriate message
- Invalid date/time selection is prevented

---

### Test Case 4.2: Create Private Spare Request
**Objective:** Verify users can create private spare requests with specific invitees

**Prerequisites:**
- User is logged in
- At least one league exists
- Other members exist with availability for the league

**Steps:**
1. Navigate to "Request a spare" page
2. Fill in required fields (name, league, game time)
3. Select "Private" request type
4. Verify "Select members to invite" section appears
5. Verify "Members available during [league]" box appears
6. Search for a member in autocomplete field
7. Select member from dropdown (or use arrow keys + Enter)
8. Verify member appears as pill with X button
9. Click "+" button next to available member
10. Verify member is added to selected list
11. Remove a member by clicking X on pill
12. Verify at least one member is selected
13. Click "Submit request"

**Expected Results:**
- Private request is created successfully
- Only invited members can see the request
- Autocomplete supports keyboard navigation (arrow keys, Enter)
- Selected members display as removable pills

**Negative Cases:**
- Submitting without selecting members shows error
- Cannot submit with zero selected members

---

### Test Case 4.3: Autocomplete Keyboard Navigation
**Objective:** Verify autocomplete is keyboard accessible

**Steps:**
1. Navigate to "Request a spare"
2. Select "Private" request type
3. Click in member search field
4. Type a few letters
5. Use arrow keys to navigate dropdown
6. Press Enter to select highlighted member
7. Press Escape to close dropdown
8. Tab to selected member pills
9. Verify focus indicators are visible

**Expected Results:**
- Arrow keys navigate dropdown options
- Enter selects highlighted option
- Escape closes dropdown
- Tab navigation works on pills
- Focus indicators are clearly visible

---

## Responding to Spare Requests

### Test Case 5.1: Respond to Public Spare Request
**Objective:** Verify users can respond to public spare requests

**Prerequisites:**
- User A has created a public spare request
- User B is logged in and can see the request

**Steps:**
1. User B navigates to dashboard
2. Locate User A's request in "Outstanding spare requests"
3. Click "Sign Up" button
4. Verify modal opens: "Confirm spare"
5. Verify request details are displayed correctly
6. Optionally enter message in "Optional message" field
7. Click "Confirm"
8. Verify request status changes to "filled"
9. Verify User B appears as "Filled by" in request details
10. Verify request moves to "Filled spare requests" section

**Expected Results:**
- Response is successful
- Request is marked as filled
- Filler's name is displayed
- Request no longer appears in outstanding requests
- Optional message is saved

**Negative Cases:**
- Responding to already-filled request shows error
- Cancelled requests cannot be responded to

---

### Test Case 5.2: Respond to Private Spare Request
**Objective:** Verify only invited members can respond to private requests

**Prerequisites:**
- User A creates private request inviting User B and User C
- User D is not invited

**Steps:**
1. User B logs in
2. Verify User A's request appears in dashboard
3. User B responds to request
4. Verify request is filled by User B
5. User C logs in
6. Verify User A's request does NOT appear (already filled)
7. User D logs in
8. Verify User A's request does NOT appear in dashboard
9. User D navigates directly to request URL (if known)
10. Verify User D cannot access the request

**Expected Results:**
- Only invited members see private requests
- Non-invited members cannot see or respond to private requests
- Once filled, request disappears for other invitees

---

### Test Case 5.3: View My Upcoming Sparing
**Objective:** Verify users can see games they've signed up to spare for

**Prerequisites:**
- User has responded to at least one spare request

**Steps:**
1. Navigate to dashboard
2. Locate "My upcoming sparing" section
3. Verify all requests where user is the filler are listed
4. Verify request details are displayed (date, time, requester, position)
5. Verify message from requester is displayed
6. Verify no "Sign Up" button appears

**Expected Results:**
- All upcoming sparing commitments are visible
- Details are accurate and complete
- Section only appears if user has upcoming sparing

---

## Dashboard & Request Management

### Test Case 6.1: Dashboard Overview
**Objective:** Verify dashboard displays all relevant information

**Prerequisites:**
- User is logged in
- Various spare requests exist (open, filled, user's own)

**Steps:**
1. Navigate to dashboard
2. Verify "Request a spare" and "Set your availability" quick action cards are visible
3. Verify "My upcoming sparing" section appears if user has commitments
4. Verify "Outstanding spare requests" section displays all open requests
5. Verify "Filled spare requests" section is collapsible
6. Click to expand "Filled spare requests"
7. Verify filled requests are displayed
8. Verify comment from sparing member is NOT shown in filled requests section

**Expected Results:**
- All sections render correctly
- Quick actions are functional
- Filled requests section is expandable/collapsible
- Comments are hidden in filled requests view

---

### Test Case 6.2: Cancel Own Spare Request
**Objective:** Verify users can cancel their own spare requests

**Prerequisites:**
- User has created at least one open spare request

**Steps:**
1. Navigate to "My spare requests" page
2. Locate an open request
3. Click "Cancel" button
4. Confirm cancellation in dialog
5. Verify request status changes to "cancelled"
6. Verify request no longer appears in outstanding requests
7. Verify cancelled request still appears in "My spare requests" with cancelled status

**Expected Results:**
- Cancellation requires confirmation
- Request status updates correctly
- Cancelled requests are removed from public view
- User can still see their cancelled requests

**Negative Cases:**
- Cannot cancel already-filled requests
- Cannot cancel already-cancelled requests

---

## Member Directory

### Test Case 7.1: View Member Directory
**Objective:** Verify members can view directory with privacy respect

**Prerequisites:**
- Multiple members exist with varying privacy settings
- User is logged in

**Steps:**
1. Navigate to "Member directory" page
2. Verify all members are listed
3. Verify member names are always visible
4. For members with email_visible = true: verify email is displayed
5. For members with email_visible = false: verify "—" is displayed (not "Hidden")
6. For members with phone_visible = true: verify phone is displayed
7. For members with phone_visible = false: verify "—" is displayed
8. For members without phone: verify "—" is displayed
9. Verify admin badge appears for administrators
10. Use search field to filter members
11. Verify filtering works correctly

**Expected Results:**
- Directory respects all privacy settings
- Hidden/missing info shows as "—"
- Search functionality works
- Admin badges are visible

---

### Test Case 7.2: Directory Privacy Consistency
**Objective:** Verify privacy settings are consistently applied

**Prerequisites:**
- User A has email_visible = false, phone_visible = true, no phone on file
- User B views directory

**Steps:**
1. User B views directory
2. Verify User A's email shows as "—"
3. Verify User A's phone shows as "—" (because no phone on file, even though visible = true)
4. User A adds phone number
5. User B refreshes directory
6. Verify User A's phone is now visible

**Expected Results:**
- Privacy settings work correctly
- Missing data always shows as "—" regardless of visibility setting
- Changes reflect immediately

---

## Administrator - League Management

### Test Case 8.1: Create League
**Objective:** Verify admins can create leagues

**Prerequisites:**
- User is logged in as admin
- Navigate to "Manage leagues" page

**Steps:**
1. Click "Add league" button
2. Enter league name (required)
3. Select day of week (required)
4. Add at least one draw time (required)
5. Add additional draw times using "+ Add draw time"
6. Remove a draw time using "Remove" button
7. Select format (Teams or Doubles) (required)
8. Select start date (required)
9. Select end date (required)
10. Click "Save"
11. Verify league appears in leagues list
12. Verify all details are displayed correctly

**Expected Results:**
- League is created successfully
- All required fields are validated
- Multiple draw times can be added/removed
- Date range is saved correctly
- League appears in list immediately

**Negative Cases:**
- Missing required fields show validation errors
- End date before start date shows error
- Empty draw times array shows error

---

### Test Case 8.2: Edit League
**Objective:** Verify admins can edit existing leagues

**Steps:**
1. Navigate to "Manage leagues"
2. Click "Edit" on an existing league
3. Modify league name
4. Change day of week
5. Add/remove draw times
6. Change format
7. Update date range
8. Click "Save"
9. Verify changes are reflected in league list

**Expected Results:**
- Changes are saved successfully
- All fields can be updated
- Changes persist after refresh

---

### Test Case 8.3: Delete League
**Objective:** Verify admins can delete leagues

**Steps:**
1. Navigate to "Manage leagues"
2. Click "Delete" on a league
3. Confirm deletion in dialog
4. Verify league is removed from list
5. Verify related availability records are deleted (cascade)

**Expected Results:**
- Deletion requires confirmation
- League is removed successfully
- Related data is cleaned up

---

### Test Case 8.4: League Date Display
**Objective:** Verify league dates display correctly without timezone offset

**Steps:**
1. Create/edit league with start date: 2024-01-15, end date: 2024-03-31
2. Save league
3. View league in list
4. Verify dates display as "1/15/2024 - 3/31/2024" (not one day earlier)

**Expected Results:**
- Dates display correctly without timezone offset
- No off-by-one day errors

---

## Administrator - Member Management

### Test Case 9.1: Create Member
**Objective:** Verify admins can create individual members

**Prerequisites:**
- User is logged in as admin
- Navigate to "Manage members" page

**Steps:**
1. Click "Add member" button
2. Enter name (required)
3. Enter email address (required)
4. Optionally enter phone number
5. Check/uncheck "Publicly visible" for phone
6. Check/uncheck "Administrator" checkbox
7. Click "Save"
8. Verify member appears in members list
9. Verify welcome email can be sent to new member

**Expected Results:**
- Member is created successfully
- Email is required and validated
- Phone is optional
- Admin status can be set
- Member appears in list immediately

**Negative Cases:**
- Missing name shows validation error
- Missing email shows validation error
- Invalid email format shows validation error

---

### Test Case 9.2: Edit Member
**Objective:** Verify admins can edit member details

**Steps:**
1. Click "Edit" on a member
2. Modify name
3. Modify email
4. Modify phone
5. Toggle admin status
6. Toggle privacy settings
7. Click "Save"
8. Verify changes are reflected

**Expected Results:**
- All fields can be updated
- Changes persist
- Privacy settings are saved

---

### Test Case 9.3: Delete Member
**Objective:** Verify admins can delete members

**Steps:**
1. Click "Delete" on a non-admin member
2. Confirm deletion
3. Verify member is removed
4. Verify related data is cleaned up (availability, spare requests, etc.)

**Expected Results:**
- Deletion requires confirmation
- Member is removed successfully
- Related records are deleted (cascade)

**Negative Cases:**
- Cannot delete administrators via bulk delete
- Cannot delete administrators via individual delete (if implemented)

---

### Test Case 9.4: Bulk Import Members
**Objective:** Verify admins can bulk import members from spreadsheet data

**Prerequisites:**
- Admin is logged in
- Spreadsheet data ready (First Name, Last Name, Phone, Email)

**Steps:**
1. Click "Bulk import" button
2. Paste spreadsheet data (with header row)
3. Click "Preview"
4. Verify preview modal shows all parsed members
5. Verify table displays correctly (desktop) or cards (mobile)
6. Verify modal is appropriately sized (no horizontal scrollbars)
7. Review member list
8. Click "Import X Members"
9. Verify all members are created
10. Verify members appear in members list

**Expected Results:**
- Data is parsed correctly (comma or tab delimited)
- Preview shows accurate member count
- Modal is responsive and properly sized
- All members are imported successfully
- Imported members have correct data

**Negative Cases:**
- Missing header row shows error
- Invalid data format shows error
- Empty data shows error
- Duplicate emails may show error (if validation exists)

---

### Test Case 9.5: Bulk Delete Members
**Objective:** Verify admins can bulk delete members

**Prerequisites:**
- Multiple non-admin members exist

**Steps:**
1. Check checkbox next to Member A
2. Check checkbox next to Member B
3. Check "Select all" checkbox
4. Verify all non-admin members are selected
5. Verify admin members are NOT selected
6. Uncheck some members
7. Click "Delete selected (X)" button
8. Confirm deletion
9. Verify selected members are deleted
10. Verify admin members are NOT deleted

**Expected Results:**
- Multiple members can be selected
- Select all works correctly
- Admins are excluded from bulk delete
- Deletion requires confirmation
- Selected members are removed
- Related data is cleaned up

**Negative Cases:**
- Cannot select administrators
- Bulk delete with zero selection shows error

---

### Test Case 9.6: Send Welcome Email
**Objective:** Verify admins can send welcome emails

**Steps:**
1. Locate member with email address
2. Click "Welcome email" button
3. Confirm sending
4. Verify success message appears
5. Check member's email inbox
6. Verify email contains login link with token
7. Click link in email
8. Verify user is automatically logged in

**Expected Results:**
- Welcome email is sent successfully
- Email contains valid token link
- Link automatically authenticates user
- User proceeds to first login flow

**Negative Cases:**
- Member without email shows error
- Invalid email address shows error

---

## Security & Access Control

### Test Case 10.1: Private Request Visibility
**Objective:** Verify private requests are only visible to invitees

**Prerequisites:**
- User A creates private request inviting User B
- User C is not invited
- User D is admin

**Steps:**
1. User B logs in
2. Verify User A's request appears in dashboard
3. User C logs in
4. Verify User A's request does NOT appear
5. User C attempts to access request directly via URL
6. Verify User C receives 403/404 error or redirect
7. User D (admin) logs in
8. Verify User D can see the request (if admin override exists) OR cannot see it (if no override)

**Expected Results:**
- Only invited members see private requests
- Non-invited members cannot access private requests
- Direct URL access is blocked for non-invited members

---

### Test Case 10.2: Admin-Only Routes
**Objective:** Verify non-admins cannot access admin routes

**Prerequisites:**
- User A is admin
- User B is not admin

**Steps:**
1. User B logs in
2. User B attempts to navigate to /admin/members
3. Verify User B is redirected or receives 403 error
4. User B attempts to navigate to /admin/leagues
5. Verify User B is redirected or receives 403 error
6. User B attempts to call admin API endpoints directly
7. Verify API returns 403 Forbidden

**Expected Results:**
- Admin routes are protected
- Non-admins cannot access admin pages
- API endpoints enforce admin-only access

---

### Test Case 10.3: Member Data Visibility
**Objective:** Verify member data visibility respects privacy settings and admin status

**Prerequisites:**
- User A has email_visible = false, phone_visible = true, phone = null
- User B is regular member
- User C is admin

**Steps:**
1. User B views member directory
2. Verify User A's email shows as "—"
3. Verify User A's phone shows as "—"
4. User C (admin) views member directory
5. Verify User C can see User A's actual email
6. Verify User C can see User A's phone (null)
7. User B views /members API response
8. Verify User A's email is null in response
9. User C views /members API response
10. Verify User C can see User A's actual email

**Expected Results:**
- Regular members see filtered data based on privacy settings
- Admins see all data regardless of privacy settings
- API responses respect user role and privacy settings

---

### Test Case 10.4: Bulk Delete Admin Protection
**Objective:** Verify administrators cannot be bulk deleted

**Steps:**
1. Admin navigates to "Manage members"
2. Verify admin members do NOT have checkboxes
3. Verify "Select all" does NOT select admin members
4. Attempt to manually select admin member via browser dev tools
5. Attempt bulk delete API call with admin ID
6. Verify admin member is NOT deleted

**Expected Results:**
- Admin members are excluded from bulk delete UI
- Admin members cannot be deleted via bulk operations
- API enforces admin protection

---

### Test Case 10.5: Cross-User Request Modification
**Objective:** Verify users cannot modify other users' requests

**Prerequisites:**
- User A creates a spare request
- User B is logged in

**Steps:**
1. User B attempts to cancel User A's request
2. Verify User B cannot see cancel button on User A's request
3. User B attempts to call cancel API directly with User A's request ID
4. Verify API returns 403 Forbidden or 404 Not Found

**Expected Results:**
- Users can only modify their own requests
- API enforces ownership checks

---

### Test Case 10.6: Authentication Token Expiration
**Objective:** Verify authentication tokens expire appropriately

**Steps:**
1. User logs in successfully
2. Note current time
3. Wait for token expiration (if implemented)
4. Attempt to access protected route
5. Verify user is redirected to login
6. Verify user must log in again

**Expected Results:**
- Expired tokens are rejected
- Users are prompted to re-authenticate

---

## Test Data Requirements

### Test Users
- **Admin User**: Full admin privileges
- **Regular User A**: Has availability set for League 1
- **Regular User B**: Has availability set for League 2
- **Regular User C**: No availability set
- **Regular User D**: Various privacy settings

### Test Leagues
- **League 1**: Sunday, Teams format, multiple draw times
- **League 2**: Wednesday, Doubles format, single draw time
- **League 3**: Friday, Teams format, various times

### Test Spare Requests
- Public requests for various leagues
- Private requests with different invitee combinations
- Filled requests
- Cancelled requests
- Requests with positions specified
- Requests with messages

---

## Test Environment Setup

1. **Database**: Fresh database with test data
2. **Email/SMS**: Test email service configured (or mocked)
3. **Browser**: Test in Chrome, Firefox, Safari, and mobile browsers
4. **Screen Sizes**: Test desktop (1920x1080), tablet (768x1024), mobile (375x667)

---

## Regression Testing Checklist

After major changes, verify:
- [ ] Login flow still works
- [ ] First login flow still works
- [ ] Availability toggles save correctly
- [ ] Spare requests can be created (public and private)
- [ ] Responses to requests work
- [ ] Dashboard displays correctly
- [ ] Member directory respects privacy
- [ ] Admin functions work
- [ ] Bulk import/delete work
- [ ] Security restrictions are enforced

---

## Notes

- All test cases should be executed in a clean test environment
- Test data should be reset between test runs
- Screenshots should be captured for any failures
- Edge cases and error conditions should be thoroughly tested
- Performance should be monitored during bulk operations

