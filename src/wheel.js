// Where a wheel over Burrow's strip goes. The chip line takes a vertical
// wheel (as sideways scroll) only while it can still move that way; at either
// end, and over Burrow's rows, the wheel scrolls Roam's list under the strip,
// as it would with Burrow absent. A horizontal swipe or Shift+wheel over the
// chips is the browser's (the line is overflow-x: auto).
//   chips: { left, max } when the pointer is over the chip line, else null.
// Returns { to: "chips", left } | { to: "list", by } | { to: "native" }.
export function wheelPlan({ deltaX = 0, deltaY = 0, deltaMode = 0, shiftKey = false }, chips) {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 300 : 1;
  const dx = deltaX * unit;
  const dy = deltaY * unit;
  const horizontal = shiftKey || Math.abs(dx) > Math.abs(dy);
  if (horizontal || !dy) return { to: "native" };
  if (chips && chips.max > 0 && ((dy > 0 && chips.left < chips.max - 0.5) || (dy < 0 && chips.left > 0.5))) {
    return { to: "chips", left: Math.max(0, Math.min(chips.max, chips.left + dy)) };
  }
  return { to: "list", by: dy };
}
