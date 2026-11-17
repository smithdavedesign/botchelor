/**
 * Which side each line of a cast transcript sits on (.cast-chat-sides in globals.css), so it reads as a back-and-forth
 * rather than one column (David 2026-11-17): by the order the voices first speak, the first on the left, the second
 * on the right, a third back on the left, and so on, so a speaker keeps one side all through. Pure: true = right.
 */
export function rightSide(speakerIds: readonly string[]): boolean[] {
  const order = [...new Set(speakerIds)];
  return speakerIds.map((id) => order.indexOf(id) % 2 === 1);
}
