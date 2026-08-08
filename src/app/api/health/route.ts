import { NextResponse } from "next/server";

// Unauthenticated on purpose — this is what container orchestration (Docker
// HEALTHCHECK, Kubernetes probes, load balancers) polls to confirm the process
// is up and serving requests, not a general-purpose status endpoint.
export function GET() {
  return NextResponse.json({ status: "ok" });
}
