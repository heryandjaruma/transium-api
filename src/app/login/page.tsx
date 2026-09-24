import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
    return (
        <div className="w-full flex items-center justify-center h-screen">
            <div className="max-w-sm w-full">
                <LoginForm />
            </div>
        </div>
    )
}