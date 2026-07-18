"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ThesisForm } from "@/components/thesis-form";
import { deleteThesisAction } from "@/app/actions";
import type { Thesis } from "@/lib/thesis-schema";

/**
 * Header entry point for thesis CRUD (replaces the old "New thesis" link).
 * Lists the signed-in user's theses with per-row Edit/Delete; editing or
 * creating opens ThesisForm inline with its own Save button (updateThesisAction
 * / createThesisAction). Delete is immediate (it's a single irreversible
 * click, not a form with fields to stage) — everything else goes through Save.
 */
export function ThesisMenu({ theses }: { theses: Thesis[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Thesis | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete(id: string) {
    setDeletingId(id);
    startTransition(async () => {
      await deleteThesisAction(id);
      setDeletingId(null);
      if (editing !== "new" && editing?.id === id) setEditing(null);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setEditing(null);
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Thesis menu
      </DialogTrigger>
      <DialogContent className="max-w-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Your theses</DialogTitle>
          <DialogDescription>
            Edit or delete a saved thesis, or create a new one.
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <div className="flex flex-col gap-4">
            <ThesisForm
              thesis={editing === "new" ? undefined : editing}
              onSaved={() => setEditing(null)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {theses.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No theses yet — create your first one below.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {theses.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                  >
                    <span className="truncate text-sm font-medium">
                      {t.name}
                    </span>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(t)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={isPending && deletingId === t.id}
                        onClick={() => handleDelete(t.id)}
                      >
                        {isPending && deletingId === t.id
                          ? "Deleting…"
                          : "Delete"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => setEditing("new")}
            >
              + New thesis
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
