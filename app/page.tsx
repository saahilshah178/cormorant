import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SignInButton } from "@/components/sign-in-button";
import { getCurrentUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const pillars = [
  {
    title: "Fit, not hype",
    body: "Every company is scored against your active thesis. Swap the thesis and the ranking reorders.",
  },
  {
    title: "Traceable evidence",
    body: "Each score links to the specific signals that drove it — every one with a clickable source URL.",
  },
  {
    title: "The honest bear case",
    body: "A specific, falsifiable reason to pass on every company. Never “the market is competitive.”",
  },
];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ signin?: string; auth_error?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const notice = params.auth_error
    ? "Sign-in failed. Please try again."
    : params.signin
      ? "Please sign in to continue."
      : null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16">
      {notice && (
        <div
          role="status"
          className={cn(
            "mb-6 rounded-lg border p-3 text-sm",
            params.auth_error
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : "border-border bg-muted/50 text-foreground",
          )}
        >
          {notice}
        </div>
      )}
      <div className="flex items-center gap-3">
        <span className="text-3xl font-semibold tracking-tight">Cormorant</span>
        <Badge variant="secondary">The VC brain</Badge>
      </div>

      <h1 className="mt-6 max-w-2xl text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
        An AI venture-capital operating system.
      </h1>
      <p className="text-muted-foreground mt-4 max-w-2xl text-lg">
        Discover startups, score them against your stated investment thesis with
        traceable, cited evidence, and decide fast — including an honest reason
        to pass on every deal.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {user ? (
          <>
            <Link href="/dealflow" className={cn(buttonVariants({ size: "lg" }))}>
              Open the deal flow
            </Link>
            <Link
              href="/onboarding"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
            >
              Describe your thesis
            </Link>
          </>
        ) : (
          <SignInButton />
        )}
      </div>

      <div className="mt-14 grid gap-4 sm:grid-cols-3">
        {pillars.map((p) => (
          <Card key={p.title}>
            <CardHeader>
              <CardTitle className="text-base">{p.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>{p.body}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
