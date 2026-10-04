# P4 — Device access model

P4 separates device authentication from surface, resource scope and optional human binding.

## Canonical device state

A device now persists:

- credential hash/salt — authentication only;
- `surface` — waiter, kitchen or self-service;
- `scope_type/scope_id` — currently `establishment` for paired mobile devices;
- optional `user_id` — human binding for attribution, never permission inheritance;
- status and last-seen metadata.

`device_type` is the canonical paired-device channel: `WAITER`, `KITCHEN` or `SELF_SERVICE`. A fixed-table customer device is not a separate device surface: it is `SELF_SERVICE` with a `TABLE` profile in `self_service_profiles`. Pickup uses the same device type with a `PICKUP` profile.

## Canonical principal

`runtime.deviceAccess.authenticate()` returns a P2 device principal:

```js
{ kind: 'device', id, surface, userId }
```

Device capability resolution is based on **surface**, not on the bound human profile. Binding a waiter device to an Administrator therefore does not give the device finance, settings or access-management permissions.

## Current compatibility

Mobile credentials, blocking and rotation remain unchanged. Restaurant and self-service routers authenticate through `deviceAccess`; table binding for self-service is resolved by the self-service profile rather than device resource scope. P5/P8 will continue replacing remaining legacy module/route authorization gates.
