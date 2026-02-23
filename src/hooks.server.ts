import { auth } from "$lib/server/auth";
import type { Handle } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { setLanguageTag } from "$paraglide/runtime.js";

export const handle: Handle = async ({ event, resolve }) => {
  // 0. 性能优化：跳过静态资源和内部请求
  // 避免对 favicon.ico、图片、_app 等资源执行数据库查询和复杂的 CSP 逻辑
  if (
    event.url.pathname.startsWith("/_app") ||
    event.url.pathname.startsWith("/favicon.ico") ||
    event.url.pathname.match(/\.(png|jpg|jpeg|svg|gif|webp)$/)
  ) {
    return resolve(event);
  }

  // 1. Authentication (修复了 500 报错的核心)
  // 增加 try-catch 和空值检查，防止 auth.api.getSession 失败导致崩溃
  let sessionData = null;
  try {
    sessionData = await auth.api.getSession({
      headers: event.request.headers,
    });
  } catch (e) {
    console.error("Auth Error:", e);
    // 即使认证出错，也不要让整个页面崩溃，视为未登录即可
  }

  // 安全地获取 session，如果 sessionData 为 null，则 session 为 null
  event.locals.session = sessionData?.session ?? null;
  event.locals.user = sessionData?.user ?? null; // 建议同时也存入 user

  // 2. Generate Nonce for CSP
  const nonce = crypto.randomUUID().replace(/-/g, "");
  event.locals.nonce = nonce;

  // 3. Language Detection
  const acceptLanguage = event.request.headers.get("Accept-Language");
  let lang = "en";

  if (acceptLanguage) {
    const languages = acceptLanguage.split(",").map((l) => {
      const [name, q = "q=1"] = l.split(";");
      const quality = parseFloat(q.split("=")[1]) || 1;
      return { name: name.trim(), quality };
    });

    languages.sort((a, b) => b.quality - a.quality);

    const supported = ["en", "zh"];
    for (const l of languages) {
      const code = l.name.split("-")[0];
      if (supported.includes(code)) {
        lang = code;
        break;
      }
    }
  }

  setLanguageTag(lang as "en" | "zh");

  // 4. Resolve Response
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => {
      html = html.replace('<html lang="en"', `<html lang="${lang}"`);
      return html.replace(/<script(\s[^>]*)?>/g, `<script nonce="${nonce}"$1>`);
    },
  });

  // 5. Set CSP Header
  // 注意：在开发环境(dev)允许 unsafe-eval 是为了让 HMR 正常工作
  // 生产环境通常不需要 unsafe-eval，除非你有特殊库依赖它
  // 修复：添加 'unsafe-inline' 到 style-src 以支持 Svelte 动态样式和 DaisyUI
  const cspDirectives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' ${dev ? "'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`, // 修复了阻止内联样式的问题
    `img-src 'self' data: https:`, // 允许加载外部图片（如用户头像）
    `font-src 'self' data:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `connect-src 'self' https:`, // 允许连接外部 API
  ];

  const csp = cspDirectives.filter(Boolean).join("; ");

  if (response.headers.get("content-type")?.includes("text/html")) {
    response.headers.set("Content-Security-Policy", csp);
  }

  return response;
};
