// Standing style rule: no em dashes anywhere, including AI-generated
// text. Claude's prose defaults to em dashes fairly often, so every
// LLM output that gets stored/displayed passes through this first.
export function noEmDash(text: string): string {
  return text.replace(/—/g, "–");
}
