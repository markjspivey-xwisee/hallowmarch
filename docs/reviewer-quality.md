# Reviewer playability contracts

This pass improves the experience from first entry through choosing an objective,
fighting, and returning to the game. It preserves earned characters, world history,
identity ownership checks, and learning consent.

## Player-facing behavior

- **Onboarding:** an explicit new-character Begin request keeps its prologue
  through slow startup. Continuing a recovered character does not replay it.
  Keyboard dismissal remains trusted player input.
- **Objectives:** Track objective selects an unfinished deed and updates its
  instructions and map guidance. Selection survives the normal character save;
  it grants no XP, reward, completion, or learning event. The activity dashboard
  retains the earliest unfinished canonical step independently of that selection.
- **Bounties:** offers describe living, suitable quarry rather than authored camp
  tiers. Existing accepted progress is retained. When no suitable quarry is
  available, the herald explains this and offers no fabricated acceptance action.
- **Combat:** pointer selection, target cycling, and selected nameplates respect
  walls and closed tower floors. Failed cast completion explains a lost target
  or insufficient power without changing the underlying combat rules.
- **Menus:** Continue resumes the saved character. Progress has one persistent
  menu destination; Chronicle → Your path contains objective tracking. Activity
  history remains distinct from guided objectives. Reading records never enables
  recording or grants access. See [the menu action contracts](menu-usability.md).
- **Effects and recovery:** Settings offers a browser-local reduced-effects
  preference that follows the device by default. Shake, screen flashes, and
  lightning flicker are suppressed while lightning mechanics remain intact.
  Failed dependency loading exposes a retry; a late successful download clears
  that notice and continues startup.

## Verification entrypoints

After building, run the focused Node regressions for `objective_guidance`,
`combat_targeting`, and `presentation_accessibility` under `tools/tests/`, plus
`startup_file_guard.browser.test.mjs`. Actual-game checks are
`tools/tests/objective_tracking.py`, `combat_targeting.py`, and
`menu_usability.py --strict`. The phone gate includes `mobile_hud.py` and
`mobile_hud_tap_regression.py`.

Touch automation waits for the observed click, the closed sheet, and released,
visible, hit-testable gameplay controls. The exact timing mechanism behind the
recurring phone CI transition remains unconfirmed; persistent failures must
retain bounded state diagnostics.

## Release limits

Native graphics startup on the tested Windows/NVIDIA path remains a release
blocker under diagnosis. A working reduced-graphics launch does not establish
that normal graphics are fixed. Fresh full CI and desktop/phone verification
must run on the final frozen build, with its exact hash and inspected screenshots.

These are engineering and agent playability checks. They are not a human player
study, independent reviewer approval, or AAA certification.
