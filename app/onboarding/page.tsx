import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThesisForm } from "@/components/thesis-form";

export const metadata = {
  title: "Thesis onboarding — Cormorant",
};

export default function OnboardingPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        Describe your thesis
      </h1>
      <p className="text-muted-foreground mt-2 max-w-xl">
        Fifteen seconds: stage, industries, your bar for traction, and the
        thesis in your own words. Every company gets scored against this — and
        re-scored when you switch it.
      </p>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>New thesis</CardTitle>
          <CardDescription>
            Saved theses appear in the header selector; the newest one becomes
            active immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThesisForm />
        </CardContent>
      </Card>
    </main>
  );
}
