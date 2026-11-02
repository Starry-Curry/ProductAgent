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
    items: z.array(z.string()).min(1).max(4).describe('动作中的实际物体ID；support/stack为被承载物，contain为放入物，side_by_side为并排的两个物体'),
    target: z.string().optional().describe('实际作用对象ID；support/stack为承载底座，contain为容器，side_by_side为承载平面。缺失时条件未核，不用文字冒充已存在'),
    component: z.string().default("本体"),
    operationRef: z.string().optional(),
  })
  .strict();
