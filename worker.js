/*
 * CF-Proxy: 通用代理服务，基于 Cloudflare Workers 实现的无服务器代理加速解决方案，支持访问被墙或受限的 URL。
 * Repo: https://github.com/sinspired/CF-Proxy
 */

const REPO_URL = "https://github.com/sinspired/CF-Proxy";
const RAW_URL = "https://raw.githubusercontent.com/sinspired/CF-Proxy/main";
const SITE_NAME = "CF Proxy - 通用代理加速";

// 需要注入 GitHub Token 的主机列表
const GITHUB_HOSTS = ['api.github.com', 'uploads.github.com'];

// 需要手动处理的重定向状态码
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

// HTML 节点重写器，用于将页面内的相对链接改为代理链接
class DOMRewriter {
    constructor(proxyOrigin, targetBaseUrl) {
        this.proxyOrigin = proxyOrigin;
        this.targetBaseUrl = targetBaseUrl;
    }
    rewrite(element, attr) {
        const val = element.getAttribute(attr);
        // 忽略空值、锚点、JS脚本和 Base64 图片
        if (!val || val.startsWith('javascript:') || val.startsWith('mailto:') || val.startsWith('data:') || val.startsWith('#')) return;
        try {
            // 将相对路径解析为目标域的绝对路径 (如 /index.php -> https://xyy.com/index.php)
            const absUrl = new URL(val, this.targetBaseUrl).toString();
            // 拼上代理的前缀
            element.setAttribute(attr, `${this.proxyOrigin}/${absUrl}`);
        } catch (e) {
            // 解析失败（比如存在语法错误的URL）则保持原样
        }
    }
    element(element) {
        if (element.tagName === 'a') this.rewrite(element, 'href');
        if (element.tagName === 'img') this.rewrite(element, 'src');
        if (element.tagName === 'link') this.rewrite(element, 'href');
        if (element.tagName === 'script') this.rewrite(element, 'src');
        if (element.tagName === 'form') this.rewrite(element, 'action');
        if (element.tagName === 'iframe') this.rewrite(element, 'src');
    }
}

async function handleRequest(request) {
    const url = new URL(request.url);

    // 1. 根目录与静态资源
    if (url.pathname === "/") {
        return new Response(getHtml(url.host), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.svg') {
        return new Response(getLogoSvg(), { headers: { 'Content-Type': 'image/svg+xml' } });
    }
    if (url.pathname === '/preview.png') {
        return fetch(`${RAW_URL}/preview.png`);
    }
    if (url.pathname === '/CF-Proxy_OG.png') {
        return fetch(`${RAW_URL}/CF-Proxy_OG.png`);
    }

    // 2. 内部 API: 纯 Server-Side 网络连通性验证
    if (url.pathname === '/__proxy_check') {
        const domain = url.searchParams.get('domain');
        if (!domain) return new Response(JSON.stringify({ Status: -1, msg: 'Missing domain' }), { status: 400 });
        try {
            const hostname = domain.split(':')[0];
            const dnsHeaders = { 'accept': 'application/dns-json' };
            const [ipv4Resp, ipv6Resp] = await Promise.all([
                fetch(`https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`, { headers: dnsHeaders }),
                fetch(`https://cloudflare-dns.com/dns-query?name=${hostname}&type=AAAA`, { headers: dnsHeaders })
            ]);
            const [ipv4, ipv6] = await Promise.all([ipv4Resp.json(), ipv6Resp.json()]);
            const hasIpv4 = ipv4.Status === 0 && ipv4.Answer && ipv4.Answer.length > 0;
            const hasIpv6 = ipv6.Status === 0 && ipv6.Answer && ipv6.Answer.length > 0;
            const status = (hasIpv4 || hasIpv6) ? 0 : 3;
            return new Response(JSON.stringify({ Status: status }), {
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        } catch (e) {
            return new Response(JSON.stringify({ Status: -1, error: e.message }), {
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }
    }

    // 测试 GitHub Token 配置状态
    // if (url.pathname === '/__debug_gh') {
    //     const ghToken = getGhToken();
    //     const info = {
    //         token_configured: !!ghToken,
    //         // 只暴露前8位用于确认是正确的 Token，后面隐藏以防泄露
    //         token_prefix: ghToken ? ghToken.substring(0, 8) + '...' : null,
    //     };

    //     // 如果 token 存在，实际测一下 GitHub API 的剩余配额
    //     if (ghToken) {
    //         try {
    //             const resp = await fetch('https://api.github.com/rate_limit', {
    //                 headers: {
    //                     'Authorization': `Bearer ${ghToken}`,
    //                     'User-Agent': 'CF-Proxy/Worker'
    //                 }
    //             });
    //             const data = await resp.json();
    //             info.rate_limit = data.rate;
    //         } catch (e) {
    //             info.rate_limit_error = e.message;
    //         }
    //     }
    //     return new Response(JSON.stringify(info, null, 2), {
    //         headers: { 'Content-Type': 'application/json' }
    //     });
    // }

    // 3. 代理逻辑解析
    let actualUrlStr = url.pathname.slice(1) + url.search;

    // Referer 子路径补偿
    // 用于修复页面内 JS 发起的相对路径 AJAX 请求，或 CSS 文件内未被 HTMLRewriter 拦截的相对资源
    const referer = request.headers.get('Referer');
    // 如果存在 Referer 且当前请求看起来像是一个相对路径资源 (没有 http 前缀)
    if (referer && !actualUrlStr.startsWith('http')) {
        try {
            const refererUrl = new URL(referer);
            // 只有当请求是由我们的代理服务发出的（且不在主页）
            if (refererUrl.hostname === url.hostname && refererUrl.pathname.length > 1) {
                let refTarget = refererUrl.pathname.slice(1);
                if (!refTarget.startsWith('http')) {
                    if (refTarget.includes('.')) refTarget = 'https://' + refTarget;
                }
                const baseTargetUrl = new URL(refTarget);
                // 把类似于 /index.php 组合拼装回真实域名的地址
                const resolvedTarget = new URL(url.pathname + url.search, baseTargetUrl).toString();
                // 自动纠正：302 重定向到正确的代理地址
                return Response.redirect(`${url.origin}/${resolvedTarget}`, 302);
            }
        } catch (e) {
            // 解析失败忽略，继续走原有流程
        }
    }

    // 智能补全协议逻辑
    if (!actualUrlStr.startsWith('http')) {
        if (actualUrlStr.includes('.') && !actualUrlStr.startsWith('favicon')) {
            actualUrlStr = 'https://' + actualUrlStr;
        } else {
            return new Response(getHtml(url.host), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
    }

    try {
        const targetUrl = new URL(actualUrlStr);
        // 构建请求头，添加必要的 Host、Referer、Origin 等字段
        const newHeaders = new Headers(request.headers);
        newHeaders.set('Host', targetUrl.host);
        newHeaders.set('Referer', targetUrl.origin);
        newHeaders.set('Origin', targetUrl.origin);

        // 删除可能暴露用户真实 IP 的字段
        ['cf-connecting-ip', 'cf-ipcountry', 'x-forwarded-for', 'x-real-ip'].forEach(h => newHeaders.delete(h));

        // GitHub Token 注入
        if (GITHUB_HOSTS.includes(targetUrl.hostname)) {
            // 使用 globalThis 安全访问 Workers 环境变量，避免 ReferenceError
            const ghToken = getGhToken();
            if (ghToken) {
                newHeaders.set('Authorization', `Bearer ${ghToken}`);
                console.log('[CF-Proxy] GitHub Token injected for:', targetUrl.hostname);
            } else {
                // Token 未配置或为空，记录警告（在 Workers Dashboard 日志可见）
                console.warn('[CF-Proxy] GH_TOKEN is not set or empty, GitHub rate limit may apply.');
            }
            // GitHub API 要求必须有合法的 User-Agent
            newHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36');
        } else {
            if (!newHeaders.get('User-Agent')) {
                newHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36');
            }
        }

        const response = await fetch(new Request(targetUrl.toString(), {
            headers: newHeaders,
            method: request.method,
            body: request.body,
            redirect: 'manual' // 手动处理重定向非常关键
        }));

        // 处理重定向，保持在代理路径下
        if (REDIRECT_CODES.has(response.status)) {
            const location = response.headers.get('location');
            if (location) {
                const redirectUrl = new URL(location, targetUrl).toString();
                return Response.redirect(`${url.origin}/${redirectUrl}`, response.status);
            }
        }

        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        responseHeaders.set('Access-Control-Allow-Headers', '*');
        responseHeaders.delete('Content-Security-Policy');
        responseHeaders.delete('X-Frame-Options');

        let finalResponse = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
        });

        // 实时重写 HTML 中的链接
        const contentType = responseHeaders.get('Content-Type') || '';
        if (contentType.toLowerCase().includes('text/html')) {
            // 当内容是网页时，通过 HTMLRewriter 重写所有的资源链接和 a 标签，使之保持在代理下
            finalResponse = new HTMLRewriter()
                .on('a, img, link, script, form, iframe', new DOMRewriter(url.origin, targetUrl.toString()))
                .transform(finalResponse);
        }

        return finalResponse;
    } catch (e) {
        return new Response(getErrorHtml(e.message, actualUrlStr), {
            status: 500,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }
}

// 安全读取 GitHub Token 环境变量（避免 ReferenceError）
function getGhToken() {
    return (typeof globalThis.GH_TOKEN === 'string' && globalThis.GH_TOKEN.trim())
        ? globalThis.GH_TOKEN.trim()
        : null;
}

// favicon 使用简洁版本
function getLogoSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#01af7b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
}

function getErrorHtml(errorMsg, targetUrl) {
    return `<!DOCTYPE html>
<html lang="zh-CN" id="htmlRoot">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>代理访问失败 - ${SITE_NAME}</title>
    <style>
        :root { --bg: #ffffff; --text: #111111; --text-light: #888888; --line: #eaeaea; --error: #ef4444; }
        @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --text: #f0f0f0; --text-light: #666666; --line: rgba(255,255,255,0.15); } }
        body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; background: var(--bg); color: var(--text); display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; min-height: 100dvh; margin: 0; padding: 20px; text-align: center; }
        .icon { color: var(--error); width: 48px; height: 48px; margin-bottom: 20px; }
        h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 12px; }
        .url { color: var(--text-light); word-break: break-all; margin-bottom: 24px; font-family: ui-monospace, monospace; font-size: 0.95rem; }
        .code { background: rgba(239, 68, 68, 0.08); color: var(--error); padding: 12px 20px; border-radius: 8px; font-family: ui-monospace, monospace; font-size: 0.85rem; margin-bottom: 40px; text-align: left; max-width: 100%; word-break: break-all; border: 1px solid rgba(239, 68, 68, 0.2); }
        a { color: var(--text); text-decoration: none; border-bottom: 1px solid var(--line); padding-bottom: 2px; transition: opacity 0.2s; font-size: 0.95rem; }
        a:hover { opacity: 0.6; }
    </style>
</head>
<body>
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
    <h1>无法访问目标地址</h1>
    <div class="url">${targetUrl}</div>
    <div class="code">Error: ${errorMsg}</div>
    <a href="/">返回首页</a>
</body>
</html>`;
}

function getHtml(host) {
    return `<!DOCTYPE html>
<html lang="zh-CN" id="htmlRoot">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <link rel="icon" href="/favicon.ico" type="image/svg+xml">
    <title>${SITE_NAME}</title>
    <meta name="description" content="基于 Cloudflare Workers 的极简通用代理加速服务。">

    <!-- Open Graph -->
    <meta property="og:title" content="${SITE_NAME}" />
    <meta property="og:description" content="跨越边界，访问任意 URL。" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://${host}/" />
    <meta property="og:image" content="https://${host}/CF-Proxy_OG.png" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${SITE_NAME}" />
    <meta name="twitter:description" content="跨越边界，访问任意 URL。" />
    <meta name="twitter:image" content="https://${host}/CF-Proxy_OG.png" />
    <!-- 主题初始化（防闪烁）：优先 localStorage，其次系统偏好 -->
    <script>(function () { var s = localStorage.getItem('cf-theme'); var dark = s === 'dark' || (s === null && window.matchMedia('(prefers-color-scheme:dark)').matches); if (dark) document.getElementById('htmlRoot').classList.add('dark'); })()</script>

    <!-- 默认主题色（浅色模式） -->
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
    <!-- 深色模式主题色 -->
    <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
    <style>
        :root {
            --primary: #000000;
            --primary-disabled: rgba(0, 0, 0, 0.3);
            --bg: #ffffff;
            --text: #111111;
            --text-light: #888888;
            --line: #c9c9c9;
            --line-focus: rgba(33, 32, 32, 0.374);
            --capsule-bg: rgba(0, 0, 0, 0.04);
            --success: #10b981;
            --error: #ef4444;
            --warn: #f59e0b;
            --orbit-glow: rgba(245, 158, 11, 0.10);
            /* 太阳光晕色 */
        }
        
        html.dark {
            --primary: #ffffff;
            --primary-disabled: rgba(255, 255, 255, 0.25);
            --bg: #0a0a0a;
            --text: #f0f0f0;
            --text-light: #666666;
            --line: rgba(255, 255, 255, 0.20);
            --line-focus: rgba(186, 208, 233, 0.6);
            --capsule-bg: rgba(255, 255, 255, 0.08);
            --orbit-glow: rgba(147, 197, 253, 0.20);
            /* 月亮光晕色 */
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            -webkit-tap-highlight-color: transparent;
        }

        html,
        body {
            overflow-x: hidden;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg);
            color: var(--text);
            min-height: 100vh;
            min-height: 100dvh;
            display: flex;
            flex-direction: column;
            transition: background-color 0.8s ease, color 0.6s ease;
        }

        /* 星空背景（深色专用） */
        #starField {
            position: fixed;
            inset: 0;
            pointer-events: none;
            z-index: 0;
            opacity: 0;
            transition: opacity 1.2s ease;
        }

        html.dark #starField {
            opacity: 0.6;
        }

        /* 主内容区 */
        .main-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            width: 100%;
            max-width: 640px;
            margin: 0 auto;
            text-align: center;
            padding: 50px 24px 80px;
            animation: fadeIn 0.8s ease forwards;
            position: relative;
            z-index: 1;
        }

        h1 {
            font-size: 2.4rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            letter-spacing: -0.03em;
            transition: font-size 0.3s ease;
        }

        .tagline {
            color: var(--text-light);
            font-size: 1.05rem;
            margin-bottom: 4rem;
            letter-spacing: -0.01em;
            transition: color 0.6s ease, font-size 0.3s ease;
        }

        /* 切换按钮 + 悬浮提示 */
        .globe-wrap {
            position: relative;
            display: inline-flex;
            flex-direction: column;
            align-items: center;
            margin-bottom: 0.2rem;
        }

        /* 地球切换按钮 */
        .globe-toggle {
            background: none;
            border: none;
            cursor: pointer;
            padding: 0;
            display: block;
            outline: none;
            transition: transform 0.25s cubic-bezier(0.34, 1.4, 0.64, 1);
            -webkit-tap-highlight-color: transparent;
        }

        .globe-toggle:hover {
            transform: scale(1.06);
        }

        .globe-toggle:active {
            transform: scale(0.93);
        }

        .globe-toggle:focus-visible {
            outline: 1.5px solid var(--primary);
            outline-offset: 6px;
            border-radius: 50%;
        }

        /* 悬停提示（绝对定位，不占文档流空间）*/
        .globe-hint {
            position: absolute;
            bottom: calc(100% + 12px);
            left: 50%;
            transform: translateX(-50%) translateY(4px);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 3px;
            opacity: 0;
            transition: opacity 0.35s ease, transform 0.35s ease;
            pointer-events: none;
            white-space: nowrap;

            /* 卡片 */
            /* -webkit-backdrop-filter: blur(8px);
            backdrop-filter: blur(8px);
            border: 1px solid var(--line);
            padding: 6px 10px;
            border-radius: 10px; */
        }
        /* 桌面端：鼠标悬停显示 */
        @media (hover: hover) {
            .globe-wrap:hover .globe-hint {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
        }
        /* 触屏/桌面端通用：JS 手动触发 */
        .globe-hint.touch-show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
        .globe-hint-time {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 0.78rem;
            letter-spacing: 0.10em;
            color: var(--text);
            transition: color 0.6s ease;
        }
        .globe-hint-action {
            font-size: 0.68rem;
            letter-spacing: 0.06em;
            color: var(--text-light);
            transition: color 0.6s ease;
        }
        
        /* 轨道系统旋转由 JS 驱动（SVG 属性动画）──*/
        /* 使用 rotate(angle, 0, 0) SVG 属性而非 CSS transform，
           明确以 SVG 坐标原点（球心）为旋转轴，无跨浏览器歧义 */

        /* 轨道环 */
        .g-ring {
            fill: none;
            stroke: var(--primary);
            stroke-width: 0.8;
            stroke-dasharray: 2.8 6;
            stroke-linecap: round;
            opacity: 0.18;
            transition: opacity 0.8s ease, stroke 0.8s ease;
        }

        html.dark .g-ring {
            opacity: 0.22;
        }

        /*
         * 统一可见性逻辑
         * 规则：轨道顶部天体 = 升起（明亮），底部天体 = 落下（暗淡）
         * 浅色：太阳在顶(升) → 明亮；月亮在底(落) → 暗淡留影
         * 深色：月亮在顶(升) → 明亮；太阳在底(落) → 暗淡留影
         */

        /* 太阳：浅色=升起明亮，深色=落下暗淡 */
        .g-sun-aura {
            fill: rgba(245, 158, 11, 0.22);
            opacity: 1;
            transition: opacity 0.8s ease;
        }

        html.dark .g-sun-aura {
            opacity: 0.08;
        }

        .g-sun-core {
            fill: #f59e0b;
            opacity: 1;
            transition: fill 0.8s ease, opacity 0.8s ease;
        }

        html.dark .g-sun-core {
            fill: #92400e;
            opacity: 0.18;
        }

        /* 月亮：浅色=落下暗淡留影，深色=升起明亮 */
        .g-moon-aura {
            fill: rgba(147, 197, 253, 0.18);
            opacity: 0.15;
            transition: opacity 0.8s ease;
        }

        html.dark .g-moon-aura {
            opacity: 1;
        }

        .g-moon-face {
            fill: #c8d8ee;
            opacity: 0.20;
            transition: opacity 0.8s ease;
        }

        html.dark .g-moon-face {
            opacity: 1;
        }

        /* 星点：浅色=极淡，深色=明亮 */
        .g-star {
            fill: #93c5fd;
            opacity: 0.15;
            transition: opacity 0.8s ease;
        }

        html.dark .g-star {
            opacity: 0.85;
        }

        /* 地球笔触*/
        .g-globe {
            fill: none;
            stroke: var(--primary);
            stroke-linecap: round;
            transition: stroke 0.8s ease;
        }

        /* 地球外圆 */
        .g-globe-main {
            stroke-width: 2.0;
        }

        /* 赤道线 */
        .g-equator {
            stroke-width: 1.2;
            stroke-opacity: 0.40;
        }

        /* 回归线 */
        .g-tropic {
            stroke-width: 0.75;
            stroke-opacity: 0.28;
            fill: none;
        }

        /* 经线 */
        .g-lng {
            stroke-width: 1.4;
            fill: none;
        }

        /* 输入框区域 */
        form {
            width: 100%;
        }

        .input-group {
            position: relative;
            display: flex;
            align-items: center;
            border-bottom: 1px solid var(--line);
            margin-bottom: 3.5rem;
            padding-bottom: 8px;
            transition: border-color 0.4s ease;
        }

        .input-group:focus-within {
            border-color: var(--line-focus);
            /* Y轴偏移10px，负扩张半径-8px 抵消四周扩散，使其仅显示在底部 */
            box-shadow: 0 10px 15px -8px var(--orbit-glow);
        }

        .input-wrapper {
            flex: 1;
            position: relative;
            display: flex;
            align-items: center;
            min-width: 0;
        }

        /* 状态提示文字 */
        .input-hint {
            position: absolute;
            top: calc(100% + 12px);
            left: 0;
            font-size: 0.8rem;
            color: var(--text-light);
            transition: all 0.3s ease;
            pointer-events: none;
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 4px;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .input-hint.error {
            color: var(--error);
        }

        .input-hint.success {
            color: var(--success);
        }

        .hint-icon {
            width: 14px;
            height: 14px;
            flex-shrink: 0;
        }

        /* 左侧中转胶囊 */
        .transit-capsule {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            width: 0;
            opacity: 0;
            overflow: hidden;
            height: 32px;
            background: var(--capsule-bg);
            border-radius: 6px;
            transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
            cursor: help;
            color: var(--text-light);
            position: relative;
            font-size: 13px;
            font-weight: 500;
        }

        .transit-capsule.active {
            width: 36px;
            opacity: 1;
            overflow: visible;
        }

        .capsule-text {
            white-space: nowrap;
            display: none;
        }

        /* 分割线 */
        .divider {
            width: 2px;
            height: 16px;
            background-color: var(--line);
            border-radius: 1px;
            margin: 0;
            opacity: 0;
            transform: scaleY(0.2);
            transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .divider.active {
            opacity: 1;
            transform: scaleY(1);
            margin: 0 14px 0 10px;
        }

        /* 气泡提示 */
        .tooltip {
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translate(-50%, -8px) scale(0.95);
            background: var(--text);
            color: var(--bg);
            padding: 6px 10px;
            border-radius: 6px;
            font-size: 12px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            pointer-events: none;
            white-space: nowrap;
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            z-index: 100;
        }

        .transit-capsule:hover .tooltip,
        .copy-btn:hover .tooltip {
            opacity: 1;
            transform: translate(-50%, -12px) scale(1);
        }

        .tooltip::after {
            content: '';
            position: absolute;
            top: 100%;
            left: 50%;
            transform: translateX(-50%);
            border: 4px solid transparent;
            border-top-color: var(--text);
        }

        .input-field {
            width: 100%;
            min-width: 0;
            background: transparent;
            border: none;
            outline: none;
            padding: 4px 0;
            font-size: 1.15rem;
            color: var(--text);
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            transition: font-size 0.3s ease, color 0.15s ease;
        }

        .input-field::placeholder {
            color: var(--text-light);
            font-size: 1.1rem;
            opacity: 0.6;
            font-family: inherit;
        }

        /* 右侧复制按钮 */
        .copy-btn {
            width: 0;
            opacity: 0;
            overflow: hidden;
            height: 32px;
            background: transparent;
            border: none;
            color: var(--text-light);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
            position: relative;
        }

        .copy-btn.active {
            width: 32px;
            opacity: 1;
            margin-left: 8px;
            overflow: visible;
        }

        .copy-btn:hover {
            color: var(--text);
        }

        /* 主按钮 */
        .submit-btn {
            background: var(--primary);
            color: var(--bg);
            border: none;
            padding: 14px 44px;
            border-radius: 50px;
            font-size: 0.95rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s ease, background 0.8s ease, color 0.6s ease;
            opacity: 1;
            pointer-events: none;
            display: inline-flex;
            align-items: center;
            gap: 10px;
        }
        
        /* 禁用态：背景透明度单独控制，保持实色背景 */
        html:not(.dark) .submit-btn:not(.ready) {
            background: rgb(224, 224, 224);
            color: var(--primary-disabled);
        }

        html.dark .submit-btn:not(.ready) {
            background: rgb(35, 35, 35);
            color: var(--primary-disabled);
        }

        .submit-btn.ready {
            opacity: 1;
            pointer-events: auto;
        }

        .submit-btn.ready:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
        }

        .status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--primary-disabled);
            transition: background 0.3s;
        }

        .dot-checking {
            background: var(--warn);
            animation: pulse 1.5s infinite ease-in-out;
        }

        .dot-ok {
            background: var(--success);
        }

        @keyframes pulse {

            0%,
            100% {
                opacity: 1;
            }

            50% {
                opacity: 0.4;
            }
        }

        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(8px);
            }

            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        footer {
            padding: 30px 20px;
            font-size: 0.75rem;
            color: var(--text-light);
            text-align: center;
            position: relative;
            z-index: 1;
            transition: color 0.6s ease;
        }

        footer a {
            color: var(--text);
            text-decoration: none;
            border-bottom: 1px dotted var(--text-light);
            transition: opacity 0.2s, color 0.6s ease;
        }

        footer a:hover {
            opacity: 0.7;
        }

        .disclaimer {
            margin-top: 8px;
            opacity: 0.7;
        }

        /* 大屏*/
        @media (min-width: 1024px) {
            .main-container {
                max-width: 800px;
            }

            h1 {
                font-size: 2.8rem;
            }

            .tagline {
                font-size: 1.15rem;
            }

            .input-field {
                font-size: 1.25rem;
            }
        }

        /* 手机端*/
        @media (max-width: 480px) {
            h1 {
                font-size: 2rem;
            }

            .tagline {
                font-size: 0.95rem;
                margin-bottom: 3rem;
            }

            .input-field {
                font-size: 1rem;
            }

            .transit-capsule.active {
                width: 36px;
            }

            .capsule-text {
                display: none;
            }

            .divider.active {
                margin: 0 10px 0 8px;
            }

            .submit-btn {
                padding: 14px 38px;
                width: 100%;
                justify-content: center;
            }

            .tooltip {
                display: none;
            }
        }
    
        /* 高度不足时：压缩其他间距，保留 padding-top（悬浮提示保留空间） */
        @media (max-height: 680px) {
            .main-container {
                padding-bottom: 40px;
            }

            .tagline {
                margin-bottom: 2rem;
            }

            .input-group {
                margin-bottom: 2rem;
            }

            footer {
                padding: 12px 20px;
            }
        }

        @media (max-height: 580px) {
            .main-container {
                padding-bottom: 20px;
            }

            .tagline {
                margin-bottom: 1.2rem;
                font-size: 0.9rem;
            }

            .input-group {
                margin-bottom: 1.5rem;
            }

            h1 {
                font-size: 2rem;
                margin-bottom: 0.3rem;
            }

            footer {
                display: none;
            }
        }
    </style>
</head>

<body>


    <!-- 星空画布（深色模式专用）-->
    <canvas id="starField"></canvas>

    <div class="main-container">


    <!-- 地球轨道主题切换按钮
      ─ 地球始终自转（经度线持续旋转）
      ─ 点击时地球短暂加速，轨道翻转180°
      ─ 太阳落下 / 月亮升起，完成日升月落叙事 -->

    <div class="globe-wrap">
        <button class="globe-toggle" onclick="handleGlobeClick()" aria-label="切换深浅色主题（双击恢复系统主题）">

        <svg id="globeSvg" viewBox="-44 -44 88 88" width="88" height="88" style="overflow:visible" aria-hidden="true">
            <defs>
                <!-- 太阳光晕模糊 -->
                <filter id="gfSun" x="-120%" y="-120%" width="340%" height="340%">
                    <feGaussianBlur stdDeviation="3.5" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
                <!-- 月亮光晕模糊 -->
                <filter id="gfMoon" x="-120%" y="-120%" width="340%" height="340%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
                <!-- 月牙遮罩：右上方偏移的黑圆盖住圆面 -->
                <mask id="gMoonMask">
                    <rect x="-10" y="-10" width="20" height="20" fill="white" />
                    <circle cx="2.8" cy="-2" r="4.5" fill="black" />
                </mask>
            </defs>

            <!-- 轨道虚线环 -->
            <circle cx="0" cy="0" r="40" class="g-ring" />

            <!--  轨道系统（整体旋转 180° 切换主题） -->
            <g id="gOrbit">

                <!-- 太阳（初始在顶部，明亮模式可见）-->
                <g transform="translate(0,-40)">
                    <circle cx="0" cy="0" r="13" class="g-sun-aura" filter="url(#gfSun)" />
                    <circle cx="0" cy="0" r="6.5" class="g-sun-core" />
                    <!-- 高光点 -->
                    <circle cx="-2" cy="-2" r="2" fill="rgba(255,255,255,0.28)" style="pointer-events:none" />
                </g>

                <!-- 月亮（初始在底部，深色模式转至顶部后可见）-->
                <g transform="translate(0,40)">
                    <circle cx="0" cy="0" r="11" class="g-moon-aura" filter="url(#gfMoon)" />
                    <!-- 月牙：整圆 + mask 裁掉右上偏移圆 -->
                    <circle cx="0" cy="0" r="5.5" class="g-moon-face" mask="url(#gMoonMask)" />
                    <!-- 月旁小星 -->
                    <circle cx="-3.5" cy="-4" r="0.65" class="g-star" />
                    <circle cx="5" cy="3.2" r="0.5" class="g-star" />
                    <circle cx="-6" cy="2.8" r="0.45" class="g-star" />
                </g>

            </g><!-- /gOrbit -->

            <!--  地球球体  -->
            <!-- 主圆轮廓 -->
            <circle cx="0" cy="0" r="26" class="g-globe g-globe-main" />

                <!-- 纬度线：赤道 + 南北回归线（静态，衬托球体） -->
                <line x1="-26" y1="0" x2="26" y2="0" class="g-globe g-equator" />
                <ellipse cx="0" cy="-10.4" rx="23.9" ry="6.2" class="g-globe g-tropic" />
                <ellipse cx="0" cy="10.4" rx="23.9" ry="6.2" class="g-globe g-tropic" />

                <!-- 经度线：前景（正面）+ 背景（背面），由 JS 驱动 -->
                <path id="gL0" class="g-globe g-lng" />
                <path id="gL1" class="g-globe g-lng" />
                <path id="gL2" class="g-globe g-lng" />
                <path id="gL3" class="g-globe g-lng" />
                <path id="gL4" class="g-globe g-lng" />
                <path id="gL5" class="g-globe g-lng" />
                <path id="gL6" class="g-globe g-lng" />
                <path id="gL7" class="g-globe g-lng" />
                <!-- 背面经线（极淡，视觉衬底） -->
                <!-- <path id="gB0" class="g-globe g-lng" />
                <path id="gB1" class="g-globe g-lng" />
                <path id="gB2" class="g-globe g-lng" />
                <path id="gB3" class="g-globe g-lng" /> -->

            </svg>
    </button>
    <div class="globe-hint">
        <span class="globe-hint-time" id="globeTime"></span>
        <span class="globe-hint-action" id="globeAction"></span>
    </div>
    </div><!-- /globe-wrap -->

    <h1>Proxy Everything</h1>
    <p class="tagline">跨越边界，访问任意 URL</p>

    <form onsubmit="handleProxy(event)">
        <div class="input-group">
            <div id="capsule" class="transit-capsule">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                    <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                    <line x1="6" y1="6" x2="6.01" y2="6"></line>
                    <line x1="6" y1="18" x2="6.01" y2="18"></line>
                </svg>
                <span class="capsule-text">Proxy</span>
                <div class="tooltip" id="capsuleTooltip">https://${host}/</div>
            </div>

            <div id="divider" class="divider"></div>

            <div class="input-wrapper">
                <input
                    type="text"
                    id="targetUrl"
                    class="input-field"
                    placeholder="输入目标网址..."
                    autocomplete="off"
                    autofocus
                    oninput="checkInput()"
                    onfocus="requestAnimationFrame(() => { this.scrollLeft = this.scrollWidth; })"
                >
                <div id="inputHint" class="input-hint"><span>支持完整 URL 或域名 (如 github.com/sinspired)</span></div>
            </div>

            <button type="button" id="copyBtn" class="copy-btn" onclick="copyResult()">
                <div class="tooltip" id="copyTooltip">生成完整加速链接</div>
                <svg id="copyIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                <svg id="checkIcon" style="display:none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" color="var(--success)" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </button>
        </div>

        <button type="submit" id="mainBtn" class="submit-btn">
            <span id="dot" class="status-dot"></span>
            <span id="btnText">准备就绪</span>
        </button>
    </form>
</div>

<footer>
    <p>Project <a href="${REPO_URL}" target="_blank">CF-Proxy</a> by <a href="https://github.com/sinspired" target="_blank">sinspired</a></p>
    <p class="disclaimer">仅供技术研究与合法用途使用，请勿用于非法行为</p>
</footer>

<script>
    let dnsTimer;
    let lastDomain = '';
    let lastStatus = 0; // 0:空闲, 1:成功, 2:失败
    const hostOrigin = window.location.origin;

    // 缓存高频访问的 DOM 节点，避免重复查询
    const DOM = {
        capsule:        document.getElementById('capsule'),
        divider:        document.getElementById('divider'),
        copyBtn:        document.getElementById('copyBtn'),
        mainBtn:        document.getElementById('mainBtn'),
        dot:            document.getElementById('dot'),
        inputHint:      document.getElementById('inputHint'),
        targetUrl:      document.getElementById('targetUrl'),
        btnText:        document.getElementById('btnText'),
        copyTooltip:    document.getElementById('copyTooltip'),
        capsuleTooltip: document.getElementById('capsuleTooltip'),
        copyIcon:       document.getElementById('copyIcon'),
        checkIcon:      document.getElementById('checkIcon'),
    };

    const iconSuccess = '<svg class="hint-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    const iconWarn    = '<svg class="hint-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';

    const setUI = (state, hintHTML, hintClass = 'input-hint') => {
        const isResolved = state === 'ok' || state === 'fail-bypass';
        DOM.capsule.classList.toggle('active', isResolved);
        DOM.divider.classList.toggle('active', isResolved);
        DOM.copyBtn.classList.toggle('active', isResolved);
        DOM.mainBtn.classList.toggle('ready', isResolved);
        if (state === 'checking')    { DOM.dot.className = 'status-dot dot-checking'; DOM.btnText.textContent = '验证中...'; }
        else if (isResolved)           DOM.dot.className = 'status-dot dot-ok';
        else                           DOM.dot.className = 'status-dot';
        DOM.inputHint.innerHTML  = hintHTML;
        DOM.inputHint.className  = hintClass;

        // 解析完成：滚到末尾
        if (isResolved) requestAnimationFrame(() => { DOM.targetUrl.scrollLeft = DOM.targetUrl.scrollWidth; });
    };

    // 输入监控与初步验证
    function checkInput() {
        const val = DOM.targetUrl.value.trim();

        // 输入过程中始终显示末尾，方便查看完整 URL
        DOM.targetUrl.scrollLeft = DOM.targetUrl.scrollWidth;
        const cleanPath = val.split('?')[0].split('#')[0];
        const isDownload = /\\.(zip|exe|tar|gz|rar|7z|apk|iso|dmg|pkg|msi|bin|ipa)$/i.test(cleanPath);
        if (!val) {
            DOM.btnText.textContent = '准备就绪';
            lastDomain = ''; lastStatus = 0;
            setUI('reset', '<span>支持完整 URL 或域名 (如 github.com/sinspired)</span>');
            return;
        }
        const domain = val.replace(/^https?:\\/\\//, '').split('/')[0];
        const isDomain = domain.includes('.') && domain.split('.').pop().length >= 2;
        if (isDomain) {
            DOM.btnText.textContent = isDownload ? '加速下载' : '加速访问';

            if (domain === lastDomain && lastStatus !== 0) return;
            const fullUrl = val.startsWith('http') ? val : 'https://' + val;
            DOM.copyTooltip.textContent   = hostOrigin + '/' + fullUrl;
            DOM.capsuleTooltip.textContent = hostOrigin + '/';
            lastDomain = domain; lastStatus = 0;
            setUI('checking', '<span>正在由云端解析验证网址...</span>');
            clearTimeout(dnsTimer);
            dnsTimer = setTimeout(() => verifyDomain(domain), 400);
        } else {
            DOM.btnText.textContent = '正在输入';
            lastDomain = ''; lastStatus = 0;
            setUI('reset', iconWarn + '<span>请输入有效的域名或 URL</span>', 'input-hint error');
        }
    }

    // 使用 dns-over-https 在云端验证域名解析，绕过本地 DNS 污染，确保用户输入的地址确实可达
    async function verifyDomain(domain) {
        try {
            const resp = await fetch(\`/__proxy_check?domain=\${encodeURIComponent(domain)}\`);
            const { Status } = await resp.json();
            if (domain !== lastDomain) return;
                const cleanPath = DOM.targetUrl.value.trim().split('?')[0].split('#')[0];
                const isDownload = /\.(zip|exe|tar|gz|rar|7z|apk|iso|dmg|pkg|msi|bin|ipa)$/i.test(cleanPath);
                if (Status === 0) { lastStatus = 1; DOM.btnText.textContent = isDownload ? '加速下载' : '加速访问'; setUI('ok', iconSuccess + '<span>域名解析通过</span>', 'input-hint success'); }
            else              { lastStatus = 2; setUI('fail', iconWarn + '<span>无法解析该域名，请检查网址拼写</span>', 'input-hint error'); }
        } catch (e) {
            if (domain !== lastDomain) return;
            lastStatus = 2;
            const cleanPath = DOM.targetUrl.value.trim().split('?')[0].split('#')[0];
            const isDownload = /\.(zip|exe|tar|gz|rar|7z|apk|iso|dmg|pkg|msi|bin|ipa)$/i.test(cleanPath);
            DOM.btnText.textContent = isDownload ? '加速下载' : '加速访问';
            setUI('fail-bypass', iconWarn + '<span>验证超时，但您可以尝试强行访问</span>', 'input-hint error');
        }
    }

    function copyResult() {
        navigator.clipboard.writeText(DOM.copyTooltip.textContent).then(() => {
            DOM.copyIcon.style.display = 'none';
            DOM.checkIcon.style.display = 'block';
            setTimeout(() => { DOM.copyIcon.style.display = 'block'; DOM.checkIcon.style.display = 'none'; }, 1000);
        });
    }

    // 表单提交处理，打开加速后的链接
    function handleProxy(e) {
        e.preventDefault();
        const val = DOM.targetUrl.value.trim();
        if (val) window.open(hostOrigin + '/' + val, '_blank');
    }

    /* 
        地球动画与主题切换
        */

    // 参数
    const GR    = 26;    // 球体半径（SVG user units）
    const SPEED = 0.30;  // 正常自转速度（度/帧 ≈ 18rpm @60fps）
    const BURST = 5.0;   // 切换时速度倍率
    const BURST_FRAMES = 55; // 加速持续帧数（≈0.9s）

    // 六条经线，相位各偏 30°（180° / 6），任意时刻正面半球始终有 3 条均匀分布
    // 正面经线：在 [0°, 180°] 循环，从左弧扫到右弧（sin>0，弧向右）
    // 背面经线：在 [180°, 360°] 循环，从右弧扫到左弧（sin<0，弧向左）
    // 二者以相同角速度推进 → 共同营造球体持续旋转的立体感
    const lines = [
        { el: document.getElementById('gL0'), phase: 0 },
        { el: document.getElementById('gL1'), phase: 45 },
        { el: document.getElementById('gL2'), phase: 90 },
        { el: document.getElementById('gL3'), phase: 135 },
        { el: document.getElementById('gL4'), phase: 180 },
        { el: document.getElementById('gL5'), phase: 225 },
        { el: document.getElementById('gL6'), phase: 270 },
        { el: document.getElementById('gL7'), phase: 315 },
    ];

    let burstLeft   = 0;

    // 计算经线 SVG path
    // 将角度 deg（绕Y轴旋转的经线方位角）映射为椭圆弧路径
    function lngPath(deg) {
        const rad  = (deg % 360) * Math.PI / 180;
        const sinA = Math.sin(rad);
        const rx   = Math.abs(GR * sinA);
        if (rx < 0.45) {
            // 接近 0° / 180°（子午线/反子午线）时退化为直线
            return \`M 0 \${-GR} L 0 \${GR}\`;
        }
        // 椭圆弧从北极 (0,-R) 到南极 (0,R)
        // sweep=1：前半球（弧向右），sweep=0：后半球（弧向左）
        const sweep = sinA > 0 ? 1 : 0;
        return \`M 0 \${-GR} A \${rx.toFixed(2)} \${GR} 0 0 \${sweep} 0 \${GR}\`;
    }

    // 正对视角（cosA>0）→ 较深；背对（cosA<0）→ 较浅+虚线
    function lngOpacity(deg) {
            const rad = ((deg % 360) + 360) % 360 * Math.PI / 180;
            const cosA = Math.cos(rad);
            if (cosA <= 0) return 0.08;           // 背向观察者 → 极淡
            return 0.25 + cosA * 0.60;           // 前景：边缘0.25，正中0.85
    }

    function lngDash(deg) {
        const cosA = Math.cos((deg % 360) * Math.PI / 180);
        return cosA < -0.1 ? '1.8 3.5' : 'none';
    }

    // 轨道旋转动画（SVG 属性驱动，绕 SVG 坐标原点旋转）
    // SVG rotate(deg, cx, cy) 明确指定轴心为 (0,0)（即球心），
    // 彻底绕开 CSS transform-box 的跨浏览器歧义。
    // 轨道系统：以当前系统时间驱动，每分钟微调一次
    //
    // 角度映射：正午12:00 → 太阳在顶(0°)，午夜00:00 → 太阳在底(180°)
    //   angle = (hours - 12 + 24) % 24 / 24 * 360
    //
    // 手动切换：点击后叠加 ±180° 偏移，之后继续跟随时间漂移
    const gOrbit = document.getElementById('gOrbit');

    // // 按当前主题初始化：深色模式轨道已处于 180°（月亮在顶），浅色在 0°（太阳在顶）
    // const _initDark = document.getElementById('htmlRoot').classList.contains('dark');
    // let orbitCur = _initDark ? 180 : 0;
    // let orbitTarget = orbitCur;

    // // 立即设置初始 SVG 属性，避免页面加载时短暂闪烁
    // gOrbit.setAttribute('transform', \`rotate(\${orbitCur}, 0, 0)\`);


    const htmlRoot = document.getElementById('htmlRoot');

    // 将本地时间转换为轨道角度（度）
    function timeToAngle() {
        const now = new Date();
        const mins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
        // 正午(720min) → 0°，每分钟转 360/1440 = 0.25°
        return ((mins - 720 + 1440) % 1440) / 1440 * 360;
    }

    // 日间判断：太阳在上半轨（-90°~90°，即315°~360°或0°~90°）
    function isDayAngle(deg) {
        const a = ((deg % 360) + 360) % 360;
        return a <= 90 || a >= 270;
    }

    // 初始角度（来自时间）及手动偏移量
    let timeAngle = timeToAngle();
    let manualOffset = 0;          // 手动点击累计的偏移
    let orbitTarget = timeAngle;  // 动画目标（含偏移）
    let orbitCur = timeAngle;  // 当前渲染角度

    // // 按时间初始化轨道位置和主题，避免加载时闪烁
    // const initIsDark = !isDayAngle(timeAngle);
    // if (initIsDark) htmlRoot.classList.add('dark');
    // else htmlRoot.classList.remove('dark');

    // 主题优先级：localStorage > 系统偏好 > 时间
    // 轨道角度与主题状态解耦：轨道永远显示真实时间，主题由用户偏好决定
    function getSystemDark() {
        return window.matchMedia('(prefers-color-scheme:dark)').matches;
    }
    function applyTheme(dark) {
        htmlRoot.classList.toggle('dark', dark);
    }

    // 初始主题（头部脚本已处理，此处仅补全 manualOffset 使轨道与主题对齐）
    const savedTheme = localStorage.getItem('cf-theme');
    const initDark = savedTheme === 'dark' || (savedTheme === null && getSystemDark());
    // 若保存主题与时间主题不一致，说明用户做过手动切换，补偿偏移使轨道方向与主题一致
    const timeDark = !isDayAngle(timeAngle);
    if (initDark !== timeDark) manualOffset = 180;
    orbitTarget = timeAngle + manualOffset;
    orbitCur = orbitTarget;

    gOrbit.setAttribute('transform', \`rotate(\${orbitCur.toFixed(3)}, 0, 0)\`);

    // 缓动函数：cubic-bezier(0.34, 1.08, 0.64, 1) 近似，带轻微弹性过冲
    function easeOrbit(t) {
        // 三次方缓出 + 轻微过冲
        const s = 1 - t;
        return 1 - s * s * s * (1 + t * 1.1);
    }

    let orbitAnimStart = null;
    let orbitAnimFrom = 0;
    const ORBIT_DUR = 1500; // ms

    function stepOrbit(now) {
        if (orbitAnimStart === null) orbitAnimStart = now;
        const t = Math.min((now - orbitAnimStart) / ORBIT_DUR, 1);
        orbitCur = orbitAnimFrom + (orbitTarget - orbitAnimFrom) * easeOrbit(t);

        // SVG rotate(deg, cx, cy)：以 (0,0) 为轴心旋转，即球心
        gOrbit.setAttribute('transform', \`rotate(\${orbitCur.toFixed(3)}, 0, 0)\`);

        if (t < 1) requestAnimationFrame(stepOrbit);
    }

    function startOrbitAnim() {
        orbitAnimFrom = orbitCur;
        orbitAnimStart = null;
        requestAnimationFrame(stepOrbit);
    }


    // 按分钟旋转天体
    // 将 orbitTarget 更新为「真实时间角 + 手动偏移」
    // 每次只漂移极小的角度（≈0.25°/min），动画几乎察觉不到
    function tickTime() {
        timeAngle = timeToAngle();
        orbitTarget = timeAngle + manualOffset;

        // 同步主题：若偏移为0或偶数次翻转，以实际时间判断
        // const effectiveAngle = ((orbitTarget % 360) + 360) % 360;
        // const shouldBeDark = !isDayAngle(effectiveAngle);
        // htmlRoot.classList.toggle('dark', shouldBeDark);

        // 仅当无手动偏移（或偶数次抵消）时，跟随时间自动切换主题
        if (localStorage.getItem('cf-theme') === null) {
            const effectiveAngle = ((orbitTarget % 360) + 360) % 360;
            applyTheme(!isDayAngle(effectiveAngle));
        }

        startOrbitAnim();
    }

    // 对齐到下一整分钟后每分钟触发
    const msToNextMin = (60 - new Date().getSeconds()) * 1000;
    setTimeout(() => { tickTime(); setInterval(tickTime, 60000); }, msToNextMin);

    // ── 地球经线渲染循环 ───────────────────────────────
    // 正面线 [0°,180°)：相位超过 180° → 回绕到 0°（无缝，两端均为竖线）
    // 背面线 [180°,360°)：相位超过 360° → 回绕到 180°
    // 背面线透明度固定极低，正面线透明度随 cos 值变化（侧面自然淡出）
    const BACK_OPACITY = 0.06;
    function animGlobe() {
        const spd    = burstLeft > 0 ? SPEED * BURST : SPEED;
        if (burstLeft > 0) burstLeft--;

        lines.forEach(line => {
                line.phase = (line.phase + spd) % 360;
                line.el.setAttribute('d', lngPath(line.phase));
                line.el.setAttribute('stroke-opacity', lngOpacity(line.phase).toFixed(3));
                line.el.setAttribute('stroke-dasharray', lngDash(line.phase)); 
        });

        requestAnimationFrame(animGlobe);
    }
    animGlobe();

    // ── 单击/双击区分（计时器方案，避免 dblclick 先触发两次 click 的浏览器行为）
    let clickTimer = null;

    function handleGlobeClick() {
        if (clickTimer) {
            // 第二次点击在 300ms 内：判定为双击，执行 resetTheme
            clearTimeout(clickTimer);
            clickTimer = null;
            resetTheme();
        } else {
            clickTimer = setTimeout(() => {
                clickTimer = null;
                toggleTheme();
            }, 300);
        }
    }
            
    // 主题切换
    // 点击叠加 180° 偏移，之后每分钟时间漂移会保持该偏移继续运行
    function toggleTheme() {
        // manualOffset = ((manualOffset + 180) % 360 + 360) % 360; // 归一化，防止无限累加
        manualOffset  += 180;
        orbitTarget    = timeAngle + manualOffset;
        const effectiveAngle = ((orbitTarget % 360) + 360) % 360;
        const dark = !isDayAngle(effectiveAngle);
        applyTheme(dark);
        localStorage.setItem('cf-theme', dark ? 'dark' : 'light');
        startOrbitAnim();

        // 地球同步加速自转：视觉化「旋转带来昼夜更替」
        burstLeft = BURST_FRAMES;
    }

    // 双击：清除保存，恢复系统主题
    function resetTheme(e) {
        localStorage.removeItem('cf-theme');
        const sysDark = getSystemDark();
        applyTheme(sysDark);
        // 重置 manualOffset 使轨道与系统主题对齐
        const timeDark = !isDayAngle(((timeAngle % 360) + 360) % 360);
        manualOffset = sysDark !== timeDark ? 180 : 0;
        orbitTarget = timeAngle + manualOffset;
        startOrbitAnim();
        burstLeft = BURST_FRAMES;
    }

    // 监听系统主题变化（仅在无手动覆盖时响应）
    window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change', e => {
        if (localStorage.getItem('cf-theme') !== null) return; // 用户已手动设置，忽略
        const sysDark = e.matches;
        applyTheme(sysDark);
        const timeDark = !isDayAngle(((timeAngle % 360) + 360) % 360);
        manualOffset = sysDark !== timeDark ? 180 : 0;
        orbitTarget = timeAngle + manualOffset;
        startOrbitAnim();
    });


    // 悬停提示（时间 + 操作说明）
    const globeTimeEl   = document.getElementById('globeTime');
    const globeActionEl = document.getElementById('globeAction');
    let   clockTimer    = null;

    function formatTime() {
        const now = new Date();
        const hh  = String(now.getHours()).padStart(2, '0');
        const mm  = String(now.getMinutes()).padStart(2, '0');
        const ss  = String(now.getSeconds()).padStart(2, '0');
        return \`\${hh}:\${mm}:\${ss}\`;
    }

    function updateHint() {
        globeTimeEl.textContent   = formatTime();
        // 操作提示随当前模式动态变化
        const dark = htmlRoot.classList.contains('dark');
        globeActionEl.textContent = dark ? '切换到白天' : '切换到夜间';
    }

    function startClock() {
        updateHint();
        clockTimer = setInterval(updateHint, 1000);
    }

    function stopClock() {
        clearInterval(clockTimer);
        clockTimer = null;
    }

    const globeWrap = document.querySelector('.globe-wrap');
    const globeHint = document.querySelector('.globe-hint');
    globeWrap.addEventListener('mouseenter', startClock);
    globeWrap.addEventListener('mouseleave', stopClock);
    // 移动端 touch：触摸后短暂显示提示，超时后移除 class 触发 CSS 淡出
    let touchHideTimer = null;
    globeWrap.addEventListener('touchstart', () => {
        startClock();
        globeHint.classList.add('touch-show');
        clearTimeout(touchHideTimer);
        touchHideTimer = setTimeout(() => {
            globeHint.classList.remove('touch-show');
            stopClock();
        }, 1800);
    }, { passive: true });

    /* 星空背景（深色模式）*/
    (function initStars() {
        const cvs = document.getElementById('starField');
        const ctx = cvs.getContext('2d');

        // 生成随机星点数据
        const stars = Array.from({ length: 100 }, () => ({
            x:  Math.random(),
            y:  Math.random(),
            r:  Math.random() * 1.0 + 0.25,
            a:  Math.random() * 0.45 + 0.06,
            s: Math.random() * 0.002 + 0.001 // 随机闪烁速度
        }));

        function draw() {
            cvs.width  = window.innerWidth;
            cvs.height = window.innerHeight;
            ctx.clearRect(0, 0, cvs.width, cvs.height);
            stars.forEach(s => {
                // 使用 sin 函数配合每个星星独有的速度 s 产生闪烁感
                const twinkle = Math.sin(Date.now() * s.s + s.x * 100) * 0.25;
                ctx.beginPath();
                ctx.arc(s.x * cvs.width, s.y * cvs.height, s.r, 0, Math.PI * 2);
                ctx.fillStyle = \`rgba(200, 215, 255, \${Math.max(0.1, s.a + twinkle)})\`;
                ctx.fill();
            });
            requestAnimationFrame(draw);
        }

        draw();
        window.addEventListener('resize', draw);
    })();
</script>
</body>
</html>`;
}