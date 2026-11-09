// Turns the segment builder's form fields into raw custom-field filters. Each
// custom field gets its own set of inputs, named from the field's id:
//   cf_<id>_op     the operator (empty means "no filter on this field")
//   cf_<id>_v1     the value, or the lower end of a range
//   cf_<id>_v2     the upper end of a range
//   cf_<id>_pick   (pick-lists) one entry per ticked choice
// The result still goes through parseCustomFilters() before anything is saved,
// so nothing the browser sends is trusted. Pure: no database.
import type { CustomFieldLike } from "./values";

export const formNames = (id: string) => ({
  op: `cf_${id}_op`,
  v1: `cf_${id}_v1`,
  v2: `cf_${id}_v2`,
  pick: `cf_${id}_pick`,
});

interface FormLike {
  get(name: string): unknown;
  getAll(name: string): unknown[];
}

const text = (x: unknown) => (typeof x === "string" ? x.trim() : "");

export function rawFiltersFromForm(defs: CustomFieldLike[], form: FormLike): unknown[] {
  const out: unknown[] = [];
  for (const def of defs) {
    const n = formNames(def.id);
    const op = text(form.get(n.op));
    if (op === "") continue;
    const v1 = text(form.get(n.v1));
    const v2 = text(form.get(n.v2));
    if (def.type === "pick_list") {
      const picked = form.getAll(n.pick).map(text).filter((v) => v !== "");
      if (picked.length > 0) out.push({ fieldId: def.id, op, value: picked });
    } else if (op === "between") {
      if (v1 !== "" && v2 !== "") {
        out.push({ fieldId: def.id, op, value: def.type === "number" ? { min: v1, max: v2 } : { from: v1, to: v2 } });
      }
    } else if (v1 !== "") {
      out.push({ fieldId: def.id, op, value: v1 });
    }
  }
  return out;
}
