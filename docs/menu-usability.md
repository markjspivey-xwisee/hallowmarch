# Game menu usability

The October 2026 menu pass addresses the owner's reports of duplicate entry
buttons, unclear next steps and competing actions. It retains the game's visual
language and character/account safeguards. These are task-based agent checks
and a browser walkthrough, not a human player study or an AAA certification.

## Action contract

| Player task | Main action | Required behavior |
| --- | --- | --- |
| Start a new character | Play now / Enter the realm | Realm, calling and name remain editable only when creation is available. |
| Return to a saved character | Continue as name | One visible entry button resumes the exact saved character. |
| Recover an existing character | The appropriate reconnect or recovery action | Blocked entry never looks like a fresh-character choice; existing drafts, keys and expiry remain intact. |
| Find the next objective | Continue your path | Practice milestones are labelled separately from guided objectives. |
| Inspect activity | Activity history | Reading never enables recording, grants access, repairs delegation or sends a coaching request. |
| Leave a game menu | Back to game | One quiet pinned return control; content owns its task action. |
| Change settings | Choose a labelled radio option | Changes apply immediately; selection, keyboard focus and scroll position survive redraw. |
| Inspect equipment or the map | Inventory / Map | Focus enters the screen, stays inside during Tab navigation, then returns to the opener. |
| Read an NPC dialog | Talk / read, then choose an action | The heading receives focus; Escape closes without accepting a quest or reward. |
| Replace a character | Character options, then explicit replacement | Keep current character is the default; pending saves and changed player/save targets prevent replacement. |

The menu body is a focusable scroll region. Header and navigation remain fixed;
long Help and Chronicle pages must remain readable by keyboard and touch.
The six top-level tabs retain their labels, arrow navigation and Home/End.
New-character controls do not appear in unrelated Help, Settings or Progress
tasks. Optional identity, guidance and recording controls use explicit disclosure.

## Regression coverage

The browser suites execute real production functions and DOM controls with
synthetic records and blocked external services:

- `client/native-pod/identity-ui.browser.test.mjs`: first entry, returning entry,
  blocked reads, encrypted-key recovery, expired sessions, exact resume arguments
  and realm/calling keyboard selection.
- `tools/tests/progress_navigation.browser.test.mjs`: one path action, local
  navigation during coaching work, optional support and history return/focus.
- `tools/tests/kit_navigation.browser.test.mjs`: modal entry/return, exact-item
  focus through equipment/shop redraws and removal without adjacent-item retargeting.
- `tools/tests/menu_confirmation.browser.test.mjs`: safe replacement/cancel,
  pending-to-settled transitions, changed player/save refusal, dialog focus and
  keyboard containment.
- `tools/tests/players_navigation.browser.test.mjs` and
  `tools/tests/companion_navigation.browser.test.mjs` cover their connected,
  paused, disconnected and error actions without live messages or grants.

`tools/tests/menu_usability.py --strict --screenshots` loads the compiled game
with local assets and synthetic scenarios. It exercises desktop, narrow phone,
regular phone and phone landscape layouts. `HM_MENU_QA_OUT` sets the evidence
directory. The JSON report records the exact input HTML hash, tasks, focus,
visible actions, overflow and blocked requests.

The optional `--serve --port 8766` mode provides visible offline scenario controls
for a manual browser walkthrough. Every unsupported request is refused and a
content security policy blocks external connections. Never substitute production
cookies, account grants, character keys or private records into these fixtures.

The normal CI build/lint, resource projections, identity, phone, shared-world,
graphics, networking, performance and long-war checks still apply. Screenshots
and focused DOM checks complement these gates; they do not establish how an
unfamiliar human player will understand the game.
