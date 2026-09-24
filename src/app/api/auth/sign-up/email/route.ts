import { getAuth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
    const auth = getAuth()
    const body = await request.json()
    const { name, email, password } = body as {
        name: string,
        email: string,
        password: string
    }

    auth.api.signUpEmail({
        body: {
            name: name,
            email: email,
            password: password,
        }
    })
    
    return NextResponse.json({success: true})
}