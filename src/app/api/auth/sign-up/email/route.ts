import { getAuth } from "@/lib/auth";
import { success } from "better-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
    const auth = getAuth()
    const body = await request.json()
    const { name, email, password } = body as {
        name: string,
        email: string,
        password: string
    }
    try {
        const response = await auth.api.signUpEmail({
            body: {
                name: name,
                email: email,
                password: password,
            }
        })
        return NextResponse.json({ success: true , message: response})
    } catch (error) {
        return NextResponse.json({
            success: false,
            message: (error as Error).message || "Unexpected error."
        },
            { status: 500 })
    }
}