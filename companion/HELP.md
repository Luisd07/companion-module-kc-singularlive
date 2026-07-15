## Singular.Live

KartChaser's custom control for Singular.Live Studio. Control one or more
Singular.Live Control Apps from Companion — takes, control-node updates,
selection cycling, timers, snapshots and more, with on-air feedback.

[Singular.Live Website](https://www.singular.live/)

### Configuration

- **Number of Control Apps** — how many Singular Control Apps this connection
  drives (1–8). Each gets its own name + token.
- **App N Name** — a friendly label shown in the "Control App" dropdown on every
  action and feedback.
- **App N API URL / Token** — generated in the Control app's **Manage Access**
  window. Either form works:
  - URL: `https://app.singular.live/apiv2/control/172pQ2N1HLagEeayAci0Z4`
  - Token: `172pQ2N1HLagEeayAci0Z4`
- **Polling interval** — how often the module reads composition on-air state
  from Singular (0 = off). Companion-driven takes update instantly regardless;
  polling only catches takes made outside Companion. 1–2s feels live.
- **Activity log CSV file** — optional absolute path; every action fired is
  appended as a timestamped CSV row for post-show review.

### What it does

- **Takes** — Take In / Out, Toggle, Timed auto-take-out, Composition Groups,
  Take Out All (per app or all apps).
- **Control nodes** — update text/number/checkbox/color/selection nodes, cycle
  selections (great on an encoder), adjust numbers by a step or to an absolute
  value, activate buttons (single or in a group).
- **Show control** — save/recall/import/export named snapshots, rundown stepping,
  10-deep undo.
- **Feedbacks** — composition on-air, timed take-out active, selection value /
  set / cycle position, number threshold, any-composition-live, per-app
  connection + sync-stale, undo available.
- **Resilience** — each app connects independently; a dropped app auto-reconnects
  with backoff without disturbing the others, and can be reconnected manually.

Most control-node values in a typical show are driven by Singular data streams
and composition JavaScript, so selection/number feedbacks reflect what Companion
last set, not necessarily live Singular state.
