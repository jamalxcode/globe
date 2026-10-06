import { createFileRoute } from "@tanstack/react-router";
import { MeridianApp } from "@/components/meridian-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="h-dvh">
      <h1 className="sr-only">Meridian kinetic events globe</h1>
      <MeridianApp />
    </main>
  );
}
