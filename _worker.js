'use strict'

const PREFIX = '/'
const Config = {
    jsdelivr: 0
}

// 原始 gh-proxy 的正则表达式
const exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i
const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i
const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i
const exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i
const exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i
const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i
const exp_list = [exp1, exp2, exp3, exp4, exp5, exp6]

const PREFLIGHT_INIT = {
    status: 204,
    headers: new Headers({
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
        'access-control-max-age': '1728000',
    }),
}

// Pages Functions 的入口点
export default {
    async fetch(request, env, context) {
        const url = new URL(request.url);

        // 兼容 /?q=https://... 的旧用法
        const q = url.searchParams.get('q');
        if (q) {
            return Response.redirect(url.origin + PREFIX + q, 301);
        }

        let path = url.pathname.substring(PREFIX.length);
        
        // 修复 https://... 变为 https:/... 的问题
        if (path.startsWith('https/')) {
            path = 'https://' + path.substring('https/'.length);
        } else if (path.startsWith('http/')) {
            path = 'http://' + path.substring('http/'.length);
        }

        // 检查路径是否是需要代理的 GitHub 链接
        const isProxyable = exp_list.some(exp => path.search(exp) === 0);

        if (isProxyable) {
            // 如果是，则执行代理逻辑
            return handleProxy(request, path);
        }

        // 【关键修改】如果不是代理请求，则直接从项目中获取静态资源 (index.html 等)
        // 这会避免无限循环并正确地返回你的主页
        return env.ASSETS.fetch(request);
    }
}

async function handleProxy(request, pathname) {
    if (request.method === 'OPTIONS') {
        return new Response(null, PREFLIGHT_INIT);
    }
    
    let path = pathname;
    if (path.search(exp2) === 0) {
        if (Config.jsdelivr) {
            const newUrl = path.replace('/blob/', '@').replace(/^(?:https?:\/\/)?github\.com/, 'https://cdn.jsdelivr.net/gh');
            return Response.redirect(newUrl, 302);
        } else {
            path = path.replace('/blob/', '/raw/');
        }
    }

    const reqHdrNew = new Headers(request.headers);
    let host = 'github.com';
    if (path.search(/^https?:\/\/([^/]+\.)?githubusercontent\.com/) !== -1) {
        host = 'raw.githubusercontent.com';
    }
    reqHdrNew.set('host', host);
    reqHdrNew.set('referer', 'https://github.com/');

    const reqInit = {
        method: request.method,
        headers: reqHdrNew,
        redirect: 'manual',
        body: request.body
    };

    const res = await fetch(path, reqInit);
    const resHdrOld = res.headers;
    const resHdrNew = new Headers(resHdrOld);

    if (res.status >= 300 && res.status < 400 && resHdrNew.has('location')) {
        const location = resHdrNew.get('location');
        if (exp_list.some(exp => location.search(exp) === 0)) {
            resHdrNew.set('location', PREFIX + location);
        }
    }

    resHdrNew.set('access-control-expose-headers', '*');
    resHdrNew.set('access-control-allow-origin', '*');
    resHdrNew.delete('content-security-policy');
    resHdrNew.delete('content-security-policy-report-only');
    resHdrNew.delete('clear-site-data');

    return new Response(res.body, {
        status: res.status,
        headers: resHdrNew,
    });
}
