import { createFileRoute } from "@tanstack/react-router";
import { openEventStream } from "@/server/kinetic.server";

export const Route = createFileRoute("/events")({
  server: {
    handlers: {
      GET: async ({ request }) => openEventStream(request),
    },
  },
});
