// A customer's custom field values as a tidy labelled list. Renders nothing when
// the customer has no values, so a workspace without custom fields sees no change.
// Plain text only: React escapes everything, and nothing here uses raw HTML.
export default function CustomFieldValues({ values }: { values: { id: string; label: string; shown: string }[] }) {
  if (values.length === 0) return null;
  return (
    <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm" aria-label="Custom fields">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Custom fields</p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {values.map((v) => (
          <div key={v.id} className="min-w-0">
            <dt className="text-xs text-zinc-500">{v.label}</dt>
            <dd className="break-words text-zinc-900">{v.shown}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
