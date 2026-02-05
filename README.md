# request-context

A minimal, production-oriented request context helper for Node.js using `AsyncLocalStorage`.

## Problem Statement

In Node.js backends, request-scoped data like `requestId`, `userId`, and `correlationId` is frequently lost across async boundaries. You might log in one function and handle the request in another, but without a shared context the data is gone. This makes logging, tracing, and debugging far harder than it should be. `request-context` provides a tiny, typed context that stays attached to the async chain so your logs and handlers stay correlated.

## Quick Start

Install:

```bash
npm i request-context-node
```

```ts
import { createContext } from "request-context";

type Ctx = { requestId: string; userId?: string };
const ctx = createContext<Ctx>();

await ctx.run({ requestId: "req-123" }, async () => {
  ctx.set("userId", "user-42");
  console.log(ctx.get("requestId"));
});
```

## Express Example

```ts
import express from "express";
import { createContext, expressMiddleware } from "request-context";

type Ctx = { requestId: string; userId?: string };
const ctx = createContext<Ctx>();

const app = express();
app.use(
  expressMiddleware(ctx, {
    headerName: "x-request-id",
    getUserId: (req) => req.user?.id
  })
);

app.get("/", (req, res) => {
  res.json({ requestId: ctx.mustGet("requestId") });
});
```

## `with()` Example

```ts
await ctx.run({ requestId: "req-123" }, async () => {
  await ctx.with({ userId: "user-42" }, async () => {
    // requestId + userId available here
  });
  // userId is not set here
});
```

## `bind()` Example

```ts
const bound = ctx.run({ requestId: "req-123" }, () => {
  return ctx.bind(async () => {
    return ctx.get("requestId");
  });
});

await bound(); // "req-123"
```

## Strict vs Non-Strict Mode

By default (`strict: false`), `get` returns `undefined` and `set` is a no-op when there is no active context. This is safer for libraries and background jobs where a context might legitimately be missing. If you want to enforce correct usage, enable strict mode to throw on missing context.

```ts
const ctx = createContext<Ctx>({ strict: true });
```

## Limitations

- `AsyncLocalStorage` can lose context in some edge cases (for example, if an async boundary is not tracked by Node's async hooks).
- This is not distributed tracing. It only tracks context in-process.
- Cross-process or cross-service propagation is out of scope.

## Why not OpenTelemetry?

OpenTelemetry is a full observability framework that includes tracing, metrics, and exporters. This package is intentionally smaller: it only provides a lightweight request context for app-level metadata. If you need end-to-end tracing or vendor integrations, OpenTelemetry is the right tool.
