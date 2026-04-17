import type { Context } from "hono";

import { getConnInfo } from "hono/bun";
import { isIP } from "node:net";

export const DB_COLUMN_TYPES = [
  "text",
  "integer",
  "numeric",
  "boolean",
  "date",
  "time",
  "timestamp",
] as const;

export const PG_TYPE_BY_DB_TYPE: Record<(typeof DB_COLUMN_TYPES)[number], string> = {
  text: "TEXT",
  integer: "INTEGER",
  numeric: "NUMERIC",
  boolean: "BOOLEAN",
  date: "DATE",
  time: "TIME",
  timestamp: "TIMESTAMP",
};

const RESERVED_IDENTIFIERS = new Set([
  "select",
  "from",
  "where",
  "table",
  "user",
  "group",
  "order",
  "by",
  "insert",
  "update",
  "delete",
  "drop",
  "create",
  "alter",
]);

function normalizeValidatedIpAddress(value: string): string | null {
  let ipAddress = value;

  if (ipAddress.startsWith("::ffff:")) {
    ipAddress = ipAddress.slice("::ffff:".length);
  }

  if (isIP(ipAddress) > 0) {
    return ipAddress;
  }

  return null;
}

function normalizeIpAddress(value: string): string | null {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return null;
  }

  // Matches bracketed IPv6 with optional port, e.g. `[::1]`, `[2001:db8::1]:3000`; rejects plain `::1` and malformed `[::1`.
  const bracketedIpv6Match = trimmedValue.match(/^\[([^\]]+)\](?::\d+)?$/);

  if (bracketedIpv6Match) {
    return normalizeValidatedIpAddress(bracketedIpv6Match[1] ?? "");
  }

  // Matches `host:port` for IPv4-style hosts, e.g. `127.0.0.1:3000`; rejects bare `127.0.0.1` and IPv6 like `::1:3000`.
  const ipv4WithPortMatch = trimmedValue.match(/^([^:]+):(\d+)$/);

  if (ipv4WithPortMatch) {
    const host = ipv4WithPortMatch[1] ?? "";

    return isIP(host) === 4 ? host : null;
  }

  return normalizeValidatedIpAddress(trimmedValue);
}

function getForwardedIp(c: Context, headerName: string): string | null {
  const headerValue = c.req.header(headerName)?.trim() ?? "";

  if (headerValue.length === 0) {
    return null;
  }

  const firstForwardedValue = headerValue.split(",")[0]?.trim() ?? "";

  return normalizeIpAddress(firstForwardedValue);
}

export function getClientIp(c: Context): string | null {
  const cfIp = getForwardedIp(c, "cf-connecting-ip");

  if (cfIp) {
    return cfIp;
  }

  const realIp = getForwardedIp(c, "x-real-ip");

  if (realIp) {
    return realIp;
  }

  const forwardedIp = getForwardedIp(c, "x-forwarded-for");

  if (forwardedIp) {
    return forwardedIp;
  }

  const remoteAddress = getConnInfo(c).remote.address?.trim() ?? "";
  const normalizedRemoteAddress = normalizeIpAddress(remoteAddress);

  if (normalizedRemoteAddress) {
    return normalizedRemoteAddress;
  }

  return null;
}

export function normalizeIdentifier(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized || normalized.length > 63) {
    return null;
  }

  if (!/^[a-z_][a-z0-9_]*$/.test(normalized)) {
    return null;
  }

  if (RESERVED_IDENTIFIERS.has(normalized)) {
    return null;
  }

  return normalized;
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function mapFastApiType(pgType: string): (typeof DB_COLUMN_TYPES)[number] {
  const normalized = pgType.trim().toUpperCase();

  switch (normalized) {
    case "INTEGER":
      return "integer";
    case "NUMERIC":
      return "numeric";
    case "BOOLEAN":
      return "boolean";
    case "DATE":
      return "date";
    case "TIME":
      return "time";
    case "TIMESTAMP":
      return "timestamp";
    default:
      return "text";
  }
}
