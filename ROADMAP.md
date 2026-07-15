# companion-module-kc-singularlive — Roadmap & Feature List

Planned features for KartChaser's custom Singular.Live control module, grouped by
area with a target version for each.

**Status legend:** ✅ shipped &nbsp;·&nbsp; 🚧 in progress &nbsp;·&nbsp; 📋 planned &nbsp;·&nbsp; ❌ shelved

**Versioning:** Semver, pre-1.0. Each minor version below is themed around one
capability area. `1.0.0` is the first hardened, documented release.

---

## Release overview

| Version    | Theme                           | Headline features                                                           |
| ---------- | ------------------------------- | --------------------------------------------------------------------------- |
| **0.1.0**  | ✅ Multi-app foundation         | Multi-token support, all core actions                                       |
| **0.2.0**  | ✅ Payload & selection power    | Batch payload update, Cycle selection                                       |
| **0.3.0**  | ✅ State sync                   | Polling loop, Variables, core Feedbacks                                     |
| **0.4.0**  | ✅ Timing                       | Timed auto-take-out + feedback                                              |
| **0.5.0**  | ✅ Show control                 | Composition groups, Snapshots                                               |
| **0.6.0**  | ✅ History & persistence        | Undo, state persistence across restarts                                     |
| **0.7.0**  | ✅ Operator convenience         | Toggle take, button group, number ±step                                     |
| **0.7.1**  | ✅ Edge hardening               | Fetch timeout + no unhandled rejections, safe isVisible, fail-aware records |
| **0.8.0**  | ✅ Timing & variable set        | Countdown set+start, variables in selection/number set                      |
| **0.9.0**  | ✅ Post-show                    | Session activity log, CSV export                                            |
| **0.10.0** | ✅ Feedback & control expansion | More feedbacks, rundown, set/reset                                          |
| **1.0.0**  | ✅ Hardening                    | Resilience, presets, docs, cleanup                                          |

---

## Payload

| Feature                      | Version | Status | Notes                                                              |
| ---------------------------- | ------- | ------ | ------------------------------------------------------------------ |
| Update Payload Node (single) | 0.1.0   | ✅     | Currently "Update Control Node"                                    |
| Batch Update Payload Nodes   | 0.2.0   | ✅     | JSON object → one PATCH call. Kept as a niche manual-override tool |

> Note: in this show most control nodes are driven by Singular data streams + the
> composition's own JavaScript, so Companion's role is trigger-based (takes,
> buttons, cycles) rather than setting values. Batch update is deliberately kept
> JSON-only; the dropdown-rows expansion was dropped as not worth it here. The
> `/model` endpoint only returns default/reset values, not live values, so
> pre-filling current values isn't feasible from it.

## Selection Control Nodes

| Feature                                 | Version | Status | Notes                                                                                                                            |
| --------------------------------------- | ------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Update Selection Node (direct set)      | 0.1.0   | ✅     | `updateSelectionNode`                                                                                                            |
| Update Color Node                       | 0.1.0   | ✅     | `updateColorNode`                                                                                                                |
| Cycle Selection Node (next/prev, wraps) | 0.2.0   | ✅     | Rotate through ordered list; index tracked in-memory, persisted in 0.6.0. No if/else — modular arithmetic on the ordered choices |

## Timing

| Feature                        | Version | Status | Notes                                                                                |
| ------------------------------ | ------- | ------ | ------------------------------------------------------------------------------------ |
| Take In w/ Timed Auto-Take-Out | 0.4.0   | ✅     | Take In, then auto Take Out after N seconds; re-trigger cancels & restarts the timer |
| Countdown Set + Start          | 0.8.0   | ✅     | One action sets minutes/seconds and starts the Timer Control (e.g. 5:00 to green)    |

## Show Control

| Feature                   | Version | Status | Notes                                                                             |
| ------------------------- | ------- | ------ | --------------------------------------------------------------------------------- |
| Trigger Composition Group | 0.5.0   | ✅     | Inline multi-select of comps, fired together in one PATCH (in or out)             |
| Save Snapshot             | 0.5.0   | ✅     | Capture comp on-air states + Companion-set selection values (named, in-memory)    |
| Recall Snapshot           | 0.5.0   | ✅     | Restore comp states + optionally selection values, re-fired to Singular           |
| Undo Last Action          | 0.6.0   | ✅     | Reverses last take / timed / group / selection / cycle; 10-deep in-memory history |
| Rundown / sequential step | 0.10.0  | ✅     | "Next" takes out the current graphic and takes in the next from an ordered list   |
| Take Out All — all apps   | 0.10.0  | ✅     | Panic button across every connected app, not just one                             |
| Snapshot import / export  | 0.10.0  | ✅     | Share saved looks between shows/machines (pairs with persistence)                 |

## Operator convenience

| Feature                           | Version | Status | Notes                                                                  |
| --------------------------------- | ------- | ------ | ---------------------------------------------------------------------- |
| Toggle Take In/Out                | 0.7.0   | ✅     | One action toggles a comp using tracked on-air state; undoable         |
| Trigger Button Group              | 0.7.0   | ✅     | Fire several button nodes in one PATCH (e.g. data-refresh buttons)     |
| Adjust Number Node (±)            | 0.7.0   | ✅     | Bump a number node by a step, clamped to the node's min/max; undoable  |
| Set Number Node (absolute)        | 0.10.0  | ✅     | Set a number node to an exact value (variable-aware), clamped          |
| Reset Selection to default        | 0.10.0  | ✅     | One-press return a selection node to its default/first value           |
| Variables in selection/number set | 0.8.0   | ✅     | Target a selection/number value from a Companion variable at fire time |

## Feedbacks

_Depends on the polling loop (0.3.0)._

| Feature                            | Version | Status | Notes                                                                           |
| ---------------------------------- | ------- | ------ | ------------------------------------------------------------------------------- |
| Composition: Is In                 | 0.3.0   | ✅     | Button reflects on-air state (from polling)                                     |
| Selection Node: Is Active Value    | 0.3.0   | ✅     | Lit when Companion's last-set value == chosen (not authoritative vs streams/JS) |
| Composition: Timed Take-Out Active | 0.4.0   | ✅     | Ships with the timed auto-take-out feature                                      |
| App Connected                      | 1.0.0   | ✅     | Lit/red per app based on connection health (ships with resilience)              |
| Number Node Threshold              | 0.10.0  | ✅     | Color when a number node crosses a value (≥ / ≤ / = e.g. Score ≥ target)        |
| Any Composition Live (per app)     | 0.10.0  | ✅     | Master on-air indicator — lit if any composition in the app is In               |
| Selection Is One Of                | 0.10.0  | ✅     | Lit when current selection is any of several chosen values                      |
| Cycle Position Is                  | 0.10.0  | ✅     | Lit when a cycled node is at a given index (show which step is active)          |
| Undo Available                     | 0.10.0  | ✅     | Lit when the undo stack is non-empty                                            |
| Poll / sync stale                  | 1.0.0   | ✅     | Lit when last successful poll is older than N seconds (heartbeat)               |

## Variables

_Depends on the polling loop (0.3.0)._

| Feature                                        | Version | Status | Notes                                            |
| ---------------------------------------------- | ------- | ------ | ------------------------------------------------ |
| `comp_{app}_{id}_state` — in / out             | 0.3.0   | ✅     | Per-composition on-air state (from polling)      |
| `sel_{app}_{nodeId}` — current selection value | 0.3.0   | ✅     | Value Companion last set (not authoritative)     |
| `sel_{app}_{nodeId}_label` — selection label   | 0.3.0   | ✅     | Friendly name of the last-set selection          |
| `num_{app}_{nodeId}` — number value (last set) | 0.7.0   | ✅     | Tracks Adjust Number Node                        |
| `last_action` / `undo_last`                    | 0.3.0   | ✅     | Human-readable last action / next undo           |
| `app_{n}_connected` / `app_{n}_last_sync`      | 1.0.0   | ✅     | Per-app health + heartbeat (ships w/ resilience) |

## Infrastructure

| Feature                                           | Version | Status | Notes                                                                                                                                                          |
| ------------------------------------------------- | ------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-app token support                           | 0.1.0   | ✅     | Label:token config, Control App dropdown on every action                                                                                                       |
| Polling loop (Singular → Companion sync)          | 0.3.0   | ✅     | Configurable interval (0 = off); polls /model for composition states                                                                                           |
| State persistence across restarts                 | 0.6.0   | ✅     | Cycle indices, selection values, snapshots survive restart (saveConfig blob)                                                                                   |
| Multi-app resilience (per-app reconnect)          | 1.0.0   | ✅     | Split connect from definitions; auto-reconnect a dropped app with backoff, no disruption to healthy apps. Failed app keeps its choices so actions don't vanish |
| Per-app connection status + manual reconnect      | 1.0.0   | ✅     | `app_{n}_connected` variable + feedback, aggregate status, "Reconnect Control App" action                                                                      |
| Control-call error handling                       | 0.7.1   | ✅     | Central request layer: abort timeout, no unhandled rejections, `res.ok` results; core actions skip recording state on failure; partial-connect shows a warning |
| Safe `isVisible` generation                       | 0.7.1   | ✅     | All generated visibility fns JSON-encode ids/names so quotes/apostrophes can't break them                                                                      |
| Prune stale persisted entries                     | 1.0.0   | ✅     | Drop persisted selection/number/cycle/snapshot entries for nodes removed in Singular                                                                           |
| Presets                                           | 1.0.0   | ✅     | Ready-made buttons: encoder cycler/adjust, on-air tallies, take groups. Candidate to pull earlier                                                              |
| Remove dead `handleError`/`handleConnectionError` | 1.0.0   | ✅     | Orphaned since the legacy `action()` wrapper was removed                                                                                                       |

## Integration

> The module is self-contained and driven entirely through Companion — there is
> no external tool (kc-ops or otherwise) that talks to it. The incoming HTTP
> trigger is therefore shelved unless a concrete external consumer appears.

| Feature                            | Version   | Status | Notes                                                                                         |
| ---------------------------------- | --------- | ------ | --------------------------------------------------------------------------------------------- |
| Variable interpolation in payloads | 0.1–0.2.0 | ✅     | Payload values resolve Companion variables at fire time (`updateControlNode` + batch payload) |
| Variables in selection/number set  | 0.8.0     | ✅     | Let selection/number actions target a value from a variable (only payload actions do today)   |
| Incoming HTTP trigger              | —         | ❌     | Shelved — no external consumer. Companion's own HTTP API can press buttons if ever needed     |

## Post-show

| Feature                    | Version | Status | Notes                                                                                                                                                                   |
| -------------------------- | ------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session activity log (CSV) | 0.9.0   | ✅     | Timestamped ring buffer of every fired action, exportable as CSV. Open decision: file path vs HTTP download vs both. Useful for post-show review / sponsor verification |

---

## Dependency notes

- **Polling loop (0.3.0)** is the backbone for every feedback and variable. Build it first in that release.
- **Cycle Selection (0.2.0)** works in-memory initially; its index becomes durable when **state persistence (0.6.0)** lands.
- **Undo (0.6.0)**, **Snapshots (0.5.0)**, and **Groups (0.5.0)** all read/write module state, so they benefit from persistence — Snapshots/Groups ship first in-memory, Undo + persistence close it out.
- **Timed auto-take-out (0.4.0)** and its **feedback** ship together — the feedback has no meaning without the timer.
