import type { ChangeSpec } from '@codemirror/state'

/**
 * Compute the minimal set of CodeMirror `ChangeSpec` entries needed to
 * transform `oldText` into `newText`, working at line granularity.
 *
 * Uses an LCS-based diff so only the lines that actually changed are
 * touched. Unchanged lines — including user comments, manual block labels,
 * and custom formatting — are left completely untouched in the editor.
 *
 * CodeMirror automatically adjusts the cursor position for unchanged
 * regions when the changes are dispatched, so no manual selection
 * remapping is needed.
 */
export function computeLtgChanges(oldText: string, newText: string): ChangeSpec[] {
  if (oldText === newText) return []

  const A = oldText.split('\n')
  const B = newText.split('\n')
  const n = A.length
  const m = B.length

  // ---------------------------------------------------------------------------
  // Build LCS table (bottom-up, suffix form)
  // lcs[i][j] = length of longest common subsequence of A[i..] and B[j..]
  // ---------------------------------------------------------------------------
  // Use Uint16Array rows — LTG files are well under 65 535 lines.
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = A[i] === B[j]
        ? 1 + lcs[i + 1]![j + 1]!
        : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  // ---------------------------------------------------------------------------
  // Precompute character start-offset of each line in oldText.
  // aStart[k] = position of the first character of A[k].
  // aStart[n] = oldText.length  (past the last character).
  // ---------------------------------------------------------------------------
  const aStart = new Uint32Array(n + 1)
  for (let k = 0; k < n; k++) {
    aStart[k + 1] = aStart[k]! + A[k]!.length + 1 // +1 for the '\n' separator
  }
  // Cap to the actual string length — handles files that do not end with '\n'.
  aStart[n] = oldText.length

  // ---------------------------------------------------------------------------
  // Walk the LCS to produce hunks.
  // Each hunk: replace A[aStart .. aEnd) with newLines joined by '\n'.
  // ---------------------------------------------------------------------------
  const changes: ChangeSpec[] = []
  let i = 0
  let j = 0

  while (i < n || j < m) {
    // Advance through matching (equal) lines.
    if (i < n && j < m && A[i] === B[j]) {
      i++
      j++
      continue
    }

    // Start of a hunk — collect all consecutive non-equal operations.
    const hunkAStart = i
    const hunkBStart = j

    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) break // next equal line ends the hunk

      // Greedy LCS walk: prefer insert when it keeps us on the longer LCS path.
      if (j < m && (i >= n || lcs[i + 1]![j]! <= lcs[i]![j + 1]!)) {
        j++ // take from B (insertion)
      } else {
        i++ // take from A (deletion)
      }
    }

    let   from    = aStart[hunkAStart]!
    const to      = aStart[i]!                     // aStart[n] === oldText.length
    const newPart = B.slice(hunkBStart, j)
    const atEnd   = to >= oldText.length
    const isPureDelete = newPart.length === 0
    const isPureInsert = from === to

    let insert: string
    if (isPureDelete) {
      // Deleting lines at the end of the doc — include the '\n' that preceded
      // them so the previous line doesn't gain a trailing newline.
      if (atEnd && from > 0) from -= 1
      insert = ''
    } else if (isPureInsert && atEnd && from > 0 && !oldText.endsWith('\n')) {
      // Appending to a file that does not end with '\n' — add the separator.
      insert = '\n' + newPart.join('\n')
    } else {
      // Replacement or insertion in the middle: trailing '\n' separates us from
      // the next line; omit it only when we're at the very end of the document.
      insert = newPart.join('\n') + (atEnd ? '' : '\n')
    }

    changes.push({ from, to, insert })
  }

  return changes
}
