# Scope Expansion: Curling League Management

## Terminology
- Game: a game is a single match between exactly two teams. A game is played on a sheet and is scheduled during a draw.
- Draw: a draw is a single date and time when one or more games are played. The number of games in a draw is less than or equal to the number of sheets.
- Sheet: a sheet is the field of play for a game. For example, with four sheets, four simultaneous games can be played.

## Desired functionality

1. League management
   - Right now we have a simple way for admins to define leagues. This is a great start for setting up leagues.

2. Sheets
   - Games are played on sheets. We need a way to define our sheets and name them (this will be used later to build league schedules).

3. Teams
   - Each league will need a way to add teams. Depending on the league format (teams or doubles), each team will have some number of players.
   - Teams: 4 players - lead, second, third, fourth. Additionally, one of those players is designated the "Skip" and another is designated the "Vice" (the skip and the vice cannot be the same player). We should permit 3-person teams, in which case there is no "second" (so we have lead, third, and fourth, again, with a skip and a vice).
   - Doubles: 2 players - Player 1 and Player 2 (stable order, no skip/vice).
   - The members that make up a team should come from the list of members (i.e. the user should be able to build teams using an autocomplete).
   - All teams can also have a team name, although if the team name is omitted, the implied team name is "Team \<Last name of the skip>" (for a teams team) or "<Player 1 Last Name>/<Player 2 Last Name>" (for a doubles team).

4. Divisions
   - A league has one or more divisions into which teams are divided. By default, each league has one division, but more can be created. Divisions can be named. When creating a team, if there are multiple divisions, the user should be able to select which division the team belongs in (otherwise they are automatically assigned to the default division). If multiple divisions exist, we need UI to reassign the division of each team.

5. Draws
   - Each league has multiple draws which are defined by the league parameters (day and draw times of the league, minus exceptions). We should add the ability to create additional day+time one-off draws for a given league. By default, any given draw has all sheets available, but we should be able to specify a subset of sheets that are available for the draw.
   - NOTE: Draws should not be a first-class entity that we manage. Draws, in their purest sense, are defined by the games that are scheduled. In other words, if you take all scheduled games and collect UNIQUE date/times of those games, you are left with the set of draw times. As explained above, a league can define its draw times - this is largely a convenience feature for determining the dates and times of the games, and it will be used for automatic game scheduling (see below) and help with manual game scheduling.

6. Rounds
   Rounds are not a first-class concept; round robin strategies implicitly define them.

7. Games
   - A game is a single match-up between two teams. A game takes place at a specific date and time, and it takes place on a specific sheet, however, games may be "unscheduled" meaning they do not have a date, time, or sheet assignment. By and large, most games will take place during the specified draw times of the league, but this is not required - games can be scheduled for any date/time.

8. Results
   - Each game will have a result. The result is recorded as a list of non-negative integers for each team. The values in this list are successive tiebreaker point values. For example, the league manager might record a win as a 1 for the winning team and a 0 for the losing team, but the second value might be the score of the game, so the first team's result would be (1, 7) and the second team's would be (0, 4). In the event of a tie between two teams from win/loss record, the tie could be broken by cumulative points scored.
   - We will always be able to produce a ranking of teams throughout the season using the game results.

9. Ranking
   - Using the results described above, we can generate a ranking of teams, from first place to last place. Teams may be tied, in which case they will be listed with the same rank, with the next placing team skipping the appropriate number of ranks (e.g. first place, first place, third place). We also need a league setting that determines whether or not head-to-head should be used as the first tiebreaker, since that cannot be captured in the list of scores.

10. Game scheduling
    - There are two ways of scheduling games: manual and automatic.
    - Manual: Games are entered, one by one. Most games will fit into a slot determined by the draw times specified by the league, but this is not required. Manually entered games have: game date, game time, sheet assignment, team 1, and team 2. Games may also be "unscheduled" meaning they have no game date, time, or sheet assignment.
    - Automatic: We will automatically generate games to construct a round robin for the selected divisions. When automatically generating games, these principles should be followed:
      - The user will be able to specify multiple round robin strategies for game generation. Each strategy is given a priority. Strategies with the higher priority (lower number) are completed before the next is considered, but it is also possible for multiple strategies to have the same priority, in which case they each generate an equal number of games per team.
      - A round robin strategy includes:
        - intra-division or cross-division games
        - number of games per team (by default, this will be the number of teams in the division minus 1)
      - To the extent possible, teams should play on each sheet roughly an equal number of times.
      - To the extent possible, teams should be assigned as "Team 1" and as "Team 2" roughly an equal number of times.
      - If a league has multiple draw times, to the extent possible, teams should play each draw time a roughly equal number of times.
      - If there are not enough game slots to complete the round robin strategy, schedule a partial round robin (i.e. teams will not necessarily play every other team). The user will have the option to leave the rest of the games as "unscheduled" or simply not generate them at all.
      - If there are more game slots than we need for a full round robin, leave those slots with no games scheduled.
    - Automatic game generation does not include tournament-style playoff games; those games can be entered manually by the league manager.
    - The generated game schedule should be previewed to the user so they can review before saving it.
    - The automatic game generation should also be able to take in prioritized bye requests from each team. This means that we will need a way for a team member to specify their bye priorities prior to schedule generation. To the extent possible, we should honor the highest priority bye requests from each team.

    When generating a schedule, use the following prioritized list of constraints (most important comes first):
    1. Satisfy the number of games/completing the round robin.
    2. Satisfy any hard constraints created by the league manager
    3. No team can play twice in the same week.
    4. The number of draws used should be ceiling(total games / number of sheets)
    5. There should be no more than one empty sheet for any given draw. The total number of empty sheets across all draws should be less than the number of sheets (otherwise, it means we could have used fewer draws by more efficient use of sheets).
    6. If the league has 2 draws (one early, one late), for any team that chooses "Prefer late draw", avoid assigning them to the early draw.
    7. Satisfy each team's top bye request (if multiple dates are specified with highest priority, choose any).
    8. Satisfy equal play among all draw times
    9. Satisfy each team's 2nd choice bye request.
    10. Satisfy equal play among all the sheets.
    11. Avoid granting a team back-to-back bye weeks (unless specifically requested).
    12. Satisfy each team's additional bye requests.
    13. Satisfy being "Team 1" and "Team 2" and equal number of times.

11. League participant dashboard experience
    - Because this is a relatively large scope expansion, I'm thinking we should have 2 tabs below the CTA buttons on the dashboard - "Leagues" and "Sparing". When on the sparing tab, we show all the sparing details that we show currently. When on the leagues tab, we should see a heading for each league that the user is part of, followed by details about upcoming games. League participants should be able to view their upcoming games. They should be able to see who they are playing and what sheet they are on. Participants should be able to easily request a spare for an upcoming game - we would automatically fill in the league and draw, for example.

12. Leagues page
    - We will open up the leagues page to all users, not just admins. Of course, only admins can edit leagues, but everyone can view them. From the leagues page, anyone will be able to drill into a league to see the league schedule, the teams (and the team rosters), rankings/points, etc. A future addition might be some automated statkeeping and analytics, such as calculating the chances of a team finishing at a certain rank.

13. Notifications and emails
    - We will have a notification system to remind players of their upcoming league games. Players will receive an email 24 hours prior to their game with 1) game date and time, 2) sheet assignment, 3) full roster of both teams playing, and 4) a link to request a spare for this upcoming game.
    - We will also need a notification preferences page for each user to opt-out of certain classes of emails. The one-size-fits-all "unsubscribe" button is no longer sufficient.

14. Stats
    - Eventually I want to build some statistics tools, so for now, I want to make sure we are collecting and maintaining all the data needed for that. We should be keeping track of games played (per individual - not per team), wins, losses, ties.

15. Kiosk
    - Separately I am building a kiosk that will display the names of the players for the upcoming draw. I need an API endpoint that gives me the date, time, and players for the next 3 games on each sheet. In the event a spare is playing for one of the players, the data should reflect that Person B is sparing for Person A.

16. Backwards compatibility
    - While it may not be possible to make the database fully backwards compatible with an old version of the application (i.e. a version that only supports the sparing features), document any instances where compatibility is broken. Make a reasonable effort to avoid breaking compatibility.

## Implementation plan

The phases below are designed so each can be manually validated before moving on. Each phase defines work for the data, application, and frontend tiers.

### Phase 1 - Core league structure (sheets, divisions, teams, rosters)
- Data tier
  - Add `sheets` (club-level sheet list with name, sort_order, is_active).
  - Add `league_divisions` (league_id, name, sort_order, is_default) with a default division per league.
  - Add `league_teams` (league_id, division_id, name, created_at, updated_at).
  - Add `team_members` with role metadata to cover teams and doubles (role, is_skip, is_vice; doubles use player1/player2 and no skip/vice).
  - Optional: add `league_member_roles` to support league managers (club-wide and per-league) that are not tied to a single team.
  - Add indexes on league_id, division_id, team_id, member_id, and unique constraints for common lookups.
  - Migration considerations: create a default division for existing leagues; use additive tables only to preserve existing sparing workflows.
- Application tier
  - CRUD endpoints for sheets, divisions, teams, and team rosters.
  - Validation rules for roster constraints (skip and vice are different for teams, required positions per format, doubles use player1/player2 and no skip/vice).
  - Autocomplete or search endpoint for members when building rosters.
  - Derive default team names when omitted.
- Frontend
  - Admin pages/tabs for managing sheets, divisions, teams, and rosters.
  - Roster editor with member autocomplete.
  - Basic league detail view for admins to verify teams and divisions.
- Manual validation
  - Create sheets, divisions, teams, and rosters; verify role rules and default team naming.

### Phase 2 - Games and manual scheduling
- Data tier
  - Add `games` with optional schedule fields (date, time, sheet_id), and status for scheduled vs unscheduled.
  - Add draw overrides for one-off draws and per-draw sheet availability (e.g. `league_extra_draws`, `draw_sheet_availability` keyed by league_id + date + time).
  - Add `spare_requests.game_id` (nullable) to link league game spares to a scheduled game.
  - Indexes for schedule queries (league_id + date/time, sheet_id + date/time, team_id).
- Application tier
  - CRUD endpoints for games (create, update, unschedule, delete).
  - Slot validation (no sheet conflicts, no duplicate team matchups in the same slot, league format alignment).
  - Endpoints to compute draw slots from league rules plus overrides to assist scheduling UI.
  - Upcoming games for a member based on team membership.
- Frontend
  - Admin scheduling view (list/calendar) with game editor (teams, sheet, date/time, unscheduled).
  - UI for one-off draws and sheet availability overrides.
  - Read-only league schedule view (admin and/or participants).
- Manual validation
  - Create games, adjust scheduling, ensure conflicts are caught, and verify schedule views.

### Phase 3 - Results, rankings, and stats foundation
- Data tier
  - Add `game_results` (game_id, team_id, result_order, value) to store the list of tiebreaker values.
  - Add `league_settings` (head_to_head_first, result_labels, and other ranking config).
  - Add `game_lineups` to capture who actually played (member_id, role, is_spare, sparing_for_member_id).
  - Indexes for standings and stats queries.
- Application tier
  - Endpoints to record and update results and lineups.
  - Standings calculation with tie handling and optional head-to-head first.
  - Stats endpoints for teams and members (games played, wins, losses, ties) based on game_lineups.
- Frontend
  - Results entry UI per game, standings table, and team detail views.
  - Display lineups with spare substitutions.
- Manual validation
  - Enter results and confirm standings and stats calculations.

### Phase 4 - Automatic scheduling and bye preferences
- Data tier
  - Add `round_robin_strategies` (league_id, priority, intra/cross division, games_per_team, division scope).
  - Add `team_bye_requests` (team_id, date/time, priority, optional note).
  - Add schedule generation tracking (e.g. `schedule_generation_runs` and games flagged as draft).
- Application tier
  - Endpoints to manage strategies and bye requests.
  - Scheduling service that produces a preview, honors priority rules, balances sheets and Team 1/Team 2, and handles partial schedules.
  - Endpoint to commit a preview into scheduled games or leave unscheduled games as requested.
- Frontend
  - Strategy configuration UI, bye request UI for teams, and schedule preview/approve flow.
  - Warnings for partial or skipped generation.
- Manual validation
  - Configure strategies, generate a preview, verify fairness constraints, and commit schedule.

### Phase 5 - Notifications, dashboard experience, kiosk API
- Data tier
  - Add `notification_preferences` (member_id, category, channel, enabled).
  - Add `league_notification_settings` (reminder offset hours, etc).
  - Optional kiosk access tokens if the endpoint should be restricted.
- Application tier
  - Scheduled job to send game reminder emails 24 hours prior with full roster and spare link.
  - Notification preferences endpoints and updated unsubscribe handling.
  - Kiosk endpoint for the next 3 games per sheet, including spare substitutions.
  - Dashboard data endpoint for "my leagues" and upcoming games.
- Frontend
  - Dashboard tabs (Leagues and Sparing) with upcoming games and quick spare request.
  - Notification preferences page.
  - Leagues page open to all users with schedule, teams, and standings (respect visibility).
- Manual validation
  - Test notification preferences and reminder generation (test mode) and verify kiosk output.

## Questions
- Are sheets global for the club or scoped per league? Global for the club.
- Do we need league-specific admin roles (distinct from server admins) for managing teams, schedules, and results? Yes. We will have both a club-wide master league manager role and a per-league league manager role.
- Can a member belong to multiple teams in the same league? Can they be on teams in multiple leagues at once? No. Yes.
- Should team rosters be fixed for the season, or can they change mid-season? If they change, do we need to snapshot historical lineups for past games? Rosters can change. Once results are recorded, `game_lineups` are the historical source of truth.
- For teams format, do you want skip and vice to be explicit positions or just flags on rostered players? For doubles, do we need skip/vice at all? Skip and vice are flags for rostered players on teams. Doubles use a stable Player 1 / Player 2 order and do not have skip or vice.
- When a spare plays, should we always capture the replaced player (sparing_for_member_id) even if the rostered player is unknown? Yes, but we should always know the rostered player that is absent. We will update the spare request UI to allow the spare requester to select from a dropdown of players.
- Should spare participants always be members in the system, or do we need to support external names? They will always be members.
- For bye requests, do teams request by specific date/time, by draw number, or by relative priority (e.g. "avoid early draw")? Teams will either provide specific date/time bye requests and/or relative priority.
- Should automatic scheduling consider member availability in addition to team bye requests? No.
- How should head-to-head tiebreakers work when 3 or more teams are tied? If Team A beat Team B, and Team B beat Team C, and Team C beat Team A, and are otherwise tied via points, then H2H cannot be used. However, if Team A beat bother Team B and Team C, and they all have the same points, Team A should be ranked ahead of Team B, and the winner of the B/C game should be ranked below A but above the other.
- Do you want to define per-league result labels and enforce a fixed result length for all games? No.
- Are ties allowed, and if so, how should they be represented given the "non-negative integers" constraint? League managers can decide this. A zero is a non-negative integer, and would typically be used for a loss. A tie might be a 1 for each team, and a win might be 2.
- Should the scheduler hard-block conflicts (same sheet/time or same team/time), or allow manual override? Hard block, and sheet conflicts are global across all leagues.
- For draw overrides, is it acceptable to store one-off draws and sheet availability keyed by date/time even if draws are not first-class entities? There may be one-off games that are scheduled outside of the defined draw times of the league. The system should track sheet availability globally - across all games for all leagues - using a real calendar. Otherwise, I don't really understand this question.
- Should the kiosk endpoint be public or authenticated? Should it include league name and game status (scheduled/cancelled)? Public is fine. Including league name and game status is fine.
- For league visibility to non-members, should rosters hide contact info using existing email/phone visibility flags? We will always respect the contact visibility preferences of each member.
- Who receives league reminder emails: all rostered players, only skips? All rostered players should receive reminder emails.
- Should spare requests for league games link directly to a game (game_id) and appear in the league schedule view? Yes.
- Are there any hard constraints on backward compatibility beyond "no breaking changes if avoidable"? No.

## Principles
1. This is just the beginning of a very large and complex web application that will be used to manage many aspects of a curling club. Do not take shortcuts. Consider opportunities for future expansion. Many of the artifacts we produce may end up in other areas of the (future) application.
2. Code quality is very important. Do not cut corners on code quality. Write only high-quality comments that will be useful to a human reviewer. Do not use `any` or type assertions unless absolutely necessary.
3. While you should generally avoid importing new libraries, it is acceptable as long as it is an extremely well-known library, well-maintained, current, and it solves a problem that we face across multiple areas of the application.
4. Do not ignore performance. Our eventual application may support up to 10,000 users.