import { killAll } from "../process-registry.js";

export async function POST() {
  killAll();
  return Response.json({ killed: true });
}
