import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/access", "/api/access/verify"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname === `${p}/`)) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get("ama_access");
  if (cookie?.value === "granted") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/access";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
