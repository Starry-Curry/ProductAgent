import { randomUUID } from "node:crypto";
import {
  assertPublicRequest,
  publicDemo,
  visitorContext,
  readVisitor,
  enterRequest,
  checkStorage,
  reserveUpload,
  enterUpload,
  CloudError,
} from "./runtime.ts";

function clean(value: unknown): unknown {
  if (typeof value === "string") {
    if (
      /\.env\.local|npm (?:run|ci)|[A-Z]:\\|PRODUCT_AGENT_DATA_DIR/.test(value)
    )
      return "演示服务暂未就绪，请稍后重试或联系维护者";
    return value;
  }
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            ![/api.?key/i, /secret/i, /checkpoint/i, /^trace$/i].some((p) =>
              p.test(k),
            ),
        )
        .map(([k, v]) => [k, clean(v)]),
    );
  return value;
}
export function withDemoRequest<T extends unknown[]>(
  handler: (r: Request, ...args: T) => Response | Promise<Response>,
) {
  return async (r: Request, ...args: T): Promise<Response> => {
    if (!publicDemo()) return handler(r, ...args);
    const requestId = randomUUID(),
      start = Date.now();
    let status = 500;
    try {
      assertPublicRequest(r);
      const scope = readVisitor(r),
        leave = enterRequest(scope);
      return await visitorContext.run(scope, async () => {
        let leaveUpload = () => {};
        try {
          if (r.headers.get("content-type")?.includes("multipart/form-data"))
            leaveUpload = enterUpload();
          if (!["GET", "HEAD"].includes(r.method)) {
            const max = r.headers
              .get("content-type")
              ?.includes("multipart/form-data")
              ? 8_500_000
              : 256_000;
            if (Number(r.headers.get("content-length") || 0) > max)
              throw new CloudError("body_limit", "请求内容过大", 413);
            const reader = r.body?.getReader(),
              chunks: Uint8Array[] = [];
            let length = 0;
            if (reader)
              while (true) {
                const part = await reader.read();
                if (part.done) break;
                length += part.value.length;
                if (length > max) {
                  await reader.cancel();
                  throw new CloudError("body_limit", "请求内容过大", 413);
                }
                chunks.push(part.value);
              }
            if (r.headers.get("content-type")?.includes("multipart/form-data"))
              reserveUpload(length);
            if (
              r.method !== "DELETE" &&
              !r.headers.get("content-type")?.includes("multipart/form-data")
            ) {
              let cleanup = false;
              try {
                const p = JSON.parse(Buffer.concat(chunks).toString());
                cleanup =
                  ["deleteFragment", "forget", "close"].includes(p.action) ||
                  (p.action === "storyOrganization" &&
                    ["deleteChapter", "forget", "reject"].includes(
                      p.input?.command,
                    ));
              } catch {}
              if (!cleanup) checkStorage();
            }
            const headers = new Headers(r.headers);
            headers.delete("content-length");
            r = new Request(r.url, {
              method: r.method,
              headers,
              body: new Uint8Array(Buffer.concat(chunks)),
            });
          }
          const response = await handler(r, ...args);
          readVisitor(r); // Revoked/expired credentials cannot receive a late response.
          status = response.status;
          const headers = new Headers(response.headers);
          headers.set("Cache-Control", "private, no-store");
          headers.set("X-Request-ID", requestId);
          headers.set("X-Content-Type-Options", "nosniff");
          if (headers.get("Content-Type")?.includes("application/json"))
            return new Response(JSON.stringify(clean(await response.json())), {
              status,
              headers,
            });
          return new Response(response.body, { status, headers });
        } finally {
          leaveUpload();
          scope.close?.();
          leave();
        }
      });
    } catch (e) {
      status = e instanceof CloudError ? e.status : 503;
      return Response.json(
        {
          error:
            e instanceof CloudError
              ? e.message
              : "演示服务暂不可用，请稍后重试",
          code: e instanceof CloudError ? e.code : "internal",
          requestId,
        },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    } finally {
      console.info(
        JSON.stringify({
          event: "api_request",
          requestId,
          path: new URL(r.url).pathname.replace(/\/[a-f0-9-]{24,}/g, "/:id"),
          method: r.method,
          status,
          elapsedMs: Date.now() - start,
        }),
      );
    }
  };
}
