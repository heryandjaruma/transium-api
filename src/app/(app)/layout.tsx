import { AppSidebar } from "@/components/app-sidebar";
import DashboardLayout from "@/components/dashboard-layout";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import React from "react";

export default function ProtectedAppLayout({ children }: { children: React.ReactNode }
) {
    return (
        <DashboardLayout>
            <TooltipProvider>
                <SidebarProvider>
                    <AppSidebar />
                    <SidebarInset>
                        <SidebarTrigger />
                        {children}
                    </SidebarInset>
                </SidebarProvider>
            </TooltipProvider>
        </DashboardLayout>
    )
}