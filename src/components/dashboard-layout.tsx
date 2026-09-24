import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import React from "react";

export default async function DashboardLayout({ children } : { children: React.ReactNode }) {
    const session = await getAuth().api.getSession({
        headers: await headers()
    })
    if (!session) redirect("/login")
    return<>{children}</>
}