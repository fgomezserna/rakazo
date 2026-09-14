import type { ReactNode } from "react";

export function MessageHoverMetadata({
  side,
  pinned = false,
  children,
}: {
  side: "start" | "end";
  pinned?: boolean;
  children: ReactNode;
}) {
  // Touch exposes More; hover-capable pointers reveal the full rail on demand.
  const reveal = pinned
    ? "pointer-events-auto opacity-100"
    : "pointer-events-auto opacity-100 [@media(hover:hover)_and_(pointer:fine)]:pointer-events-none [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover/message:pointer-events-auto [@media(hover:hover)_and_(pointer:fine)]:group-hover/message:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:focus-within:pointer-events-auto [@media(hover:hover)_and_(pointer:fine)]:focus-within:opacity-100";

  return (
    <div
      data-testid="message-hover-rail"
      className={`rk-message-hover-rail z-10 flex w-full items-center pt-0.5 transition-opacity ${reveal} [@media(hover:hover)_and_(pointer:fine)]:absolute [@media(hover:hover)_and_(pointer:fine)]:top-1/2 [@media(hover:hover)_and_(pointer:fine)]:w-auto [@media(hover:hover)_and_(pointer:fine)]:-translate-y-1/2 ${
        side === "end"
          ? "justify-start [@media(hover:hover)_and_(pointer:fine)]:start-full [@media(hover:hover)_and_(pointer:fine)]:ms-1"
          : "justify-end [@media(hover:hover)_and_(pointer:fine)]:end-full [@media(hover:hover)_and_(pointer:fine)]:me-1"
      }`}
    >
      {children}
    </div>
  );
}
