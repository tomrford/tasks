import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { apiRoutes } from "./routes/api";
import { deviceApiRoutes, deviceUiRoutes } from "./routes/device";
import { uiRoutes } from "./routes/ui";
import type { AppVariables, Env } from "./types";

export { TaskRoom } from "./room";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.get("/health", (c) => c.json({ ok: true }));

app.get("/", (c) => c.redirect("/ui"));

// Device auth API (public, no CF Access) + Approval UI (CF Access)
app.route("/api/device", deviceApiRoutes);
app.route("/device", deviceUiRoutes);

// Machine-authenticated API (bypasses CF Access, uses Bearer token)
app.route("/api", apiRoutes);

// Human Web UI (protected by CF Access)
app.route("/ui", uiRoutes);

app.notFound((c) => c.json({ error: "not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error("Unhandled worker error:", err);
  return c.json({ error: "internal server error" }, 500);
});

export default app;
