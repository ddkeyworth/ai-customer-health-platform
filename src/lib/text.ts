// Standing style rule: no em dashes anywhere, including AI-generated
// text. Claude's prose defaults to em dashes fairly often, so every
// LLM output that gets stored/displayed passes through this first.
export function noEmDash(text: string): string {
  return text.replace(/—/g, "–");
}

// The rest of the standing writing rules (UK spelling, no tricolons, no
// "X, not Y" contrasts, no cleft or declarative-label sentences, no filler)
// can't be enforced by a regex after the fact the way em dashes can, so
// they go into every system prompt instead. Appended by withStyleRules().
const STYLE_RULES =
  "Writing style for every text field you output: UK spelling (organise, colour, behaviour). Plain, direct sentences that state the point without preamble. No em dashes. No lists of three parallel items joined by commas and 'and' unless naming three literal things. No 'X, not Y' contrast constructions, and no 'This is a ...' or 'What matters is ...' declarative labels; say the thing directly. No throat-clearing openers such as 'Given this', 'Overall' or 'It is worth noting'. No filler words such as genuinely, really, very, quite, essentially, basically, clearly or simply. Prefer a number to a vague qualifier like 'significant'. Vary sentence length.";

export function withStyleRules(systemPrompt: string): string {
  return `${systemPrompt}\n\n${STYLE_RULES}`;
}
