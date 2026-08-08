# companion-module-kc-singularlive

KartChaser's custom [Bitfocus Companion](https://bitfocus.io/companion) module
for controlling [Singular.Live](https://www.singular.live/) during live karting
broadcasts. Forked from `companion-module-singularlive-studio`.

Control one or more Singular.Live Control Apps from Companion — takes,
control-node updates, selection cycling, timers, snapshots and more, with on-air
feedback and per-app resilience.

See [companion/HELP.md](./companion/HELP.md) for in-app configuration help.

## Features

- **Multi-app** — drive up to 8 Control Apps from one connection; every action
  has a "Control App" selector.
- **Takes** — Take In / Out, Toggle, Timed auto-take-out, Composition Groups,
  Take Out All (per app or all apps).
- **Control nodes** — update text / number / checkbox / color / selection nodes;
  cycle selections (great on an encoder); adjust numbers by a step or to an
  absolute value; activate buttons singly or in a group; batch payload update.
- **Show control** — save / recall / import / export named snapshots, rundown
  stepping, 10-deep undo.
- **Feedbacks** — composition on-air, timed take-out active, selection value /
  set / cycle position, number threshold, any-composition-live, per-app
  connection + sync-stale, undo available.
- **Variables** — per-composition state, per-node last-set value/label, per-app
  connection + last-sync, last action, undo, activity count.
- **Resilience** — each app connects independently; a dropped app auto-reconnects
  with backoff without disturbing the others, and can be reconnected manually.
- **API quota management** — Singular meters API calls per day. The module counts
  every call it makes, backs polling off automatically while the show is idle,
  warns as the budget runs down and pauses polling before it runs out. Takes are
  never blocked.
- **Activity log** — optional timestamped CSV of every action fired, for
  post-show review.

## Configuration

1. In the Singular Control app, open **Manage Access** and generate a URL/token.
2. In Companion, add this connection and set the **Number of Control Apps**, then
   each app's **Name** and **API URL / Token**.
3. Optionally set the **Polling interval** (on-air state refresh), the **Idle
   polling interval** and **Daily API call budget** (see below), and an
   **Activity log CSV file** path.

### Staying inside the API limit

Polling is almost all of the module's API consumption: one call per app per tick,
all day, whether or not anything is happening. Over a 10-hour day that is:

| Apps | @2s     | @3s    | @5s    | @10s   |
| ---- | ------- | ------ | ------ | ------ |
| 2    | 36,000  | 24,000 | 14,400 | 7,200  |
| 4    | 72,000  | 48,000 | 28,800 | 14,400 |
| 6    | 108,000 | 72,000 | 43,200 | 21,600 |
| 8    | 144,000 | 96,000 | 57,600 | 28,800 |

Two events at once is what blows a 100,000/day limit. The **Idle polling
interval** is the fix: after 10 polls with nothing changing the module drops to
the slower rate, and any take from Companion snaps it straight back. At 2s active
/ 15s idle, six apps come down from 108,000 to roughly 42,000 — with 2s
responsiveness intact whenever the show is actually moving.

Set the **Daily API call budget** to your account limit. The module warns at 80%
and pauses polling at 95%, leaving the rest for takes. If two Companion machines
share one Singular account they cannot see each other's usage — give each a share
of the account total rather than the whole limit.

## Development

```
corepack yarn install   # restore dependencies
corepack yarn lint      # lint
corepack yarn format    # prettier
corepack yarn package   # build the installable .tgz
```

Load the source as a Companion developer module (Settings → Developer modules
path) to test changes live.

## Changelog

### v1.2.0

- **API quota budget.** Every call the module makes is counted against a
  configurable **Daily API call budget**, persisted so a Companion restart does
  not reset the day's tally. It warns at 80% and pauses polling at 95% — takes
  and control changes are never blocked, only live feedback goes stale. The
  count resets at local midnight.
- **Idle polling backoff.** After 10 polls with nothing changing, polling drops
  to the configurable **Idle polling interval** (default 15s); any Companion take
  snaps it back to the fast rate immediately. This cuts a typical day's API
  consumption by roughly two thirds without giving up responsiveness while the
  show is live. Set the idle interval to 0 to disable.
- **Action** — "Polling On/Off", so an operator can stop polling entirely between
  sessions without editing config.
- **Feedbacks** — "API: Daily Budget Above Threshold" (at a percentage you
  choose) and "API: Polling Paused".
- **Variables** — `api_calls_today`, `api_calls_remaining`, `api_budget_pct`,
  `api_calls_per_hour`, `poll_interval_active`.
- **Failed control calls now log why.** Previously a rejected write logged only
  `(HTTP 400)`, which says nothing about the cause; the API's own response and
  the request body are now included in the warning.
- Changing the **Polling interval** no longer drops every connection and re-reads
  every app's model — it retimes the polling loop in place.

### v1.1.0

- **Live state from Singular.** Polling moved from `/model` to `/control`, which
  returns current control-node values rather than defaults — and is about half
  the payload. `/model` is now read only at connect, for structure.
- **Live value variables** — `live_{app}_{comp}_{node}` for every control node,
  usable directly in button text (e.g. the on-air driver name or fastest lap).
- **Feedbacks** — "Checkbox Node: Is Checked (live)" reads the checkbox straight
  from Singular, so no parallel custom variable can drift out of sync;
  "Control Node: Live Value Is" compares any node's live value (contains /
  equals / not-equals / empty).
- **Action** — "Update Control Node (by name, variable-aware)": composition and
  node id both accept variables, so one button can retarget at fire time.
- "Reset Selection to Default" is now just "Reset Selection", with a **Reset to**
  choice of first-entry or node-default. First entry is the default and is what
  existing buttons keep doing — a "clear this graphic" button usually wants
  "No Active Class" rather than whatever the composition defaults to.
- Composition states normalised — Singular reports `In` / `Out1` / `Out2`, which
  previously fought the optimistic state written after a Companion take.
- Fixes: number `min`/`max`/`defaultValue` are no longer dropped when reading the
  model, so clamping and "Reset Selection to Default" work as documented; the
  "Invalid token" log message fires again; a debounced state save no longer runs
  after the instance is destroyed; presets emit real line breaks.

### v1.0.0

- Per-app resilience: independent connect, auto-reconnect with backoff, manual
  reconnect, per-app connection status feedback + variables.
- Feedbacks: number threshold, any-composition-live, selection is-one-of / cycle
  position, undo available, app connected / sync stale.
- Actions: set number (absolute), set selection by value, reset selection,
  rundown step, take out all apps, import/export snapshots, countdown set+start.
- Session activity log with CSV export; presets; hardened request layer (timeout,
  no unhandled rejections, failure-aware state); persisted state pruning; docs.

### v0.7.0

- Toggle Take In/Out, Trigger Button Group, Adjust Number Node (±).

### v0.6.0

- Undo (10-deep) and state persistence across restarts.

### v0.5.0

- Composition Groups, Save/Recall Snapshots.

### v0.4.0

- Take In with timed auto-take-out and its feedback.

### v0.3.0

- Polling, variables, and on-air / selection feedbacks.

### v0.2.0

- Batch payload update, Cycle Selection, renamed Animate → Take.

### v0.1.0

- Multi-app support: control multiple Singular apps from one module instance.
