import { z } from "zod";

export const physicalKeys = [
  "outer_mm",
  "inner_mm",
  "free_surface_mm",
  "mass_kg",
  "max_load_kg",
  "clamp_gap_mm",
  "rigid",
  "elastic",
  "magnetic",
  "transparent",
  "reflective",
  "flat_surface",
  "open_container",
  "portable",
  "clamp",
  "light",
  "sound",
  "food_contact",
  "heat_limit_c",
  "contents",
  "material",
] as const;
export const physicalFactSchema = z
  .object({
    id: z.string().uuid(),
    component: z.string().trim().min(1).max(60).default("本体"),
    key: z.enum(physicalKeys),
    value: z.union([
      z.string().trim().min(1).max(250),
      z.number().finite(),
      z.boolean(),
      z.tuple([
        z.number().positive(),
        z.number().positive(),
        z.number().nonnegative(),
      ]),
    ]),
    basis: z.literal("user_report").default("user_report"),
  })
  .strict()
  .superRefine((f, c) => {
    const sizes = ["outer_mm", "inner_mm", "free_surface_mm"];
    const numbers = ["mass_kg", "max_load_kg", "clamp_gap_mm", "heat_limit_c"];
    if (sizes.includes(f.key) && !Array.isArray(f.value))
      c.addIssue({ code: "custom", message: "尺寸需要毫米制长宽高三个数值" });
    else if (
      numbers.includes(f.key) &&
      (typeof f.value !== "number" || f.value < 0)
    )
      c.addIssue({ code: "custom", message: "需要非负数值" });
    else if (
      !sizes.includes(f.key) &&
      !numbers.includes(f.key) &&
      !["contents", "material"].includes(f.key) &&
      typeof f.value !== "boolean"
    )
      c.addIssue({ code: "custom", message: "性质需要明确的是/否报告" });
    else if (
      ["contents", "material"].includes(f.key) &&
      typeof f.value !== "string"
    )
      c.addIssue({ code: "custom", message: "需要具体文字描述" });
  });
export type PhysicalFact = z.infer<typeof physicalFactSchema>;
