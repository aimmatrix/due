import { createInboundHandler } from "@/server/inbound/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createInboundHandler();
