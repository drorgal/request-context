import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

type AnyRecord = Record<string, unknown>;

type ContextSnapshot<T extends AnyRecord> = Partial<T>;

type Store<T extends AnyRecord> = ContextSnapshot<T>;

export type ExpressRequestHandler = (
  req: any,
  res: any,
  next: (err?: unknown) => void
) => void;

export type CreateContextOptions<T extends AnyRecord> = {
  strict?: boolean;
  onMissingContext?: (op: string) => void;
  onError?: (err: unknown, op: string) => void;
  defaultValue?: Partial<T>;
};

export type Context<T extends AnyRecord> = {
  run<R>(values: T, fn: () => R): R;
  with<R>(values: ContextSnapshot<T>, fn: () => R): R;
  get<K extends keyof T>(key: K): T[K] | undefined;
  mustGet<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
  snapshot(): Readonly<ContextSnapshot<T>>;
  bind<F extends (...args: any[]) => any>(fn: F): F;
};

const mergeValues = <T extends AnyRecord>(
  base: ContextSnapshot<T> | undefined,
  next: ContextSnapshot<T> | undefined
): Store<T> => {
  const result: Store<T> = {};
  if (base) {
    Object.assign(result, base);
  }
  if (next) {
    Object.assign(result, next);
  }
  return result;
};

const cloneStore = <T extends AnyRecord>(store: Store<T>): Store<T> => ({ ...store });

export const createContext = <T extends AnyRecord>(
  options: CreateContextOptions<T> = {}
): Context<T> => {
  const storage = new AsyncLocalStorage<Store<T>>();
  const strict = options.strict ?? false;
  const defaultValue = options.defaultValue ?? {};

  const reportMissing = (op: string) => {
    options.onMissingContext?.(op);
  };

  const reportError = (err: unknown, op: string) => {
    options.onError?.(err, op);
  };

  const getStore = (): Store<T> | undefined => storage.getStore();

  const run = <R>(values: T, fn: () => R): R => {
    const store:unknown = mergeValues(defaultValue, values);
    return storage.run(store as T, fn);
  };

  const get = <K extends keyof T>(key: K): T[K] | undefined => {
    const store = getStore();
    if (!store) {
      reportMissing("get");
      if (strict) {
        throw new Error("request-context: no active context for get");
      }
      return undefined;
    }
    return store[key] as T[K] | undefined;
  };

  const mustGet = <K extends keyof T>(key: K): T[K] => {
    const store = getStore();
    if (!store) {
      reportMissing("mustGet");
      const error = new Error("request-context: no active context for mustGet");
      reportError(error, "mustGet");
      throw error;
    }
    const value = store[key] as T[K] | undefined;
    if (value === undefined) {
      const error = new Error(`request-context: missing value for key \"${String(key)}\"`);
      reportError(error, "mustGet");
      throw error;
    }
    return value;
  };

  const set = <K extends keyof T>(key: K, value: T[K]): void => {
    const store = getStore();
    if (!store) {
      reportMissing("set");
      if (strict) {
        throw new Error("request-context: no active context for set");
      }
      return;
    }
    store[key] = value;
  };

  const snapshot = (): Readonly<ContextSnapshot<T>> => {
    const store = getStore();
    if (!store) {
      reportMissing("snapshot");
      if (strict) {
        throw new Error("request-context: no active context for snapshot");
      }
      return {} as Readonly<ContextSnapshot<T>>;
    }
    return cloneStore(store);
  };

  const withValues = <R>(values: ContextSnapshot<T>, fn: () => R): R => {
    const store = getStore();
    if (!store) {
      reportMissing("with");
      if (strict) {
        throw new Error("request-context: no active context for with");
      }
      return run(values as T, fn);
    }
    const merged = mergeValues(store, values);
    return storage.run(merged, fn);
  };

  const bind = <F extends (...args: any[]) => any>(fn: F): F => {
    const store = getStore();
    if (!store) {
      reportMissing("bind");
      if (strict) {
        throw new Error("request-context: no active context for bind");
      }
      return fn;
    }
    const captured = cloneStore(store);
    const bound = ((...args: Parameters<F>) => storage.run(captured, () => fn(...args))) as F;
    return bound;
  };

  return {
    run,
    with: withValues,
    get,
    mustGet,
    set,
    snapshot,
    bind
  };
};

export type ExpressMiddlewareOptions = {
  headerName?: string;
  generateRequestId?: () => string;
  getUserId?: (req: any) => string | undefined;
};

export const expressMiddleware = <T extends { requestId: string; userId?: string }>(
  ctx: Context<T>,
  opts: ExpressMiddlewareOptions = {}
): ExpressRequestHandler => {
  const headerName = (opts.headerName ?? "x-request-id").toLowerCase();
  const generateRequestId = opts.generateRequestId ?? (() => randomUUID());
  const getUserId = opts.getUserId;

  return (req, _res, next) => {
    const headerValue = req?.headers?.[headerName];
    const requestId =
      typeof headerValue === "string"
        ? headerValue
        : Array.isArray(headerValue)
          ? headerValue[0]
          : generateRequestId();
    const userId = getUserId ? getUserId(req) : undefined;

    ctx.run({ requestId, ...(userId ? { userId } : {}) } as T, () => {
      try {
        const result = (next as unknown as () => unknown)();
        if (result !== null && result !== undefined) {
          if (typeof (result as Promise<unknown>).then === "function") {
            (result as Promise<unknown>).catch(next);
          }
        }
      } catch (error) {
        next(error as Error);
      }
    });
  };
};

export default createContext;
