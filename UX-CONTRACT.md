# UX contract — ArtiSys PDV

## Canonical behavior

The local server and `js/core/modules/module-registry.js` own the optional-module definitions: stable ID, customer-facing name, description, family/area, dependency list, route ID, icon, allowed roles, management roles, and default activation. `js/core/modules/module-service.js` owns persisted activation and server-side authorization. Renderer code consumes the returned catalog; it must not maintain parallel module labels, family membership, icons, or permission lists.

`desktop/renderer/restaurant-module-gate.js` is the sole renderer-side cache of the last authoritative module catalog. It publishes `artisys:modules-state-changed` with `{catalog, modules, changedIds}`. A failed refresh preserves the last known catalog and displays/handles request errors at the affected operation; it does not synthesize a module state. `desktop/renderer/vertical-modules.js` derives settings, grouped navigation, role visibility, and route selection from that catalog. `desktop/renderer/module-state-sync.js` uses stable route IDs, never translated headings.

## Module lifecycle

1. Administrator activates or deactivates a catalog entry in Settings.
2. The server validates role, dependencies, and persistence; the UI reports success only after the server accepts the change.
3. The returned catalog updates the renderer cache and triggers one state-change event.
4. Navigation and module settings are regenerated from the same catalog. Disabled modules are absent from navigation and cannot be opened by a stale link.
5. A user sees only entries permitted by their role. A user who cannot manage modules can still see the permitted operational destinations but cannot change activation.
6. Disabling a module does not delete its operational history. Shared core services remain available to other authorized workflows.

An area whose navigation mode is `group` has exactly one sidebar destination; its enabled modules are presented inside that area. Standalone areas route to their own catalog entry. Do not persist compatibility aliases or map old labels to routes.

## Loading, failure, and feedback

- Every module API request that can delay navigation/settings has a bounded timeout and visible retry action.
- Refreshes are single-flight; no repeated network fetch is triggered merely by sidebar rendering or DOM mutations.
- A timeout affects only the requested module panel and never blocks Home, the sidebar, cash register, or other routes.
- On save failure, restore the switch to its authoritative value and explain the failure. Never show a successful state before the server confirms it.
- On refresh failure, retain the last known authoritative catalog; identify that state as stale when the UI has a suitable status surface. Do not silently fall back to local defaults.
- After disabling the currently open capability, route to its still-enabled parent area when possible; otherwise return to Home.

## Access and data safety

- `manageRoles` in the catalog defines module-management roles; the server independently enforces the same declaration for activation. The internal `system` actor remains permitted for setup/automation.
- Catalog `accessRoles` govern renderer navigation, but are not a replacement for server-side permission checks on API operations.
- A hidden sidebar entry is not an authorization boundary. Keep route-level and API-level gates.
- Never remove module data or historical records as a side effect of hiding/deactivating navigation.

## Product invariants

- Brazilian Portuguese is the user-facing language; internal IDs/enums must not leak into the normal workflow.
- Operational sales, inventory, cash, and audit remain shared core capabilities.
- Cloud telemetry remains independent of module activation and local operation.
- Home and other specifically approved screens are protected from incidental redesign.
- User-facing error states state what failed, what remains usable, and the next safe action.

