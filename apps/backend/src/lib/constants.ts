// Maximum requests allowed during one global rate-limit window.
export const GLOBAL_RATE_LIMIT_MAX = 1000;
// Global rate-limit window length in milliseconds.
export const GLOBAL_RATE_LIMIT_WINDOW = 60_000;
// Redis prefix for stored rate-limit counters.
export const REDIS_RATE_LIMIT_PREFIX = "rate_limit:";
