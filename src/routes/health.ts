import { createFileRoute } from "@tanstack/react-router";
import { healthPayload } from "@/server/kinetic.server";

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(healthPayload(), {
          headers: { "cache-control": "no-store" },
        }),
    },
  },
});
