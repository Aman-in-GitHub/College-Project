import { sql } from "drizzle-orm";

import { db } from "@/db";
import { redis } from "@/lib/redis";

const FORCE_FLAG = "--force";
const RESET_SENTINEL = "yes do it";

function isForceMode() {
  return process.argv.includes(FORCE_FLAG);
}

async function confirmReset() {
  if (isForceMode()) {
    return true;
  }

  console.log("This will DELETE all data in the public schema.");

  const answer = prompt(`\nType "${RESET_SENTINEL}" to continue:`);

  return (answer ?? "").trim().toLowerCase() === RESET_SENTINEL;
}

async function resetSchema() {
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE;`);

  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE;`);

  await db.execute(sql`CREATE SCHEMA public;`);
}

async function runMigrations() {
  const { $ } = await import("bun");

  await $`bun x --bun drizzle-kit migrate`;
}

async function resetRedis() {
  await redis.send("FLUSHALL", []);
}

async function reset() {
  const confirmed = await confirmReset();

  if (!confirmed) {
    console.log("\nReset cancelled.");
    process.exit(0);
  }

  console.log("\nStarting database reset...");
  console.log("\nDropping and recreating public schema...");

  await resetSchema();

  console.log("\nClearing Redis cache...");
  await resetRedis();

  console.log("\nRunning migrations...");
  await runMigrations();
  console.log("\nDatabase reset complete.");
}

reset()
  .catch((err) => {
    console.error("\nDatabase reset failed.");
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    redis.close();
  });
