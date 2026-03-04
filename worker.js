/**
 * CF-Proxy: 通用代理服务 (极简优雅定制版)
 * Repo: https://github.com/sinspired/CF-Proxy
 */

const REPO_URL = "https://github.com/sinspired/CF-Proxy";
const SITE_NAME = "CF Proxy - 通用代理加速";

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    const url = new URL(request.url);

    // 1. 根目录与静态资源
    if (url.pathname === "/") {
        return new Response(getHtml(url.host), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.svg') {
        return new Response(getLogoSvg(), { headers: { 'Content-Type': 'image/svg+xml' } });
    }

    // 2. 代理逻辑解析
    let actualUrlStr = url.pathname.slice(1) + url.search;
    if (!actualUrlStr.startsWith('http')) {
        if (actualUrlStr.includes('.') && !actualUrlStr.startsWith('favicon')) {
            actualUrlStr = 'https://' + actualUrlStr;
        } else {
            return new Response(getHtml(url.host), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
    }

    try {
        const targetUrl = new URL(actualUrlStr);
        const newHeaders = new Headers(request.headers);
        newHeaders.set('Host', targetUrl.host);
        newHeaders.set('Referer', targetUrl.origin);
        newHeaders.set('Origin', targetUrl.origin);

        // 清理 CF 特有追踪头部['cf-connecting-ip', 'cf-ipcountry', 'x-forwarded-for', 'x-real-ip'].forEach(h => newHeaders.delete(h));

        const response = await fetch(new Request(targetUrl.toString(), {
            headers: newHeaders,
            method: request.method,
            body: request.body,
            redirect: 'manual'
        }));

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
        responseHeaders.delete('Content-Security-Policy');
        responseHeaders.delete('X-Frame-Options');

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
        });
    } catch (e) {
        return new Response(getErrorHtml(e.message, actualUrlStr), {
            status: 500,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }
}

function getLogoSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
}

function getErrorHtml(errorMsg, targetUrl) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>失败 - ${SITE_NAME}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;padding:50px;color:#ef4444;background:#fff;line-height:1.6} .code{font-family:monospace;background:#f3f4f6;padding:12px 20px;border-radius:8px;display:inline-block;color:#666;margin-top:10px} a{color:#000;text-decoration:none;border-bottom:1px solid #ccc;padding-bottom:2px}</style></head><body><h1>代理访问失败</h1><p>${targetUrl}</p><div class="code">${errorMsg}</div><br><br><a href="/">返回首页</a></body></html>`;
}

function getHtml(host) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <link rel="icon" href="/favicon.ico" type="image/svg+xml">
    <title>${SITE_NAME}</title>
    <style>
        :root {
            --primary: #000000; --bg: #ffffff; --text: #111111; --text-light: #888888; --line: #eaeaea;
            --capsule-bg: rgba(0,0,0,0.04); --success: #10b981; --error: #ef4444; --warn: #f59e0b;
        }
        @media (prefers-color-scheme: dark) {
            :root { 
                --primary: #ffffff; --bg: #0a0a0a; --text: #f0f0f0; --text-light: #666666; --line: #222222; 
                --capsule-bg: rgba(255,255,255,0.08); 
            }
        }

        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg); color: var(--text);
            min-height: 100vh; display: flex; flex-direction: column;
            transition: background 0.4s ease;
        }

        .main-container { 
            flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
            width: 100%; max-width: 640px; margin: 0 auto; text-align: center; 
            padding: 20px 24px 80px; animation: fadeIn 0.8s ease forwards;
        }

        /* 优化 Logo 尺寸，更克制优雅 */
        .logo-svg { width: 56px; height: 56px; color: var(--primary); margin-bottom: 1.2rem; }
        
        h1 { font-size: 2.4rem; font-weight: 700; margin-bottom: 0.5rem; letter-spacing: -0.03em; }
        .tagline { color: var(--text-light); font-size: 1.05rem; margin-bottom: 4rem; letter-spacing: -0.01em; }

        /* --- 输入框区域 --- */
        form { width: 100%; }
        .input-group {
            position: relative; display: flex; align-items: center;
            border-bottom: 1px solid var(--line); margin-bottom: 3.5rem; padding-bottom: 8px;
            transition: border-color 0.4s ease;
        }
        .input-group:focus-within { border-color: var(--primary); }
        .input-wrapper { flex: 1; position: relative; display: flex; align-items: center; }

        /* 状态提示文字 */
        .input-hint {
            position: absolute; top: calc(100% + 12px); left: 0;
            font-size: 0.8rem; color: var(--text-light);
            transition: all 0.3s ease; pointer-events: none; white-space: nowrap;
        }
        .input-hint.error { color: var(--error); }
        .input-hint.success { color: var(--success); }

        /* 左侧中转胶囊 (Server + Text) */
        .transit-capsule {
            display: flex; align-items: center; justify-content: center; gap: 6px;
            width: 0; opacity: 0; overflow: hidden; height: 32px;
            background: var(--capsule-bg); border-radius: 6px;
            transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
            cursor: help; color: var(--text-light); position: relative;
            font-size: 13px; font-weight: 500;
        }
        .transit-capsule.active { width: 76px; opacity: 1; overflow: visible; }
        .capsule-text { white-space: nowrap; }

        /* 优雅分割线 */
        .divider {
            width: 1px; height: 16px; background-color: var(--line); border-radius: 1px;
            margin: 0; opacity: 0; transform: scaleY(0.2); 
            transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .divider.active { opacity: 1; transform: scaleY(1); margin: 0 14px 0 10px; }

        /* 气泡提示 (极简黑白) */
        .tooltip {
            position: absolute; bottom: 100%; left: 50%; transform: translate(-50%, -8px) scale(0.95);
            background: var(--text); color: var(--bg); padding: 6px 10px; border-radius: 6px;
            font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; 
            pointer-events: none; white-space: nowrap; opacity: 0; 
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 0 4px 12px rgba(0,0,0,0.1); z-index: 100;
        }
        .transit-capsule:hover .tooltip, .copy-btn:hover .tooltip { opacity: 1; transform: translate(-50%, -12px) scale(1); }
        .tooltip::after { 
            content:''; position:absolute; top:100%; left:50%; transform:translateX(-50%); 
            border:4px solid transparent; border-top-color:var(--text); 
        }

        .input-field {
            width: 100%; background: transparent; border: none; outline: none;
            padding: 4px 0; font-size: 1.15rem; color: var(--text);
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        .input-field::placeholder { color: var(--text-light); opacity: 0.5; font-family: inherit; }

        /* 右侧复制按钮 */
        .copy-btn {
            width: 0; opacity: 0; overflow: hidden; height: 32px;
            background: transparent; border: none; color: var(--text-light);
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1); position: relative;
        }
        .copy-btn.active { width: 32px; opacity: 1; margin-left: 8px; overflow: visible; }
        .copy-btn:hover { color: var(--text); }

        /* --- 主按钮 --- */
        .submit-btn {
            background: var(--primary); color: var(--bg);
            border: none; padding: 14px 44px; border-radius: 50px;
            font-size: 0.95rem; font-weight: 500; cursor: pointer;
            transition: all 0.3s ease; opacity: 0.2; pointer-events: none;
            display: inline-flex; align-items: center; gap: 10px;
        }
        .submit-btn.ready { opacity: 1; pointer-events: auto; }
        .submit-btn.ready:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,0.1); }

        .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-light); transition: background 0.3s; }
        .dot-checking { background: var(--warn); animation: pulse 1.5s infinite ease-in-out; }
        .dot-ok { background: var(--success); }

        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

        /* 沉底页脚 */
        footer { padding: 30px 20px; font-size: 0.75rem; color: var(--text-light); text-align: center; }
        footer a { color: var(--text); text-decoration: none; border-bottom: 1px dotted var(--text-light); transition: opacity 0.2s; }
        footer a:hover { opacity: 0.7; }
        .disclaimer { margin-top: 8px; opacity: 0.6; }

        /* 移动端精致适配 */
        @media (max-width: 480px) {
            h1 { font-size: 2rem; }
            .tagline { font-size: 0.95rem; margin-bottom: 3rem; }
            .input-field { font-size: 1rem; }
            .transit-capsule.active { width: 36px; } 
            .capsule-text { display: none; } 
            .divider.active { margin: 0 10px 0 8px; }
            .submit-btn { padding: 14px 38px; width: 100%; justify-content: center; }
            .tooltip { display: none; } 
        }
    </style>
</head>
<body>
    <div class="main-container">
        <div class="logo-svg">${getLogoSvg()}</div>
        <h1>Proxy Everything</h1>
        <p class="tagline">跨越边界，访问任意 URL</p>

        <form onsubmit="handleProxy(event)">
            <div class="input-group">
                <div id="capsule" class="transit-capsule">
                    <!-- 极简服务器/节点图标 -->
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
                    <input type="text" id="targetUrl" class="input-field" placeholder="输入目标网址..." autocomplete="off" autofocus oninput="checkInput()">
                    <div id="inputHint" class="input-hint">支持完整 URL 或域名 (如 github.com/sinspired)</div>
                </div>
                
                <button type="button" id="copyBtn" class="copy-btn" onclick="copyResult()">
                    <div class="tooltip" id="copyTooltip">生成完整加速链接</div>
                    <svg id="copyIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    <svg id="checkIcon" style="display:none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" color="var(--success)" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </button>
            </div>

            <button type="submit" id="mainBtn" class="submit-btn">
                <span id="dot" class="status-dot"></span>
                <span id="btnText">代理访问</span>
            </button>
        </form>
    </div>

    <footer>
        <p>Project <a href="${REPO_URL}" target="_blank">CF-Proxy</a> by <a href="https://github.com/sinspired" target="_blank">sinspired</a></p>
        <p class="disclaimer">仅供技术研究与合法用途使用，请勿用于非法行为。</p>
    </footer>

    <script>
        let dnsTimer;
        let lastDomain = '';
        let lastStatus = 0; // 0:空闲, 1:成功, 2:失败
        const hostOrigin = window.location.origin;

        const el = (id) => document.getElementById(id);
        const setUI = (state, hintText, hintClass = 'input-hint') => {
            el('capsule').classList.toggle('active', state !== 'reset');
            el('divider').classList.toggle('active', state !== 'reset');
            el('copyBtn').classList.toggle('active', state === 'ok' || state === 'fail-bypass');
            el('mainBtn').classList.toggle('ready', state === 'ok' || state === 'fail-bypass');
            
            const dot = el('dot');
            dot.className = state === 'checking' ? 'status-dot dot-checking' : 
                            state === 'ok' ? 'status-dot dot-ok' : 'status-dot';
            
            const hint = el('inputHint');
            hint.textContent = hintText;
            hint.className = hintClass;
        };

        function checkInput() {
            const val = el('targetUrl').value.trim();
            
            // 智能识别文件下载链接，实时切换按钮文本
            const cleanPath = val.split('?')[0].split('#')[0];
            const isDownload = /\\.(zip|exe|tar|gz|rar|7z|apk|iso|dmg|pkg|msi|bin|ipa)$/i.test(cleanPath);
            el('btnText').textContent = isDownload ? '代理下载' : '代理访问';

            if (!val) {
                lastDomain = ''; lastStatus = 0;
                setUI('reset', '支持完整 URL 或域名 (如 github.com/sinspired)');
                return;
            }

            el('copyTooltip').textContent = hostOrigin + '/' + (val.startsWith('http') ? val : 'https://' + val);
            el('capsuleTooltip').textContent = hostOrigin + '/';

            const domain = val.replace(/^https?:\\/\\//, '').split('/')[0];
            const isDomain = domain.includes('.') && domain.split('.').pop().length >= 2;
            
            if (isDomain) {
                if (domain === lastDomain && lastStatus !== 0) return; 

                lastDomain = domain; lastStatus = 0;
                setUI('checking', '正在解析验证...');
                
                clearTimeout(dnsTimer);
                dnsTimer = setTimeout(() => verifyDomain(domain), 400);
            } else {
                lastDomain = ''; lastStatus = 0;
                setUI('reset', '请输入有效的域名或 URL', 'input-hint error');
            }
        }

        async function verifyDomain(domain) {
            try {
                const resp = await fetch(\`https://cloudflare-dns.com/dns-query?name=\${domain}&type=A\`, { headers: { 'accept': 'application/dns-json' } });
                const { Status } = await resp.json();
                
                if (Status === 0) {
                    lastStatus = 1;
                    setUI('ok', '✅ 域名解析通过', 'input-hint success');
                } else {
                    lastStatus = 2;
                    setUI('fail', '⚠ 无法解析该域名，请检查网址拼写', 'input-hint error');
                }
            } catch (e) {
                lastStatus = 2;
                setUI('fail-bypass', '⚠ 验证超时，但您可以尝试强行访问', 'input-hint error');
            }
        }

        function copyResult() {
            navigator.clipboard.writeText(el('copyTooltip').textContent).then(() => {
                el('copyIcon').style.display = 'none';
                el('checkIcon').style.display = 'block';
                setTimeout(() => {
                    el('copyIcon').style.display = 'block';
                    el('checkIcon').style.display = 'none';
                }, 2000);
            });
        }

        function handleProxy(e) {
            e.preventDefault();
            const val = el('targetUrl').value.trim();
            if (val) window.open(hostOrigin + '/' + val, '_blank');
        }
    </script>
</body>
</html>`;
}