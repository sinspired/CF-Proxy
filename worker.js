/**
 * CF-Proxy: 通用代理服务 (完全定制版)
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

    // 3. 代理逻辑
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

        // 清理 CF 特有头部['cf-connecting-ip', 'cf-ipcountry', 'x-forwarded-for', 'x-real-ip'].forEach(h => newHeaders.delete(h));

        const modifiedRequest = new Request(targetUrl.toString(), {
            headers: newHeaders,
            method: request.method,
            body: request.body,
            redirect: 'manual'
        });

        const response = await fetch(modifiedRequest);

        // 处理重定向 (解决 github.cc 等跳转站导致的 SSL 问题)
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
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>失败 - ${SITE_NAME}</title><style>body{font-family:system-ui;text-align:center;padding:50px;color:#ef4444;background:#fff} .code{font-family:monospace;background:#f3f4f6;padding:10px;border-radius:5px;display:inline-block;color:#666}</style></head><body><h1>无法访问目标地址</h1><p>${targetUrl}</p><div class="code">错误信息: ${errorMsg}</div><br><br><a href="/">返回首页</a></body></html>`;
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
    <style>
        :root {
            --primary: #000000; --bg: #ffffff; --text: #111111; --text-light: #666666; --line: #e5e5e5;
            --capsule-bg: rgba(0,0,0,0.05); --btn-disabled: #e5e5e5;
        }
        @media (prefers-color-scheme: dark) {
            :root { --primary: #ffffff; --bg: #0a0a0a; --text: #ffffff; --text-light: #888888; --line: #333333; --capsule-bg: rgba(255,255,255,0.1); --btn-disabled: #333333; }
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        /* 页面整体采用 Flex 布局以实现底部沉底 */
        body {
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
            background-color: var(--bg); color: var(--text);
            min-height: 100vh; display: flex; flex-direction: column;
            transition: background 0.3s;
        }

        /* 主体容器居中且填满剩余空间 */
        .main-container { 
            flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
            width: 100%; max-width: 600px; margin: 0 auto; text-align: center; animation: fadeIn 0.8s ease;
            padding: 20px 20px 60px 20px;
        }

        .logo-wrapper { margin-bottom: 1.5rem; display: inline-block; }
        .logo-svg { width: 64px; height: 64px; color: var(--primary); }

        h1 { font-size: 2.5rem; font-weight: 700; margin-bottom: 0.5rem; letter-spacing: -1px; }
        .tagline { color: var(--text-light); font-size: 1rem; margin-bottom: 3.5rem; }

        /* --- 输入框区域 --- */
        form { width: 100%; }
        .input-group {
            position: relative; display: flex; align-items: center;
            border-bottom: 2px solid var(--line); margin-bottom: 4rem;
            transition: border-color 0.4s;
        }
        .input-group:focus-within { border-color: var(--primary); }

        .input-wrapper {
            flex: 1; position: relative; display: flex; align-items: center;
        }

        /* 底部提示文字 */
        .input-hint {
            position: absolute; top: calc(100% + 10px); left: 0;
            font-size: 0.8rem; color: var(--text-light);
            transition: color 0.3s, opacity 0.3s; pointer-events: none;
            white-space: nowrap;
        }
        .input-hint.error { color: #ef4444; }
        .input-hint.success { color: #10b981; }

        /* 左侧中转胶囊 (更换为云朵图标) */
        .transit-capsule {
            display: flex; align-items: center; justify-content: center;
            width: 0; opacity: 0; overflow: hidden; height: 32px;
            background: var(--capsule-bg); border-radius: 8px;
            transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
            cursor: help; color: var(--text-light); position: relative;
        }
        .transit-capsule.active { width: 48px; opacity: 1; }

        /* 胶囊与网址之间的分割线 | */
        .divider {
            width: 2px; height: 18px; background-color: var(--line); border-radius: 2px;
            margin: 0; opacity: 0; transform: scaleY(0.5); transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .divider.active { opacity: 1; transform: scaleY(1); margin: 0 15px 0 10px; }

        /* 通用气泡提示 */
        .tooltip {
            position: absolute; bottom: 150%; left: 50%; transform: translateX(-50%) translateY(10px);
            background: var(--text); color: var(--bg); padding: 6px 12px; border-radius: 6px;
            font-size: 12px; font-family: monospace; pointer-events: none; white-space: nowrap;
            opacity: 0; transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 100;
        }
        .transit-capsule:hover .tooltip, .copy-btn:hover .tooltip { opacity: 1; transform: translateX(-50%) translateY(0); }
        .tooltip::after { content:''; position:absolute; top:100%; left:50%; transform:translateX(-50%); border:5px solid transparent; border-top-color:var(--text); }

        .input-field {
            width: 100%; background: transparent; border: none; outline: none;
            padding: 12px 0; font-size: 1.15rem; color: var(--text);
            font-family: monospace;
        }

        /* 右侧复制按钮 */
        .copy-btn {
            width: 0; opacity: 0; overflow: hidden; height: 32px;
            background: transparent !important; border: none; color: var(--text-light);
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            transition: all 0.4s; position: relative;
        }
        .copy-btn.active { width: 40px; opacity: 1; margin-left: 10px; }
        .copy-btn:hover { color: var(--text); background: transparent; }

        /* --- 主按钮 --- */
        .submit-btn {
            background: var(--primary); color: var(--bg);
            border: none; padding: 14px 48px; border-radius: 50px;
            font-size: 1rem; font-weight: 600; cursor: pointer;
            transition: all 0.3s; opacity: 0.2; pointer-events: none;
            display: inline-flex; align-items: center; gap: 10px;
        }
        .submit-btn.ready { opacity: 1; pointer-events: auto; }
        .submit-btn.ready:hover { transform: scale(1.03); }

        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #ccc; }
        .dot-checking { background: #f59e0b; animation: blink 1s infinite; }
        .dot-ok { background: #10b981; }

        @keyframes blink { 50% { opacity: 0.3; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } }

        /* 页脚沉底 */
        footer { padding: 30px 20px; font-size: 0.8rem; color: var(--text-light); text-align: center; }
        footer a { color: var(--text); text-decoration: none; border-bottom: 1px dotted var(--text-light); }
        .disclaimer { margin-top: 10px; font-size: 0.75rem; opacity: 0.7; }
    </style>
</head>
<body>
    <div class="main-container">
        <div class="logo-wrapper"><div class="logo-svg">${logoSvg}</div></div>

        <h1>Proxy Everything</h1>
        <p class="tagline">跨越边界，访问任意 URL</p>

        <form onsubmit="handleProxy(event)">
            <div class="input-group">
                <div id="capsule" class="transit-capsule">
                    <!-- 云朵图标代表云端代理 -->
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path>
                    </svg>
                    <div class="tooltip" id="capsuleTooltip">https://${host}/</div>
                </div>
                
                <!-- 优雅的分割线 -->
                <div id="divider" class="divider"></div>

                <div class="input-wrapper">
                    <input type="text" id="targetUrl" class="input-field" placeholder="输入目标网址..." autocomplete="off" autofocus oninput="checkInput()">
                    <div id="inputHint" class="input-hint">支持完整 URL 或域名 (如 github.com/sinspired)</div>
                </div>
                
                <button type="button" id="copyBtn" class="copy-btn" onclick="copyResult()">
                    <div class="tooltip" id="copyTooltip">生成完整加速链接...</div>
                    <svg id="copyIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    <svg id="checkIcon" style="display:none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" color="#10b981"><polyline points="20 6 9 17 4 12"></polyline></svg>
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
        let lastCheckedDomain = '';   // 记录上次查过的域名
        let lastDomainStatus = 0;     // 状态机: 0-未检查 1-成功 2-失败
        const hostOrigin = window.location.origin;

        function checkInput() {
            const input = document.getElementById('targetUrl');
            const capsule = document.getElementById('capsule');
            const divider = document.getElementById('divider');
            const copyTooltip = document.getElementById('copyTooltip');
            const capsuleTooltip = document.getElementById('capsuleTooltip');

            let val = input.value.trim();
            if (!val) {
                lastCheckedDomain = '';
                lastDomainStatus = 0;
                resetUI();
                return;
            }

            // 动态挂载精准提示文本
            const protocolStr = val.startsWith('http') ? val : 'https://' + val;
            copyTooltip.textContent = hostOrigin + '/' + protocolStr;
            capsuleTooltip.textContent = hostOrigin + '/';

            // 提取主域名
            let domain = val.replace(/^https?:\\/\\//, '').split('/')[0];
            let isPossibleDomain = domain.includes('.') && domain.split('.').pop().length >= 2;
            
            if (isPossibleDomain) {
                capsule.classList.add('active');
                divider.classList.add('active');
                
                // 【核心逻辑】如果在输入 / 之后的路径，主域名没变，直接复用已有状态，拒绝查询浪费
                if (domain === lastCheckedDomain && lastDomainStatus !== 0) {
                    return; 
                }

                // 域名变更或第一次输入，重置状态并进入检查中
                lastCheckedDomain = domain;
                lastDomainStatus = 0;
                setCheckingUI();
                
                clearTimeout(dnsTimer);
                dnsTimer = setTimeout(() => verifyDomain(domain), 500);
            } else {
                lastCheckedDomain = '';
                lastDomainStatus = 0;
                resetUI();
                const hint = document.getElementById('inputHint');
                hint.textContent = '请输入有效的域名或 URL';
                hint.className = 'input-hint';
            }
        }

        function setCheckingUI() {
            document.getElementById('dot').className = 'status-dot dot-checking';
            document.getElementById('mainBtn').classList.remove('ready');
            document.getElementById('copyBtn').classList.remove('active');
            const hint = document.getElementById('inputHint');
            hint.textContent = '正在解析验证...';
            hint.className = 'input-hint';
        }

        function resetUI() {
            document.getElementById('capsule').classList.remove('active');
            document.getElementById('divider').classList.remove('active');
            document.getElementById('mainBtn').classList.remove('ready');
            document.getElementById('copyBtn').classList.remove('active');
            document.getElementById('dot').className = 'status-dot';
            
            const hint = document.getElementById('inputHint');
            hint.textContent = '支持完整 URL 或域名 (如 github.com/sinspired)';
            hint.className = 'input-hint';
        }

        async function verifyDomain(domain) {
            const mainBtn = document.getElementById('mainBtn');
            const copyBtn = document.getElementById('copyBtn');
            const dot = document.getElementById('dot');
            const hint = document.getElementById('inputHint');
            
            try {
                const resp = await fetch(\`https://cloudflare-dns.com/dns-query?name=\${domain}&type=A\`, {
                    headers: { 'accept': 'application/dns-json' }
                });
                const data = await resp.json();
                
                if (data.Status === 0) {
                    lastDomainStatus = 1; // 成功
                    dot.className = 'status-dot dot-ok';
                    mainBtn.classList.add('ready');
                    copyBtn.classList.add('active');
                    
                    hint.textContent = '✅ 域名解析通过';
                    hint.className = 'input-hint success';
                } else {
                    lastDomainStatus = 2; // 失败
                    dot.className = 'status-dot';
                    mainBtn.classList.remove('ready');
                    copyBtn.classList.remove('active');
                    
                    hint.textContent = '⚠ 无法解析该域名，请检查网址拼写';
                    hint.className = 'input-hint error';
                }
            } catch (e) {
                lastDomainStatus = 2;
                dot.className = 'status-dot';
                mainBtn.classList.add('ready'); 
                copyBtn.classList.add('active');
                
                hint.textContent = '⚠ 验证超时，但您可以尝试强行访问';
                hint.className = 'input-hint error';
            }
        }

        function copyResult() {
            const val = document.getElementById('targetUrl').value.trim();
            const fullUrl = hostOrigin + '/' + (val.startsWith('http') ? val : 'https://' + val);
            navigator.clipboard.writeText(fullUrl).then(() => {
                const iconCopy = document.getElementById('copyIcon');
                const iconCheck = document.getElementById('checkIcon');
                iconCopy.style.display = 'none';
                iconCheck.style.display = 'block';
                setTimeout(() => {
                    iconCopy.style.display = 'block';
                    iconCheck.style.display = 'none';
                }, 2000);
            });
        }

        function handleProxy(e) {
            e.preventDefault();
            const val = document.getElementById('targetUrl').value.trim();
            if (val) window.open(hostOrigin + '/' + val, '_blank');
        }
    </script>
</body>
</html>`;
}