/**
 * CF-Proxy: 通用代理服务
 * Repo: https://github.com/sinspired/CF-Proxy
 */

const REPO_URL = "https://github.com/sinspired/CF-Proxy";
const RAW_URL = "https://raw.githubusercontent.com/sinspired/CF-Proxy/main";
const SITE_NAME = "Universal Proxy";

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

    // 2. 静态资源 (Favicon)
    if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.svg') {
        return new Response(getLogoSvg(), {
            headers: { 'Content-Type': 'image/svg+xml' }
        });
    }

    // 3. 拦截预览图请求 (让社交分享链接生效)
    if (url.pathname === '/preview.png') {
        return fetch(`${RAW_URL}/preview.png`);
    }

    // 4. 代理逻辑
    let actualUrlStr = url.pathname.slice(1) + url.search;

    // 智能补全协议
    if (!actualUrlStr.startsWith('http')) {
        if (actualUrlStr.includes('.') && !actualUrlStr.startsWith('favicon')) {
            actualUrlStr = 'https://' + actualUrlStr;
        } else {
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

        // GitHub Token 注入逻辑
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
        return new Response(JSON.stringify({
            status: 'Error',
            message: 'Failed to fetch the target URL.',
            detail: e.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
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

function getHtml(host) {
    const logoSvg = getLogoSvg();

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" href="/favicon.ico" type="image/svg+xml">
    
    <!-- SEO & Social Media -->
    <title>${SITE_NAME} - 极简通用代理</title>
    <meta name="description" content="基于 Cloudflare Workers 的极简通用代理服务。跨越边界，访问任意 URL。">
    <meta name="keywords" content="proxy, cloudflare workers, 代理, 跨域, github加速">
    
    <!-- Open Graph -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://${host}/">
    <meta property="og:title" content="${SITE_NAME} - Proxy Everything">
    <meta property="og:description" content="跨越边界，访问任意 URL。">
    <!-- 指向 Worker 自身的预览图路径，后端会自动去 GitHub 拉取 -->
    <meta property="og:image" content="https://${host}/preview.png">

    <style>
        :root {
            --bg: #ffffff;
            --text: #111111;
            --text-light: #666666;
            --line: #e5e5e5;
            --accent: #000000;
            --error: #e63946;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --bg: #0a0a0a;
                --text: #ffffff;
                --text-light: #888888;
                --line: #333333;
                --accent: #ffffff;
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
            color: var(--text);
            transition: color 0.3s;
        }

        h1 {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            letter-spacing: -1px;
        }

        .tagline {
            color: var(--text-light);
            font-size: 1rem;
            margin-bottom: 3rem;
            font-weight: 400;
        }

        .input-wrapper {
            position: relative;
            /* 增加了底部间距，从 2rem 改为 3.5rem */
            /* 这样为绝对定位的提示文字留出了足够的呼吸空间，避免与按钮挤在一起 */
            margin-bottom: 3.5rem; 
            text-align: left;
        }

        .input-field {
            width: 100%;
            background: transparent;
            border: none;
            border-bottom: 2px solid var(--line);
            padding: 15px 0;
            font-size: 1.25rem;
            color: var(--text);
            border-radius: 0;
            outline: none;
            transition: border-color 0.3s ease;
            font-family: monospace;
        }

        .input-field::placeholder {
            color: var(--line);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .input-field:focus {
            border-bottom-color: var(--accent);
        }

        .input-hint {
            position: absolute;
            top: 100%;
            left: 0;
            margin-top: 12px; /* 稍微增加一点与横线的距离 */
            font-size: 0.85rem; /* 稍微调大一点字号 */
            color: var(--text-light);
            opacity: 0;
            transform: translateY(-5px);
            transition: all 0.3s ease;
            white-space: nowrap; /* 防止手机上文字意外换行 */
            overflow: hidden;
            text-overflow: ellipsis;
            width: 100%;
        }

        .input-field:focus + .input-hint,
        .input-field:not(:placeholder-shown) + .input-hint {
            opacity: 1;
            transform: translateY(0);
        }

        .btn-go {
            background: var(--text);
            color: var(--bg);
            border: none;
            padding: 14px 36px; /* 稍微加大按钮尺寸 */
            font-size: 1rem;
            font-weight: 600;
            border-radius: 50px;
            cursor: pointer;
            transition: transform 0.2s, opacity 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .btn-go:hover {
            opacity: 0.9;
            transform: scale(1.02);
        }

        .btn-go:active {
            transform: scale(0.98);
        }

        footer {
            margin-top: 5rem; /* 底部 footer 也稍微拉开一点距离 */
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
            border-bottom: 1px solid var(--text);
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
                >
                <div class="input-hint">支持完整 URL 或域名 (如 github.com/sinspired)</div>
            </div>

            <button type="submit" class="btn-go">
                开始访问 <span>&rarr;</span>
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

    <script>
        function handleProxy(e) {
            e.preventDefault();
            const input = document.getElementById('targetUrl');
            let url = input.value.trim();
            
            if (!url) {
                input.style.borderBottomColor = 'var(--error)';
                setTimeout(() => {
                    input.style.borderBottomColor = ''; 
                }, 1000);
                return;
            }

            const currentOrigin = window.location.origin;
            window.location.href = currentOrigin + '/' + url;
        }
    </script>
</body>
</html>`;
}