import { useState } from "react";
import { Check, Copy, FileWarning, LayoutTemplate } from "lucide-react";

const INIT_COMMAND = "/devops-tools:init-devops-tools";
const UPDATE_COMMAND = "/devops-tools:update-devops-tools";

function CommandChip({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(command).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex items-center gap-2 rounded-md border border-(--line) bg-(--surface-2) px-3 py-1.5 font-mono text-sm transition hover:border-(--line-strong)"
    >
      {command}
      {copied ? (
        <Check size={14} className="text-(--accent)" />
      ) : (
        <Copy size={14} className="text-(--ink-3)" />
      )}
    </button>
  );
}

/**
 * A project that has never been mapped. This is the ordinary first-open state, not an error — so
 * it reads as an instruction rather than a failure, and hands over the exact thing to type.
 */
export function EmptyBoard({
  boardRelativePath,
}: {
  boardRelativePath: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="max-w-md text-center">
        <LayoutTemplate size={32} className="mx-auto text-(--ink-3)" />
        <h2 className="mt-4 text-lg font-medium">No board yet</h2>
        <p className="mt-2 text-sm text-(--ink-2)">
          This project has no{" "}
          <code className="font-mono text-xs">{boardRelativePath}</code>.
          Generate one from a Claude Code session in the project:
        </p>
        <div className="mt-4">
          <CommandChip command={INIT_COMMAND} />
        </div>
        <p className="mt-4 text-xs text-(--ink-3)">
          The canvas picks it up as soon as the file lands — no need to reopen
          the project. Commit the file so the diagram versions with your
          Terraform.
        </p>
      </div>
    </div>
  );
}

/** A board that exists but does not load. Show every issue: the fix is usually one of them. */
export function InvalidBoard({
  errors,
  boardRelativePath,
}: {
  errors: string[];
  boardRelativePath: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="max-w-xl">
        <FileWarning size={32} className="text-(--danger)" />
        <h2 className="mt-4 text-lg font-medium">
          <code className="font-mono text-base">{boardRelativePath}</code> could
          not be read
        </h2>
        <p className="mt-2 text-sm text-(--ink-2)">
          Regenerating it usually fixes this:
        </p>
        <div className="mt-3">
          <CommandChip command={UPDATE_COMMAND} />
        </div>
        <ul className="mt-5 space-y-1 rounded-lg bg-(--danger-bg) p-4 font-mono text-xs text-(--danger)">
          {errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
