# companion-module-kc-singularlive — Roadmap & Feature List

Planned features for KartChaser's custom Singular.Live control module, grouped by
area with a target version for each.

**Status legend:** ✅ shipped &nbsp;·&nbsp; 🚧 in progress &nbsp;·&nbsp; 📋 planned

**Versioning:** Semver, pre-1.0. Each minor version below is themed around one
capability area. `1.0.0` is the first hardened, documented release.

---

## Release overview

| Version | Theme | Headline features |
|---------|-------|-------------------|
| **0.1.0** | ✅ Multi-app foundation | Multi-token support, all core actions |
| **0.2.0** | 📋 Payload & selection power | Batch payload update, Cycle selection |
| **0.3.0** | 📋 State sync | Polling loop, Variables, core Feedbacks |
| **0.4.0** | 📋 Timing | Timed auto-take-out + feedback |
| **0.5.0** | 📋 Show control | Composition groups, Snapshots |
| **0.6.0** | 📋 History & persistence | Undo, state persistence across restarts |
| **1.0.0** | 📋 Hardening | Error handling, presets, docs, cleanup |

---

## Payload

| Feature | Version | Status | Notes |
|---------|---------|--------|-------|
| Update Payload Node (single) | 0.1.0 | ✅ | Currently "Update Control Node" |
| Batch Update Payload Nodes | 0.2.0 | 📋 | Multiple node/value pairs → one PATCH call (JSON object) |

## Selection Control Nodes

| Feature | Version | Status | Notes |
|---------|---------|--------|-------|
| Update Selection Node (direct set) | 0.1.0 | ✅ | `updateSelectionNode` |
| Update Color Node | 0.1.0 | ✅ | `updateColorNode` |
| Cycle Selection Node (next/prev, wraps) | 0.2.0 | 📋 | Rotate through ordered list; index tracked in-memory, persisted in 0.6.0. No if/else — modular arithmetic on the ordered choices |

## Timing

| Feature | Version | Status | Notes |
|---------|---------|--------|-------|
| Take In w/ Timed Auto-Take-Out | 0.4.0 | 📋 | Take In, then auto Take Out after N seconds; re-trigger cancels & restarts the timer |

## Show Control

| Feature | Version | Status | Notes |
|---------|---------|--------|-------|
| Trigger Composition Group | 0.5.0 | 📋 | Named set of comps, fired concurrently (in or out) |
| Save Snapshot | 0.5.0 | 📋 | Capture current comp/selection state |
| Recall Snapshot | 0.5.0 | 📋 | Restore snapshot, optional re-fire to Singular |
| Undo Last Action | 0.6.0 | 📋 | Reverse last take / selection change; 10-deep history. Depends on state persistence |

## Feedbacks

_Depends on the polling loop (0.3.0)._

| Feature | Version | Status | Notes |
|---------|---------|--------|-------|
| Composition: Is In | 0.3.0 | 📋 | Button reflects on-air state |
| Selection Node: Is Active Value | 0.3.0 | 📋 | Button lit when selection == chosen value |
| Composition: Timed Take-Out Active | 0.4.0 | 📋 | Ships with the timed auto-take-out feature |

## Variables

_Depends on the polling loop (0.3.0)._

| Feature | Version | Status | Notes |
|---------|---------|--------|-------|
| `comp_{app}_{id}_state` — in / out | 0.3.0 | 📋 | Per-composition on-air state |
| `sel_{app}_{nodeId}` — current selection value | 0.3.0 | 📋 | Live selection value |
| `last_action` — human-readable last action | 0.3.0 | 📋 | Feeds the Undo history in 0.6.0 |

## Infrastructure

| Feature | Version | Status | Notes |
|---------|---------|--------|-------|
| Multi-app token support | 0.1.0 | ✅ | Label:token config, Control App dropdown on every action |
| Polling loop (Singular → Companion sync) | 0.3.0 | 📋 | Configurable interval; enabler for all feedbacks & variables |
| State persistence across restarts | 0.6.0 | 📋 | Cycle indices, comp states, snapshots, groups survive restart |
| Control-call error handling | 1.0.0 | 📋 | `api.js` PATCH/POST currently fire-and-forget — await responses, surface failures |
| Presets | 1.0.0 | 📋 | Drag-and-drop buttons for common actions |
| Remove dead `handleError`/`handleConnectionError` | 1.0.0 | 📋 | Orphaned since the legacy `action()` wrapper was removed |

---

## Dependency notes

- **Polling loop (0.3.0)** is the backbone for every feedback and variable. Build it first in that release.
- **Cycle Selection (0.2.0)** works in-memory initially; its index becomes durable when **state persistence (0.6.0)** lands.
- **Undo (0.6.0)**, **Snapshots (0.5.0)**, and **Groups (0.5.0)** all read/write module state, so they benefit from persistence — Snapshots/Groups ship first in-memory, Undo + persistence close it out.
- **Timed auto-take-out (0.4.0)** and its **feedback** ship together — the feedback has no meaning without the timer.
