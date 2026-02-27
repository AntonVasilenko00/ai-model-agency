/**
 * Splits pasted text into separate prompts by [label] blocks.
 * Example: "[dataset_1]\nContent one.\n\n[dataset_2]\nContent two."
 * => ["Content one.", "Content two."]
 * Labels are stripped; only the content after each [label] is kept.
 */
export function splitPromptsByLabels(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Split at start or after newline, on [anything] line; content after each is one prompt
  const segments = trimmed.split(/(?:^|\n)\s*\[[^\]]+\]\s*\n/);

  return segments.map((s) => s.trim()).filter(Boolean);
}
