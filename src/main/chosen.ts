// The folders the user pointed at: in the Add Folder dialog, on the command line, or by dropping them
// on the window. The core adds nothing else to the deck, so the page can't put git to work in a
// folder of its own choosing.
//
// A choice is good for one add, made right away (the page asks as soon as it hears of the folder).
// A repository the user took out of the deck again, or another checkout that sits at the same path
// later on, needs choosing anew.

export const CHOICE_LASTS = 60_000 // ms

export class Chosen {
  private readonly until = new Map<string, number>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Note what the user chose just now; hands the paths back for the page. */
  note(paths: string[]): string[] {
    const until = this.now() + CHOICE_LASTS
    for (const path of paths) this.until.set(path, until)
    return paths
  }

  /** True when every one of `paths` was chosen a moment ago. The choices are used up by it. */
  take(paths: unknown): boolean {
    const now = this.now()
    for (const [path, until] of this.until) if (until < now) this.until.delete(path)
    if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string' && this.until.has(path))) return false
    for (const path of paths) this.until.delete(path)
    return true
  }
}
