import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const AUTH_PATHS = [
  "/login",
  "/register",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
];

const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "better-auth-session_token",
  "__Secure-better-auth.session_token",
  "better-auth.session_data",
  "__Secure-better-auth.session_data",
];

export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const path = url.pathname;
  const hasSession = !!getSessionCookie(request);
  const onAuthPage = AUTH_PATHS.some(
    (p) => path === p || path.startsWith(p + "/"),
  );

  if (onAuthPage && url.searchParams.has("stale")) {
    const cleanUrl = url.clone();
    cleanUrl.searchParams.delete("stale");
    const response = NextResponse.redirect(cleanUrl);
    for (const name of SESSION_COOKIE_NAMES) response.cookies.delete(name);
    return response;
  }

  if (hasSession && onAuthPage) {
    return NextResponse.redirect(new URL("/transactions", request.url));
  }
  if (!hasSession && !onAuthPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
