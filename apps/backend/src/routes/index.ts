import { Hono } from "hono";

import type { AppEnv } from "@/types/index.ts";

import { accessRoutes } from "@/routes/access.ts";
import { tableRoutes } from "@/routes/table.ts";

export const routes = new Hono<AppEnv>();

routes.route("/", accessRoutes);
routes.route("/", tableRoutes);
