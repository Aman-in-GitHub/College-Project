import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function fetchApiJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    credentials: init?.credentials ?? "include",
  });

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return {
      response,
      body: null,
    };
  }

  const body = await response.json().catch(() => null);

  return {
    response,
    body,
  };
}
