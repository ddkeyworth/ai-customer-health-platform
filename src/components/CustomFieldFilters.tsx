import { OPS_BY_TYPE, OP_LABELS } from "@/lib/customFields/segmentFilter";
import { formNames } from "@/lib/customFields/segmentForm";
import type { CustomFieldLike } from "@/lib/customFields/values";

// The custom-field part of the segment builder: one row per field the workspace
// has, with the operators that make sense for its type. Leaving the operator on
// "No filter" skips the field. Plain form inputs, no scripts: the server action
// reads them with rawFiltersFromForm() and checks every value again.
const input =
  "w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent";

export default function CustomFieldFilters({ defs }: { defs: CustomFieldLike[] }) {
  if (defs.length === 0) return null;
  return (
    <fieldset className="space-y-3 rounded-lg border border-zinc-200 p-3">
      <legend className="px-1 text-xs font-medium text-zinc-600">Custom fields (optional)</legend>
      {defs.map((def) => {
        const n = formNames(def.id);
        const kind = def.type === "number" ? "number" : def.type === "date" ? "date" : "text";
        return (
          <div key={def.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_9rem_1fr] sm:items-start">
            <label htmlFor={n.op} className="pt-1.5 text-xs text-zinc-600">
              {def.label}
            </label>
            <select id={n.op} name={n.op} defaultValue="" className={input}>
              <option value="">No filter</option>
              {OPS_BY_TYPE[def.type].map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </select>
            {def.type === "pick_list" ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1.5">
                {def.options.map((o, i) => (
                  <label key={o} htmlFor={`${n.pick}_${i}`} className="flex items-center gap-1.5 text-xs text-zinc-700">
                    <input id={`${n.pick}_${i}`} type="checkbox" name={n.pick} value={o} />
                    {o}
                  </label>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input id={n.v1} name={n.v1} type={kind} step={kind === "number" ? "any" : undefined} maxLength={100} aria-label={`${def.label} value`} className={`${input} sm:max-w-[11rem]`} />
                {def.type !== "text" && (
                  <>
                    <span className="text-xs text-zinc-500">and</span>
                    <input id={n.v2} name={n.v2} type={kind} step={kind === "number" ? "any" : undefined} aria-label={`${def.label} upper value (for between)`} className={`${input} sm:max-w-[11rem]`} />
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-zinc-500">
        A customer with no value for a field never matches a filter on it. For &quot;is between&quot; fill in both boxes.
      </p>
    </fieldset>
  );
}
