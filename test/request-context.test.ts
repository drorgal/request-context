import { describe, expect, it, vi } from "vitest";
import { createContext, expressMiddleware } from "../src/index";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("request-context", () => {
  it("preserves context across async/await", async () => {
    const ctx = createContext<{ requestId: string }>();

    await ctx.run({ requestId: "a" }, async () => {
      await delay(5);
      expect(ctx.get("requestId")).toBe("a");
    });
  });

  it("nested run overrides correctly", async () => {
    const ctx = createContext<{ requestId: string }>();

    await ctx.run({ requestId: "outer" }, async () => {
      expect(ctx.get("requestId")).toBe("outer");
      await ctx.run({ requestId: "inner" }, async () => {
        expect(ctx.get("requestId")).toBe("inner");
      });
      expect(ctx.get("requestId")).toBe("outer");
    });
  });

  it("parallel runs do not leak", async () => {
    const ctx = createContext<{ requestId: string }>();

    const a = ctx.run({ requestId: "a" }, async () => {
      await delay(10);
      expect(ctx.get("requestId")).toBe("a");
    });

    const b = ctx.run({ requestId: "b" }, async () => {
      await delay(5);
      expect(ctx.get("requestId")).toBe("b");
    });

    await Promise.all([a, b]);
  });

  it("setTimeout inside run preserves context", async () => {
    const ctx = createContext<{ requestId: string }>();

    await ctx.run({ requestId: "timer" }, async () => {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(ctx.get("requestId")).toBe("timer");
          resolve();
        }, 5);
      });
    });
  });

  it("bind captures context and restores later", async () => {
    const ctx = createContext<{ requestId: string }>();

    const bound = ctx.run({ requestId: "captured" }, () => {
      return ctx.bind(async () => {
        await delay(5);
        return ctx.get("requestId");
      });
    });

    await ctx.run({ requestId: "other" }, async () => {
      expect(ctx.get("requestId")).toBe("other");
    });

    await expect(bound()).resolves.toBe("captured");
  });

  it("express middleware sets a unique requestId per request", () => {
    type Ctx = { requestId: string; userId?: string };
    const ctx = createContext<Ctx>();

    let counter = 0;
    const middleware = expressMiddleware(ctx, {
      generateRequestId: () => `id-${++counter}`
    });

    const res = {};

    const next1 = vi.fn(() => {
      expect(ctx.get("requestId")).toBe("id-1");
    });
    middleware({ headers: {} }, res, next1);
    expect(next1).toHaveBeenCalledTimes(1);

    const next2 = vi.fn(() => {
      expect(ctx.get("requestId")).toBe("id-2");
    });
    middleware({ headers: {} }, res, next2);
    expect(next2).toHaveBeenCalledTimes(1);

    const next3 = vi.fn(() => {
      expect(ctx.get("requestId")).toBe("from-header");
    });
    middleware({ headers: { "x-request-id": "from-header" } }, res, next3);
    expect(next3).toHaveBeenCalledTimes(1);
  });
});
