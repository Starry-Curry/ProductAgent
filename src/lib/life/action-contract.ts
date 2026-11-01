import {z} from 'zod';
/** Shared physical/action vocabulary; no product-specific answers. */
export const actionKinds = [
  "select",
  "group",
  "sequence",
  "assign_role",
  "contain",
  "side_by_side",
  "support",
  "stack",
  "clamp",
  "occlude",
  "reflect",
  "illuminate",
  "elastic_release",
  "magnetic_hold",
  "friction_select",
  "heat",
  "food_contact",
  "device_operation",
  "adhere",
  "cut",
  "purchase",
  "other",
] as const;
export const actionSchema = z
  .object({
    kind: z.enum(actionKinds),
    items: z.array(z.string()).min(1).max(4),
    target: z.string().optional(),
    component: z.string().default("本体"),
    operationRef: z.string().optional(),
  })
  .strict();
