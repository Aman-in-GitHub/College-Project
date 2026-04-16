import type { Context } from "hono";

import { getConnInfo } from "hono/bun";
import { isIP } from "node:net";

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
