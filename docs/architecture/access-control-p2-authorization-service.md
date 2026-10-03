# P2 — Canonical Authorization Service

P2 introduces one fail-closed authorization engine without replacing the legacy gates yet.

## Canonical decision

```js
authorization.can({ principal, capability, surface, resource })
authorization.require({ principal, capability, surface, resource })
```

A decision combines:

1. a canonical principal;
2. a capability from the P1 registry;
3. an optional surface policy;
4. an optional resource-scope policy.

Unknown capabilities, malformed principals, resolver failures and policy failures deny access.

## Principal kinds

- `human`: a person authenticated locally;
- `device`: KDS, waiter, table tablet, self-service or terminal surface;
- `system`: explicit privileged internal/bootstrap principal;
- `public-resource`: opaque-token access scoped to a public resource such as a table.

The core service does not interpret `admin`, `manager`, `cashier` or device-type business rules.

## Legacy compatibility adapter

`legacy-authorization-adapter.js` translates the current actor model into canonical principals and provides temporary permission projections for the existing roles/device types.

This adapter is intentionally removable. P3 will replace human role resolution with persisted profiles and profile permissions.

## Security properties

- fail closed;
- `system` bypass works only for capabilities registered in P1;
- device permissions remain distinct from human permissions;
- public resource principals receive only explicit public capabilities;
- surface and resource policies can further restrict an already-granted capability;
- `require()` throws a stable HTTP-compatible 403 authorization error.

## Migration status

P2 exposes `runtime.authorization`, but existing route/module/UI gates remain unchanged. Their migration is staged in P4/P5/P7/P8 so P2 itself does not create an authorization behavior regression.
