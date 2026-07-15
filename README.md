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
- **Activity log** — optional timestamped CSV of every action fired, for
  post-show review.

## Configuration

1. In the Singular Control app, open **Manage Access** and generate a URL/token.
2. In Companion, add this connection and set the **Number of Control Apps**, then
   each app's **Name** and **API URL / Token**.
3. Optionally set the **Polling interval** (on-air state refresh) and an
   **Activity log CSV file** path.

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
