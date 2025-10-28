/**
 * Cloudflare Worker - 网盘秒传JSON生成器
 * 支持: 123网盘, 189网盘, 夸克网盘
 *
 * 项目基于 tgto123-public 改编
 * GitHub: https://github.com/walkingddd/tgto123-public
 */

import indexHTML from "./index.html";
import { create123RapidTransfer } from "./service123.js";
import { create189RapidTransfer } from "./service189.js";
import { createQuarkRapidTransfer } from "./serviceQuark.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 首页
    if (url.pathname === "/") {
      return new Response(indexHTML, {
        headers: { ...corsHeaders, "Content-Type": "text/html;charset=utf-8" },
      });
    }

    // API路由
    const routes = {
      "/api/123/rapid": () => handle123Rapid(request, corsHeaders),
      "/api/189/rapid": () => handle189Rapid(request, corsHeaders),
      "/api/quark/rapid": () => handleQuarkRapid(request, corsHeaders),
    };

    if (routes[url.pathname] && request.method === "POST") {
      return await routes[url.pathname]();
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};

// 123网盘秒传JSON生成
async function handle123Rapid(request, corsHeaders) {
  try {
    const { shareUrl, sharePassword } = await request.json();
    if (!shareUrl) throw new Error("缺少分享链接");

    const json = await create123RapidTransfer(shareUrl, sharePassword || "");
    return jsonResponse(
      { success: true, rapidTransferJson: json },
      200,
      corsHeaders
    );
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 500, corsHeaders);
  }
}

// 189网盘秒传JSON生成
async function handle189Rapid(request, corsHeaders) {
  try {
    const { shareUrl, sharePassword } = await request.json();
    if (!shareUrl) throw new Error("缺少分享链接");

    const json = await create189RapidTransfer(shareUrl, sharePassword || "");
    return jsonResponse(
      { success: true, rapidTransferJson: json },
      200,
      corsHeaders
    );
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 500, corsHeaders);
  }
}

// 夸克网盘秒传JSON生成
async function handleQuarkRapid(request, corsHeaders) {
  try {
    const { shareUrl, sharePassword, cookie } = await request.json();
    if (!shareUrl) throw new Error("缺少分享链接");
    if (!cookie) throw new Error("请输入夸克网盘Cookie");

    const json = await createQuarkRapidTransfer(
      shareUrl,
      sharePassword || "",
      cookie
    );

    // 检查是否有文件获取到MD5
    const filesWithMd5 = json.files.filter((f) => f.etag).length;
    const totalFiles = json.files.length;

    return jsonResponse(
      {
        success: true,
        rapidTransferJson: json,
        warning:
          filesWithMd5 === 0
            ? "⚠️ 由于CORS限制，无法在Cloudflare Workers中获取MD5值。建议使用Python版本的tgto123。"
            : null,
        stats: {
          total: totalFiles,
          withMd5: filesWithMd5,
          withoutMd5: totalFiles - filesWithMd5,
        },
      },
      200,
      corsHeaders
    );
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 500, corsHeaders);
  }
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json;charset=utf-8" },
  });
}
