import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) {
    return NextResponse.json(
      { error: "ACCESS_CODE is not configured on the server" },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => null);
  const code = body?.code;

  if (typeof code !== "string" || code !== accessCode) {
    return NextResponse.json(
      { error: "Invalid access code" },
      { status: 401 }
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("ama_access", "granted", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });

  return response;
}
