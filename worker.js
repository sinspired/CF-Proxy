/**
 * CF-Proxy: 通用代理服务
 * Repo: https://github.com/sinspired/CF-Proxy
 */

const REPO_URL = "https://github.com/sinspired/CF-Proxy";
const RAW_URL = "https://raw.githubusercontent.com/sinspired/CF-Proxy/main";
const SITE_NAME = "CF Proxy - 通用代理加速";

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    const url = new URL(request.url);

    // 1. 根目录返回 UI 页面
    if (url.pathname === "/") {
        return new Response(getHtml(url.host), {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }

    // 2. 静态资源
    if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.svg') {
        return new Response(getLogoSvg(), {
            headers: { 'Content-Type': 'image/svg+xml' }
        });
    }
    if (url.pathname === '/preview.png') {
        return fetch(`${RAW_URL}/preview.png`);
    }

    // 3. 代理逻辑
    let actualUrlStr = url.pathname.slice(1) + url.search;

    // 智能补全协议逻辑
    if (!actualUrlStr.startsWith('http')) {
        // 如果看起来像域名（包含点，且不是 favicon），尝试补全
        if (actualUrlStr.includes('.') && !actualUrlStr.startsWith('favicon')) {
            actualUrlStr = 'https://' + actualUrlStr;
        } else {
            // 否则返回首页
            return new Response(getHtml(url.host), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
    }

    try {
        const targetUrl = new URL(actualUrlStr);

        // 构建请求头
        const newHeaders = new Headers(request.headers);
        newHeaders.set('Host', targetUrl.host);
        newHeaders.set('Referer', targetUrl.origin);
        newHeaders.set('Origin', targetUrl.origin);
        newHeaders.delete('cf-connecting-ip');
        newHeaders.delete('cf-ipcountry');
        newHeaders.delete('x-forwarded-for');
        newHeaders.delete('x-real-ip');

        // GitHub Token 注入
        if (targetUrl.hostname === 'api.github.com' && typeof GH_TOKEN !== 'undefined') {
            newHeaders.set('Authorization', `Bearer ${GH_TOKEN}`);
            newHeaders.set('User-Agent', 'CF-Proxy/Worker');
        } else {
            if (!newHeaders.get('User-Agent')) {
                newHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36');
            }
        }

        const modifiedRequest = new Request(targetUrl.toString(), {
            headers: newHeaders,
            method: request.method,
            body: request.body,
            redirect: 'manual'
        });

        const response = await fetch(modifiedRequest);

        // 处理重定向
        if ([301, 302, 303, 307, 308].includes(response.status)) {
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

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
        });

    } catch (e) {
        // 捕获 DNS 解析失败、连接超时等错误，返回美化的错误页面
        return new Response(getErrorHtml(e.message, actualUrlStr), {
            status: 500,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }
}

function getLogoSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
    </svg>`;
}

// 错误页面 HTML
function getErrorHtml(errorMsg, targetUrl) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>访问失败 - ${SITE_NAME}</title>
    <style>
        :root { --bg: #ffffff; --text: #111111; --line: #e5e5e5; }
        @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --text: #ffffff; --line: #333333; } }
        body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; text-align: center; }
        h1 { font-size: 1.5rem; margin-bottom: 1rem; font-weight: 700; }
        p { color: #888; margin-bottom: 2rem; max-width: 500px; word-break: break-all; line-height: 1.6; }
        .error-code { background: #fef2f2; color: #ef4444; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
        @media (prefers-color-scheme: dark) { .error-code { background: #331111; color: #fca5a5; } }
        .btn { padding: 10px 30px; border: 1px solid var(--line); border-radius: 50px; text-decoration: none; color: var(--text); transition: 0.2s; font-size: 0.9rem; }
        .btn:hover { border-color: var(--text); background: var(--text); color: var(--bg); }
    </style>
</head>
<body>
    <h1>无法访问目标地址</h1>
    <p>Worker 无法连接到: <strong>${targetUrl}</strong><br><span style="font-size:0.85em; opacity:0.8;">错误信息: <span class="error-code">${errorMsg}</span></span></p>
    <a href="/" class="btn">返回首页</a>
</body>
</html>`;
}

function getHtml(host) {
    const logoSvg = getLogoSvg();

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" href="/favicon.ico" type="image/svg+xml">
    
    <title>${SITE_NAME}</title>
    <meta name="description" content="基于 Cloudflare Workers 的极简通用代理加速服务。">
    
    <meta property="og:type" content="website">
    <meta property="og:title" content="${SITE_NAME}">
    <meta property="og:description" content="跨越边界，访问任意 URL。">
    <meta property="og:image" content="https://${host}/preview.png">

    <style>
        :root {
            /* 浅色模式 */
            --primary: #000000;
            --primary-hover: #333333;
            --bg: #ffffff;
            --text: #111111;
            --text-light: #666666;
            --line: #e5e5e5;
            --error: #ef4444;
            
            --btn-text: #ffffff;
            --btn-disabled-bg: #e5e5e5;
            --btn-disabled-text: #999999;
            
            --code-bg: #f9fafb;
            --code-border: #e5e7eb;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                /* 深色模式 */
                --primary: #ffffff;
                --primary-hover: #e5e5e5;
                --bg: #0a0a0a;
                --text: #ffffff;
                --text-light: #888888;
                --line: #333333;
                
                --btn-text: #000000;
                --btn-disabled-bg: #333333;
                --btn-disabled-text: #666666;
                
                --code-bg: #111111;
                --code-border: #333333;
            }
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg);
            color: var(--text);
            height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 20px;
            transition: background 0.3s, color 0.3s;
        }

        .main-container {
            width: 100%;
            max-width: 600px;
            text-align: center;
            animation: fadeIn 0.8s ease-out;
            position: relative;
        }

        .logo-wrapper { margin-bottom: 1.5rem; display: inline-block; }
        .logo-svg { width: 64px; height: 64px; color: var(--primary); transition: all 0.3s; }

        h1 { font-size: 2.5rem; font-weight: 700; margin-bottom: 0.5rem; letter-spacing: -1px; }
        .tagline { color: var(--text-light); font-size: 1rem; margin-bottom: 3rem; font-weight: 400; }

        .input-wrapper {
            position: relative;
            margin-bottom: 1rem; /* 减小这个间距，因为 preview 区域会撑开 */
            text-align: left;
        }

        .input-field {
            width: 100%;
            background: transparent;
            border: none;
            border-bottom: 2px solid var(--line);
            padding: 12px 0;
            font-size: 1.15rem;
            color: var(--text);
            border-radius: 0;
            outline: none;
            transition: all 0.3s ease;
            font-family: monospace;
        }
        .input-field::placeholder { color: var(--line); font-family: -apple-system, sans-serif; }
        .input-field:focus { border-bottom-color: var(--primary); }

        .input-hint {
            position: absolute;
            top: 100%;
            left: 0;
            margin-top: 8px;
            font-size: 0.8rem;
            color: var(--text-light);
            transition: all 0.3s ease;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            width: 100%;
        }

        /* --- 链接预览区域 --- */
        .link-preview {
            max-height: 0;
            opacity: 0;
            overflow: hidden;
            transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            margin-bottom: 0;
            text-align: left;
            margin-top: 1.5rem; /* 初始顶部间距 */
        }

        .link-preview.visible {
            max-height: 150px;
            opacity: 1;
            margin-bottom: 2.5rem; /* 展开后撑开底部按钮 */
        }

        .preview-box {
            background-color: var(--code-bg);
            border: 1px dashed var(--code-border);
            border-radius: 8px;
            padding: 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            cursor: pointer;
            transition: border-color 0.2s, background-color 0.2s;
        }
        .preview-box:hover { border-color: var(--text-light); background-color: var(--bg); }

        .preview-content { flex: 1; overflow: hidden; }
        .preview-label { display: block; font-size: 0.7rem; color: var(--text-light); margin-bottom: 4px; }
        .preview-text { display: block; font-family: monospace; font-size: 0.85rem; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .copy-icon { color: var(--text-light); flex-shrink: 0; }

        /* --- 按钮 --- */
        .btn-go {
            background: var(--primary);
            color: var(--btn-text);
            border: none;
            padding: 14px 40px;
            font-size: 1rem;
            font-weight: 600;
            border-radius: 50px;
            cursor: pointer;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        .btn-go:hover { background-color: var(--primary-hover); transform: translateY(-1px); }
        .btn-go:active { transform: scale(0.98); }
        .btn-go:disabled { background-color: var(--btn-disabled-bg); color: var(--btn-disabled-text); cursor: not-allowed; transform: none; }

        .toast {
            position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%) translateY(20px);
            background-color: var(--primary); color: var(--btn-text); padding: 10px 24px; border-radius: 50px;
            font-size: 0.9rem; opacity: 0; transition: all 0.3s; pointer-events: none; z-index: 100;
        }
        .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

        footer { margin-top: 4rem; font-size: 0.8rem; color: var(--text-light); }
        footer a { color: var(--text); text-decoration: none; border-bottom: 1px dotted var(--text-light); transition: border-bottom 0.2s; }
        footer a:hover { color: var(--primary); border-bottom: 1px solid var(--primary); }
        .disclaimer { margin-top: 10px; font-size: 0.75rem; opacity: 0.7; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    </style>
</head>
<body>
    <div class="main-container">
        <div class="logo-wrapper"><div class="logo-svg">${logoSvg}</div></div>

        <h1>Proxy Everything</h1>
        <p class="tagline">跨越边界，访问任意 URL</p>

        <form onsubmit="handleProxy(event)">
            <div class="input-wrapper">
                <input type="text" id="targetUrl" class="input-field" placeholder="输入目标网址..." autocomplete="off" autofocus oninput="checkInput()">
                <div class="input-hint">支持完整 URL 或域名 (如 github.com)</div>
            </div>

            <div id="linkPreview" class="link-preview">
                <div class="preview-box" onclick="copyLink()">
                    <div class="preview-content">
                        <span class="preview-label">点击复制加速链接:</span>
                        <span id="generatedUrl" class="preview-text"></span>
                    </div>
                    <svg class="copy-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </div>
            </div>

            <button type="submit" id="btnGo" class="btn-go" disabled>代理访问 <span>&rarr;</span></button>
        </form>

        <footer>
            <p>Project <a href="${REPO_URL}" target="_blank">CF-Proxy</a> by <a href="https://github.com/sinspired" target="_blank">sinspired</a></p>
            <p class="disclaimer">仅供技术研究与合法用途使用，请勿用于非法行为。</p>
        </footer>
    </div>
    <div id="toast" class="toast">已复制到剪贴板</div>

    <script>
        document.addEventListener('DOMContentLoaded', checkInput);

        function checkInput() {
            const input = document.getElementById('targetUrl');
            const btn = document.getElementById('btnGo');
            const preview = document.getElementById('linkPreview');
            const generatedUrlSpan = document.getElementById('generatedUrl');
            
            let val = input.value.trim();

            // --- 网址校验 ---
            let isValid = false;

            if (val && !val.includes(' ')) {
                // 1. 去除协议头，只保留域名+路径
                let domainPart = val;
                if (domainPart.startsWith('https://')) {
                    domainPart = domainPart.slice(8);
                } else if (domainPart.startsWith('http://')) {
                    domainPart = domainPart.slice(7);
                }

                // 2. 提取主机名（去掉路径和查询参数）
                // 例如: github.com/sinspired -> github.com
                const slashIndex = domainPart.indexOf('/');
                let host = (slashIndex !== -1) ? domainPart.substring(0, slashIndex) : domainPart;

                // 3. 校验主机名：
                // - 必须包含点号 (.)
                // - 不能以点号开头或结尾 (排除 .com 或 google.com.)
                // - 长度大于 3 (排除 a.b 这种极短的，通常域名至少 x.xx)
                if (host.includes('.') && 
                    !host.startsWith('.') && 
                    !host.endsWith('.') && 
                    host.length > 3) {
                    isValid = true;
                }
            }

            if (isValid) {
                btn.removeAttribute('disabled');
                
                let target = val;
                if (!target.startsWith('http')) {
                    target = 'https://' + target;
                }
                const fullProxyUrl = window.location.origin + '/' + target;
                generatedUrlSpan.textContent = fullProxyUrl;
                preview.classList.add('visible');
            } else {
                btn.setAttribute('disabled', 'true');
                preview.classList.remove('visible');
            }
        }

        function copyLink() {
            const urlText = document.getElementById('generatedUrl').textContent;
            if (!urlText) return;
            navigator.clipboard.writeText(urlText).then(showToast);
        }

        function showToast() {
            const toast = document.getElementById('toast');
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2000);
        }

        function handleProxy(e) {
            e.preventDefault();
            const input = document.getElementById('targetUrl');
            let url = input.value.trim();
            if (!url) return;
            const currentOrigin = window.location.origin;
            window.location.href = currentOrigin + '/' + url;
        }
    </script>
</body>
</html>`;
}