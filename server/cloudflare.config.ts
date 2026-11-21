import { bindings, defineConfig, exports } from "cf/config";

const LOCAL_DEV_D1_ID = "00000000-0000-4000-8000-000000000001";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  const domain = process.env.TASKS_DOMAIN;
  const workerName = process.env.TASKS_WORKER_NAME ?? "tasks";
  const d1Id = process.env.TASKS_D1_ID ?? (isDev ? LOCAL_DEV_D1_ID : undefined);

  return {
    worker: {
      name: workerName,
      entrypoint: "./src/index.ts",
      compatibilityDate: "2026-11-21",
      compatibilityFlags: ["nodejs_compat"],
      domains: domain ? [domain] : undefined,
      workersDev: !domain,
      observability: {
        enabled: true,
      },
      env: {
        DB: bindings.d1({
          name: process.env.TASKS_D1_NAME ?? "tasks-db",
          id: d1Id,
        }),
        ATTACHMENTS: bindings.r2({
          name: process.env.TASKS_R2_BUCKET ?? "tasks-attachments",
        }),
        ROOMS: bindings.durableObject({
          worker: workerName,
          exportName: "TaskRoom",
        }),
        CF_ACCESS_TEAM_DOMAIN: bindings.text(process.env.CF_ACCESS_TEAM_DOMAIN ?? ""),
        CF_ACCESS_AUD: bindings.text(process.env.CF_ACCESS_AUD ?? ""),
        // Strictly disabled outside development mode so shell env can never disable prod auth
        ALLOW_UNAUTHENTICATED_UI: bindings.text(
          isDev && process.env.ALLOW_UNAUTHENTICATED_UI === "true" ? "true" : "false",
        ),
      },
      exports: {
        TaskRoom: exports.durableObject({ storage: "sqlite" }),
      },
    },
  };
});
