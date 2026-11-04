import { Server } from "lucide-react";
import { placeColorFill } from "@/lib/place-colors";

/** A place's colour as a small tile with a server mark, as the switcher and Settings draw a coloured place. */
export function PlaceTile({ color, size = 22 }: { color: unknown; size?: number }) {
  return <span aria-hidden="true" style={{ width: size, height: size, background: placeColorFill(color) }}
    className="grid shrink-0 place-items-center rounded-[7px] text-white"><Server size={Math.round(size * 0.62)} strokeWidth={2.2} /></span>;
}
