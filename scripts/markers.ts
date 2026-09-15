/**
 * How a probe file says which code a marker comment owns: the lines under the marker, up to the next marker, a
 * blank line, or a line indented less than the marker. Both halves of the benchmark read their files by it.
 */

const indent = (line: string) => line.length - line.trimStart().length;

/** The 0-based last line `marker` owns; `marker` itself when it owns none. */
export function regionEnd(lines: readonly string[], marker: number, isMarker: (line: number) => boolean): number {
  let end = marker;
  while (
    end + 1 < lines.length &&
    !isMarker(end + 1) &&
    lines[end + 1].trim() !== '' &&
    indent(lines[end + 1]) >= indent(lines[marker])
  ) {
    end++;
  }
  return end;
}
