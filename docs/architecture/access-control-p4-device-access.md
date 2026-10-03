# P4 — Device access model

P4 separates device authentication from surface, resource scope and optional human binding.

## Canonical device state

A device now persists:

- credential hash/salt — authentication only;
- `surface` — waiter, table, kitchen or self-service;
- optional `scope_type/scope_id` — for example a table-bound tablet;
- optional `user_id` — human binding for attribution, never permission inheritance;
- status and last-seen metadata.

`device_type` remains as a compatibility field for the current restaurant/mobile UI and is not a human role.

## Canonical principal

`runtime.deviceAccess.authenticate()` returns a P2 device principal:

```js
{ kind: 'device', id, surface, userId }
```

Device capability resolution is based on **surface**, not on the bound human profile. Binding a waiter device to an Administrator therefore does not give the device finance, settings or access-management permissions.

## Current compatibility

Existing mobile credentials, blocking and rotation remain unchanged. Restaurant and self-service routers authenticate through `deviceAccess` while retaining their current surface contracts. P5/P8 will continue replacing remaining legacy module/route authorization gates.
