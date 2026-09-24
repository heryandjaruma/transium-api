"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import * as z from "zod"
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth-client"

const updatePasswordSchema = z
    .object({
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: z.string().min(8, "New password must be at least 8 characters"),
        confirmPassword: z.string().min(1, "Please confirm your new password"),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
    })

export default function AccountPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)
    const [signingOut, setSigningOut] = useState(false)

    const updatePassword = async (formData: FormData) => {
        const parsed = updatePasswordSchema.safeParse({
            currentPassword: formData.get("currentPassword"),
            newPassword: formData.get("newPassword"),
            confirmPassword: formData.get("confirmPassword"),
        })

        if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? "Invalid input")
            setSuccess(false)
            return
        }

        setLoading(true)
        setError(null)
        setSuccess(false)

        const { error: updateError } = await authClient.changePassword({
            currentPassword: parsed.data.currentPassword,
            newPassword: parsed.data.newPassword,
            revokeOtherSessions: true,
        })

        setLoading(false)

        if (updateError) {
            setError(updateError.message ?? "Failed to update password")
            return
        }

        setSuccess(true)
    }

    const signOut = async () => {
        setSigningOut(true)
        await authClient.signOut()
        router.push("/login")
        router.refresh()
    }

    return (
        <div className="p-4 flex flex-col gap-4 max-w-xl">
            <h1>Account</h1>
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                    {success && (
                        <p className="text-sm text-muted-foreground">Password updated successfully.</p>
                    )}

                    <form
                        action={updatePassword}
                        className="flex flex-col gap-3 rounded-lg border p-4"
                    >
                        <FieldGroup>
                            <Field>
                                <Input
                                    id="currentPassword"
                                    name="currentPassword"
                                    type="password"
                                    placeholder="Current password"
                                    required
                                    disabled={loading}
                                />
                            </Field>
                            <Field>
                                <Input
                                    id="newPassword"
                                    name="newPassword"
                                    type="password"
                                    placeholder="New password"
                                    required
                                    disabled={loading}
                                />
                            </Field>
                            <Field>
                                <Input
                                    id="confirmPassword"
                                    name="confirmPassword"
                                    type="password"
                                    placeholder="Confirm new password"
                                    required
                                    disabled={loading}
                                />
                            </Field>
                            {error && (
                                <Field>
                                    <FieldError>{error}</FieldError>
                                </Field>
                            )}
                            <Field>
                                <Button type="submit" className="w-full" disabled={loading}>
                                    {loading ? "Updating..." : "Update Password"}
                                </Button>
                            </Field>
                        </FieldGroup>
                    </form>
                </div>
                <Button
                    variant={"destructive"}
                    className={"w-full"}
                    onClick={signOut}
                    disabled={signingOut}
                >
                    {signingOut ? "Signing out..." : "Sign Out"}
                </Button>
            </div>
        </div>
    )
}