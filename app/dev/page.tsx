"use client";

import { useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type CheckResult = { status: number; body: unknown } | { error: string };

function statusTone(status: string) {
  if (status === "streaming" || status === "submitted") return "secondary";
  if (status === "error") return "destructive";
  return "outline";
}

export default function DevConsolePage() {
  const { messages, sendMessage, status, error, stop } = useChat();
  const [input, setInput] = useState("");
  const [checks, setChecks] = useState<Record<string, CheckResult | "loading">>(
    {},
  );

  const busy = status === "submitted" || status === "streaming";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  async function runCheck(path: string) {
    setChecks((c) => ({ ...c, [path]: "loading" }));
    try {
      const res = await fetch(path);
      const body = await res.json().catch(() => null);
      setChecks((c) => ({ ...c, [path]: { status: res.status, body } }));
    } catch (err) {
      setChecks((c) => ({
        ...c,
        [path]: { error: err instanceof Error ? err.message : String(err) },
      }));
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Tier 0 dev console
          </h1>
          <p className="text-muted-foreground text-sm">
            Connectivity checks for the skeleton: streaming chat + API routes.
          </p>
        </div>
        <Link href="/" className={cn(buttonVariants({ variant: "ghost" }))}>
          ← Home
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        {/* Streaming chat test (task 0.2) */}
        <Card className="flex flex-col">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>Streaming chat</CardTitle>
                <CardDescription>
                  POST /api/chat · streamText → UI message stream
                </CardDescription>
              </div>
              <Badge variant={statusTone(status)}>{status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <div className="bg-muted/40 min-h-56 flex-1 space-y-3 overflow-y-auto rounded-md border p-3 text-sm">
              {messages.length === 0 && (
                <p className="text-muted-foreground">
                  Send a message to watch tokens stream back.
                </p>
              )}
              {messages.map((m) => (
                <div key={m.id} className="space-y-1">
                  <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                    {m.role}
                  </div>
                  <div className="whitespace-pre-wrap">
                    {m.parts.map((part, i) =>
                      part.type === "text" ? (
                        <span key={i}>{part.text}</span>
                      ) : null,
                    )}
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <p className="text-destructive text-sm">
                {error.message}
                <span className="text-muted-foreground">
                  {" "}
                  (is OPENAI_API_KEY set and the model id valid?)
                </span>
              </p>
            )}

            <form onSubmit={onSubmit} className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything to test the stream…"
                disabled={busy}
              />
              {busy ? (
                <Button type="button" variant="secondary" onClick={stop}>
                  Stop
                </Button>
              ) : (
                <Button type="submit">Send</Button>
              )}
            </form>
          </CardContent>
        </Card>

        {/* Endpoint checks (tasks 0.2 health / 0.3 db) */}
        <Card>
          <CardHeader>
            <CardTitle>Endpoint checks</CardTitle>
            <CardDescription>Health probe and Supabase round-trip.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { path: "/api/health", label: "GET /api/health" },
              { path: "/api/db-check", label: "GET /api/db-check" },
            ].map(({ path, label }) => {
              const result = checks[path];
              return (
                <div key={path} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-xs">{label}</code>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runCheck(path)}
                      disabled={result === "loading"}
                    >
                      {result === "loading" ? "Running…" : "Run"}
                    </Button>
                  </div>
                  {result && result !== "loading" && (
                    <pre className="bg-muted/40 max-h-40 overflow-auto rounded-md border p-2 text-xs">
                      {JSON.stringify(result, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
