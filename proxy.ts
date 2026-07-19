import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session cookie on every request (required by
 * @supabase/ssr — without this, sessions silently expire) and gates the
 * signed-in-only routes. Unauthenticated visits to /onboarding or /dealflow
 * bounce to `/`, which shows the Google sign-in CTA.
 */
const PROTECTED_PATHS = ["/onboarding", "/dealflow"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected = PROTECTED_PATHS.some((p) =>
    request.nextUrl.pathname.startsWith(p),
  );
  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("signin", "1");
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // .well-known/workflow is Workflow DevKit's internal path — intercepting it
    // breaks workflow execution/resumption (see PLAN.md Tier 4 notes).
    "/((?!_next/static|_next/image|favicon.ico|\\.well-known/workflow/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
