import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Share } from "lucide-react";

import { cn } from "@/lib/cn";
import { useMenuMotion } from "./MenuMotion";
import {
  copyTranscriptToClipboard,
  downloadMarkdownTranscript,
  formatTranscriptMarkdown,
  slugifyTranscriptFilename,
} from "@/lib/export-transcript";
import type { Message } from "@/state/store";
import { MENU_HEADING, MENU_SHEET } from "./menu-recipe";
import { MenuItem } from "./ui/MenuItem";

export interface ExportTranscriptMenuProps {
  title: string;
  messages: readonly Message[];
  botName?: string;
  isGroup?: boolean;
  className?: string;
}

export function ExportTranscriptMenu({
  title,
  messages,
  botName,
  isGroup = false,
  className,
}: ExportTranscriptMenuProps) {
  const [open, setOpen] = useState(false);
  const motion = useMenuMotion(open);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const hasMessages = messages && messages.length > 0;

  const handleCopy = async () => {
    if (!hasMessages) return;
    const markdown = formatTranscriptMarkdown({
      title,
      messages,
      botName,
      isGroup,
    });
    const success = await copyTranscriptToClipboard(markdown);
    setCopyFailed(!success);
    if (success) {
      setCopied(true);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 2_000);
    }
  };

  const handleDownload = () => {
    if (!hasMessages) return;
    const markdown = formatTranscriptMarkdown({
      title,
      messages,
      botName,
      isGroup,
    });
    const filename = slugifyTranscriptFilename(title);
    downloadMarkdownTranscript(filename, markdown);
    setOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Export conversation"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex size-8 items-center justify-center rounded-full transition-colors hover:bg-fill",
          open ? "text-accent" : "text-ink-secondary hover:text-ink",
          className,
        )}
        title="Export conversation as Markdown"
      >
        <Share size={18} />
      </button>

      {motion.shown && (
        <div
          role="menu"
          aria-label="Export options"
          className={cn("absolute right-0 top-full z-40 mt-1 w-55 overflow-hidden", MENU_SHEET, motion.className)} {...motion.exitProps}
        >
          <div className={MENU_HEADING}>
            Export Conversation
          </div>

          {!hasMessages ? (
            <div className="px-2 py-1.5 text-sm text-ink-secondary">
              No messages to export yet.
            </div>
          ) : (
            <>
              <MenuItem
                onClick={() => void handleCopy()}
                icon={copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                label={copied ? "Copied to clipboard!" : "Copy as Markdown"}
              />

              {copyFailed && (
                <div role="status" className="px-2 py-1.5 text-sm text-ink-secondary">
                  Clipboard unavailable. Download the Markdown file instead.
                </div>
              )}

              <MenuItem onClick={handleDownload} icon={<Download size={16} />} label="Download as .md" />
            </>
          )}
        </div>
      )}
    </div>
  );
}
