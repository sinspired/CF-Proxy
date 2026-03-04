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

    // 如果没有输入协议，判断是否需要显示主页
    if (!actualUrlStr.startsWith('http')) {
        // 如果包含点号且不是静态资源，尝试补全 https
        if (actualUrlStr.includes('.') && !actualUrlStr.startsWith('favicon')) {
            actualUrlStr = 'https://' + actualUrlStr;
        } else {
            // 否则返回主页
            return new Response(getHtml(url.host), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
    }

    try {
        const targetUrl = new URL(actualUrlStr);

        const newHeaders = new Headers(request.headers);
        newHeaders.set('Host', targetUrl.host);
        newHeaders.set('Referer', targetUrl.origin);
        newHeaders.set('Origin', targetUrl.origin);
        newHeaders.delete('cf-connecting-ip');
        newHeaders.delete('cf-ipcountry');
        newHeaders.delete('x-forwarded-for');
        newHeaders.delete('x-real-ip');

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
        // --- 返回美化的错误页面，而不是 JSON 或 CF 错误页 ---
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

// 错误页面
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
        h1 { font-size: 1.5rem; margin-bottom: 1rem; }
        p { color: #666; margin-bottom: 2rem; max-width: 500px; word-break: break-all; }
        .btn { padding: 10px 24px; border: 1px solid var(--line); border-radius: 50px; text-decoration: none; color: var(--text); transition: 0.2s; }
        .btn:hover { border-color: var(--text); }
    </style>
</head>
<body>
    <h1>访问目标地址失败</h1>
    <p>无法连接到: <strong>${targetUrl}</strong><br><br>错误信息: ${errorMsg}</p>
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <style>
        :root {
            --primary: #000000;
            --primary-hover: #333333;
            --bg: #ffffff;
            --text: #111111;
            --text-light: #666666;
            --line: #e5e5e5;
            --error: #ef4444;
            --success: #22c55e;
            
            --btn-text: #ffffff;
            --btn-disabled-bg: #f3f4f6;
            --btn-disabled-text: #d1d5db;
            
            --code-bg: #f9fafb;
            --code-border: #e5e7eb;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --primary: #ffffff;
                --primary-hover: #e5e5e5;
                --bg: #0a0a0a;
                --text: #ffffff;
                --text-light: #888888;
                --line: #333333;
                
                --btn-text: #000000;
                --btn-disabled-bg: #1f1f1f;
                --btn-disabled-text: #444444;
                
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
        }

        .logo-wrapper {
            margin-bottom: 1.5rem;
            display: inline-block;
        }
        .logo-svg {
            width: 64px;
            height: 64px;
            color: var(--primary);
            transition: all 0.3s;
        }

        h1 {
            font-size: 2.2rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            letter-spacing: -0.5px;
        }

        .tagline {
            color: var(--text-light);
            font-size: 1rem;
            margin-bottom: 2.5rem;
            font-weight: 400;
        }

        .input-wrapper {
            position: relative;
            /* 关键修改：增加底部间距，把提示文字的位置空出来 */
            margin-bottom: 3rem; 
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

        .input-field::placeholder {
            color: var(--line);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .input-field:focus {
            border-bottom-color: var(--primary);
        }

        /* 提示文字 */
        .input-hint {
            position: absolute;
            top: 100%;
            left: 0;
            margin-top: 10px;
            font-size: 0.8rem;
            color: var(--text-light);
            opacity: 0.8; /* 常驻显示但淡一点 */
            transition: all 0.3s ease;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            width: 100%;
        }
        
        /* 聚焦时提示文字高亮 */
        .input-field:focus + .input-hint {
            opacity: 1;
            color: var(--text);
        }

        /* --- 链接预览区域 (改进版) --- */
        .link-preview {
            /* 初始状态：高度为0，隐藏 */
            max-height: 0;
            opacity: 0;
            overflow: hidden;
            transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            margin-bottom: 0;
            text-align: left;
        }

        .link-preview.visible {
            /* 展开状态 */
            max-height: 120px; /* 足够容纳内容的高度 */
            opacity: 1;
            margin-bottom: 2rem; /* 撑开与下方按钮的距离 */
            margin-top: 0.5rem; /* 与上方提示文字拉开一点距离 */
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

        .preview-box:hover {
            border-color: var(--text-light);
            background-color: var(--bg);
        }

        .preview-content {
            flex: 1;
            overflow: hidden;
        }

        .preview-label {
            display: block;
            font-size: 0.7rem;
            color: var(--text-light);
            margin-bottom: 4px;
        }

        .preview-text {
            display: block;
            font-family: monospace;
            font-size: 0.85rem;
            color: var(--text);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .copy-icon {
            color: var(--text-light);
            flex-shrink: 0;
        }

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
            /* 确保按钮在最上层 */
            position: relative;
            z-index: 10;
        }

        .btn-go:hover {
            background-color: var(--primary-hover);
            transform: translateY(-1px);
        }

        .btn-go:active {
            transform: scale(0.98);
        }

        .btn-go:disabled {
            background-color: var(--btn-disabled-bg);
            color: var(--btn-disabled-text);
            cursor: not-allowed;
            transform: none;
        }

        /* Toast */
        .toast {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            background-color: var(--primary);
            color: var(--btn-text);
            padding: 10px 24px;
            border-radius: 50px;
            font-size: 0.9rem;
            opacity: 0;
            transition: all 0.3s;
            pointer-events: none;
            z-index: 100;
        }

        .toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }

        footer {
            margin-top: 5rem;
            font-size: 0.8rem;
            color: var(--text-light);
        }

        footer a {
            color: var(--text);
            text-decoration: none;
            border-bottom: 1px dotted var(--text-light);
            transition: border-bottom 0.2s;
        }

        footer a:hover {
            color: var(--primary);
            border-bottom: 1px solid var(--primary);
        }

        .disclaimer {
            margin-top: 10px;
            font-size: 0.75rem;
            opacity: 0.7;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
</head>
<body>
    <div class="main-container">
        <div class="logo-wrapper">
            <div class="logo-svg">${logoSvg}</div>
        </div>

        <h1>Proxy Everything</h1>
        <p class="tagline">跨越边界，访问任意 URL</p>

        <form onsubmit="handleProxy(event)">
            <div class="input-wrapper">
                <input 
                    type="text" 
                    id="targetUrl" 
                    class="input-field" 
                    placeholder="输入目标网址..." 
                    autocomplete="off" 
                    autofocus
                    oninput="checkInput()"
                >
                <div class="input-hint">支持完整 URL 或域名 (如 github.com)</div>
            </div>

            <!-- 代理链接生成/预览区域 (移到了 Input 下方，Button 上方) -->
            <div id="linkPreview" class="link-preview">
                <div class="preview-box" onclick="copyLink()">
                    <div class="preview-content">
                        <span class="preview-label">点击复制加速链接:</span>
                        <span id="generatedUrl" class="preview-text"></span>
                    </div>
                    <svg class="copy-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </div>
            </div>

            <button type="submit" id="btnGo" class="btn-go" disabled>
                代理访问 <span>&rarr;</span>
            </button>
        </form>

        <footer>
            <p>
                Project <a href="${REPO_URL}" target="_blank">CF-Proxy</a> by <a href="https://github.com/sinspired" target="_blank">sinspired</a>
            </p>
            <p class="disclaimer">
                仅供技术研究与合法用途使用，请勿用于非法行为。
            </p>
        </footer>
    </div>

    <div id="toast" class="toast">已复制到剪贴板</div>

    <script>
        document.addEventListener('DOMContentLoaded', checkInput);

        // 简单的域名正则：字母数字开头，中间可以有连字符，必须包含至少一个点，结尾是字母
        const domainRegex = /^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+$/;
        // 简单的 URL 正则
        const urlRegex = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;

        function checkInput() {
            const input = document.getElementById('targetUrl');
            const btn = document.getElementById('btnGo');
            const preview = document.getElementById('linkPreview');
            const generatedUrlSpan = document.getElementById('generatedUrl');
            
            let val = input.value.trim();

            // 1. 基本校验：不为空，不包含空格
            let isValid = val.length > 0 && !val.includes(' ');
            
            // 2. 格式校验：至少包含一个点，且看起来像域名或URL
            // 这里放宽一点条件，只要有点号且不是纯数字/符号乱码即可，
            // 避免过于严格的正则误杀一些子域名或特殊TLD
            if (isValid) {
                // 如果没有协议头，尝试匹配域名格式
                if (!val.startsWith('http')) {
                    isValid = val.includes('.') && val.length > 3 && val.indexOf('.') < val.length - 1; 
                }
            }

            if (isValid) {
                // 输入合法
                btn.removeAttribute('disabled');
                
                // 构造完整代理 URL
                let target = val;
                if (!target.startsWith('http')) {
                    target = 'https://' + target;
                }
                const fullProxyUrl = window.location.origin + '/' + target;
                
                generatedUrlSpan.textContent = fullProxyUrl;
                preview.classList.add('visible');
            } else {
                // 输入不合法
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