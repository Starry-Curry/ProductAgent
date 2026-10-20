import { storyOrganization, organizeStories } from "@/lib/life/organization";
import { matchStoryPhoto } from "@/lib/life/story-photo";
import {
  findOfficial,
  officialDomain,
  modelMentioned,
  organizeKnowledge,
} from "@/lib/life/knowledge";
import { visionStatus, recognizeOwnedPhoto } from "@/lib/life/vision";
import { planDiscovery } from "@/lib/life/planning";
import {
  importCreativeEvidence,
  listCreativeEvidence,
} from "@/lib/life/creative-evidence";
import {
  acquireKnowledge,
  readKnowledge,
  indexOfficialSource,
  knowledgeConflicts,
} from "@/lib/life/acquisition";
import { createLifeItem } from "@/lib/life/intake";
import { lookupOpenCatalog } from "@/lib/life/open-catalog";
import { syntheticItem } from "@/lib/life/availability";
import { z } from "zod";
import { actor, localOnly, read, database, write } from "@/lib/db";
import { visible, mutate, canRead, type State } from "@/lib/domain";
import { AgentError } from "@/lib/agent/contracts";
import {
  listFragments,
  saveFragment,
  deleteFragment,
} from "@/lib/life/stories";
import {
  listSources,
  saveSource,
  parseCode,
  fetchPublicText,
} from "@/lib/life/sources";
import {
  discoverLife,
  listLifeIdeas,
  feedbackIdea,
  modelIdea,
  submitIdea,
  creativeRecipeCount,
} from "@/lib/life/ideas";
import { lifeProvider, cloudStatus } from "@/lib/life/provider";
import { ProviderError } from "@/lib/ai/provider";
import { storePhoto } from "@/lib/life/media";
import { productPacks, searchProducts } from "@/lib/products";
import { installLifeDemo } from "@/lib/life/demo";
import { createLifeGift } from "@/lib/life/gifts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function fail(e: unknown) {
  return Response.json(
    {
      code: e instanceof ProviderError ? e.code : undefined,
      error:
        e instanceof AgentError
          ? e.message
          : e instanceof z.ZodError
            ? "请检查填写内容、格式和长度"
            : e instanceof Error
              ? e.message
              : "操作未完成",
    },
    {
      status:
        e instanceof ProviderError
          ? 502
          : e instanceof AgentError
            ? e.status
            : 400,
    },
  );
}
export async function GET(r: Request) {
  try {
    localOnly(r);
    const a = actor(r),
      db = database(),
      state = read(),
      p = new URL(r.url).searchParams;
    if (p.has("itemId"))
      return Response.json({
        sources: listSources(db, state, a, p.get("itemId")!).map((s) => ({
          ...s,
          knowledge: organizeKnowledge(
            s,
            state.items.find((i) => i.id === p.get("itemId"))?.model,
          ),
        })),
        fragments: listFragments(db, state, a, p.get("itemId")!),
        knowledge: readKnowledge(db, state, a, p.get("itemId")!).map(
          ({ text, chunks, ...document }) => ({
            ...document,
            chunkCount: chunks.length,
          }),
        ),
        knowledgeWarnings: knowledgeConflicts(
          readKnowledge(db, state, a, p.get("itemId")!),
        ).map((c) => c.message),
      });
    return Response.json({
      workspace: {
        ...visible(state, a),
        items: visible(state, a).items.map((i) => ({
          ...i,
          synthetic: syntheticItem(i),
        })),
      },
      fragments: listFragments(db, state, a),
      storyOrganization: storyOrganization(db, state, a),
      ideas: listLifeIdeas(db, state, a),
      creativeEvidence: listCreativeEvidence(db, a),
      packs: productPacks,
      capabilities: {
        visual: visionStatus().ready,
        vision: visionStatus(),
        model: cloudStatus().ready,
        cloud: cloudStatus(),
        barcode: true,
        manual: true,
      },
      stats: {
        items: state.items.filter((i) => canRead(i, a) && !i.demo).length,
        syntheticItems: state.items.filter(
          (i) =>
            canRead(i, a) &&
            (i.synthetic || i.source === "示例数据") &&
            !i.demo,
        ).length,
        packs: productPacks.length,
        facts: productPacks.reduce((n, p) => n + p.claims.length, 0),
        procedures: 2,
        boundInstances: state.items.filter(
          (i) => canRead(i, a) && !i.demo && i.productBinding,
        ).length,
        distinctBoundModels: new Set(
          state.items
            .filter((i) => canRead(i, a) && !i.demo && i.productBinding)
            .map((i) => i.productBinding!.packId),
        ).size,
        legacyCases: state.items.filter((i) => canRead(i, a) && !!i.demo)
          .length,
        creativeRecipes: creativeRecipeCount,
        familyTasks: visible(state, a).tasks.length,
        gifts: visible(state, a).gifts.length,
        photoFragments: listFragments(db, state, a).filter((f) => f.mediaId)
          .length,
        fragments: listFragments(db, state, a).length,
      },
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(r: Request) {
  try {
    localOnly(r);
    const a = actor(r),
      db = database();
    if (r.headers.get("content-type")?.includes("multipart/form-data")) {
      if (Number(r.headers.get("content-length") || 0) > 9_000_000)
        throw new AgentError("文件过大");
      const f = await r.formData(),
        file = f.get("file");
      if (!(file instanceof File) || file.size > 8_000_000)
        throw new AgentError("需要小于 8MB 的文件");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (f.get("kind") === "photo" || f.get("kind") === "story-photo")
        return Response.json(
          await storePhoto(
            db,
            a,
            bytes,
            f.get("kind") === "story-photo" ? "story" : "item",
          ),
        );
      const { extractManual } = await import("@/lib/life/documents");
      return Response.json(
        await extractManual(bytes, file.name, f.get("kind") === "manual-ocr"),
      );
    }
    const p = await r.json();
    if (p.action === "storyOrganization")
      return Response.json(organizeStories(db, read, a, p.input));
    if (p.action === "storyPhoto")
      return Response.json(await matchStoryPhoto(db, read, a, p.input));
    if (p.action === "demo") {
      if (p.confirmed !== true) throw new AgentError("请确认载入合成案例");
      installLifeDemo(db);
      return Response.json({ ok: true });
    }
    if (p.action === "code")
      return Response.json(parseCode(z.string().max(3000).parse(p.text)));
    if (p.action === "lookupCode") {
      if (process.env.WUJIAN_ALLOW_PUBLIC_FETCH === "false")
        throw new AgentError("本机已关闭公开资料联网，可继续手动录入", 403);
      return Response.json(await lookupOpenCatalog(p.input?.code));
    }
    if (p.action === "lookup")
      return Response.json({
        candidates: searchProducts(z.string().max(200).parse(p.query)),
      });
    if (p.action === "creativeEvidence")
      return Response.json({
        evidence: await importCreativeEvidence(db, a, p.input),
      });
    if (p.action === "fetchSource")
      return Response.json({
        ...(await fetchPublicText(z.string().max(2000).parse(p.url))),
        kind: "user-link",
        notice:
          "用户主动读取的公开正文；不会绕过登录，也不自动认证为官方资料。",
      });
    if (p.action === "findOfficial")
      return Response.json(await findOfficial(p.input));
    if (p.action === "acquireKnowledge") {
      const v = z
        .object({
          itemId: z.string().min(1).max(100),
          force: z.boolean().default(false),
        })
        .strict()
        .parse(p.input);
      if (process.env.WUJIAN_ALLOW_PUBLIC_FETCH === "false")
        throw new AgentError("当前服务已关闭官方资料联网；仍可上传说明书", 403);
      const provider = lifeProvider();
      const result = await acquireKnowledge(db, read, a, v.itemId, {
        force: v.force,
        search:
          provider.ready && process.env.WUJIAN_ALLOW_SEARCH === "true"
            ? provider.search
            : undefined,
      });
      return Response.json({
        ...result,
        documents: result.documents.map(({ text, chunks, ...document }) => ({
          ...document,
          chunkCount: chunks.length,
        })),
      });
    }
    if (p.action === "recognizePhoto") {
      const v = z
        .object({ mediaId: z.string().uuid(), confirmed: z.literal(true) })
        .strict()
        .parse(p.input);
      return Response.json(
        await recognizeOwnedPhoto(db, a, v.mediaId, v.confirmed),
      );
    }
    if (p.action === "importOfficial") {
      const v = z
        .object({
          itemId: z.string().min(1),
          url: z.string().max(2000),
          confirmed: z.literal(true),
        })
        .strict()
        .parse(p.input);
      const item = read().items.find((i) => i.id === v.itemId && i.owner === a);
      if (!item?.brand || !item.model)
        throw new AgentError("请先补充品牌与完整型号，再核对官方资料", 403);
      if (!officialDomain(v.url, item.brand))
        throw new AgentError(
          "该站点未列入此品牌的官方适配范围，可作为本人提供资料保存",
        );
      const d = await fetchPublicText(v.url);
      if (
        !officialDomain(d.url, item.brand) ||
        !modelMentioned(d.title + " " + d.text, item.model)
      )
        throw new AgentError("正文未匹配完整型号，请核对地区版本；未保存资料");
      const currentItem = read().items.find(
        (i) => i.id === item.id && i.owner === a,
      );
      if (
        !currentItem ||
        currentItem.model !== item.model ||
        currentItem.brand !== item.brand
      )
        throw new AgentError("物品归属或型号在读取期间变化，请重新核对", 409);
      // Re-check ownership after the network wait; never shares this source with household members.
      const id = saveSource(db, read(), a, {
        itemId: item.id,
        title: d.title,
        text: d.text,
        url: d.url,
        kind: "official-public",
      });
      const source = {
        id,
        title: d.title,
        text: d.text,
        url: d.url,
        kind: "official-public",
      };
      let knowledgeNotice = "";
      try {
        indexOfficialSource(db, read(), a, item.id, id);
      } catch (e) {
        knowledgeNotice =
          e instanceof AgentError
            ? e.message
            : "暂未整理为型号知识，原资料已保存";
      }
      return Response.json({
        source: { ...source, knowledge: organizeKnowledge(source, item.model) },
        notice:
          "已保存本人核对的官方站点摘录；不等于完整知识包或实物验证。" +
          knowledgeNotice,
      });
    }
    if (p.action === "createItem")
      return Response.json(createLifeItem(db, read, a, p.input));
    if (p.action === "fragment")
      return Response.json({ fragment: saveFragment(db, read, a, p.input) });
    if (p.action === "gift")
      return Response.json({ gift: createLifeGift(db, read, a, p.input) });
    if (p.action === "deleteFragment") {
      const v = z
        .object({
          id: z.string().uuid(),
          revision: z.number().int().positive(),
        })
        .parse(p.input);
      deleteFragment(db, read(), a, v.id, v.revision);
      return Response.json({ ok: true });
    }
    if (p.action === "source") {
      const v = z
        .object({
          itemId: z.string().min(1).max(100),
          title: z.string().min(1).max(150),
          text: z.string().min(10).max(40000),
          url: z.string().max(2000).optional(),
          kind: z.enum(["user-manual", "user-link", "user-text"]),
        })
        .parse(p.input);
      return Response.json({ id: saveSource(db, read(), a, v) });
    }
    if (p.action === "discover")
      return Response.json(
        await planDiscovery(db, read(), a, p.input, lifeProvider(), read),
      );
    if (p.action === "submitIdea")
      return Response.json({ idea: submitIdea(db, read(), a, p.input) });
    if (p.action === "ideaFeedback") {
      feedbackIdea(db, read(), a, p.input);
      return Response.json({ ok: true });
    }
    if (p.action === "updateItem") {
      const v = z
        .object({
          itemId: z.string().min(1),
          name: z.string().optional(),
          brand: z.string().max(80).optional(),
          model: z.string().max(100).optional(),
          region: z
            .enum([
              "",
              "cn",
              "uk",
              "us",
              "global",
              "my",
              "au",
              "sg",
              "tw",
              "hk",
              "de",
              "fr",
            ])
            .optional(),
          lifecycle: z
            .enum(["一次性", "消耗型", "可重复使用", "长期耐用", "持续养护"])
            .optional(),
          state: z.string().optional(),
          availability: z.string().optional(),
          attributes: z.record(z.string(), z.unknown()).optional(),
          shared: z.boolean().optional(),
        })
        .parse(p.input);
      return Response.json({
        workspace: visible(write(a, "updateItem", v), a),
      });
    }
    throw new AgentError("不支持的操作");
  } catch (e) {
    return fail(e);
  }
}
