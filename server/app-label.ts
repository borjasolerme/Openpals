const KNOWN: Record<string, string> = { googlecalendar: "Google Calendar", googlesheets: "Google Sheets", github: "GitHub", hubspot: "HubSpot" };

/** A connected app's name for people: its known spelling, or its slug's words capitalized. */
export function appLabel(slug: string): string {
  return KNOWN[slug] ?? slug.split(/[-_]+/).map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : part).join(" ");
}
