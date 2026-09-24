import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth } from "@/lib/auth";
import { isApnsConfigured, sendPushToUser } from "@/lib/apn";

/**
 * Sends a test push to every device the caller has registered, so setup can
 * be verified end-to-end without wiring a real notification trigger yet.
 */
export async function POST(request: NextRequest) {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { env } = getCloudflareContext();
    if (!isApnsConfigured(env)) {
        return NextResponse.json({ error: "APNs is not configured" }, { status: 503 });
    }

    const results = await sendPushToUser(env, session.user.id, {
        title: "Transium",
        body: "This is a test notification.",
    });

    return NextResponse.json({ results });
}
