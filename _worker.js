export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname !== '/') {
			let path = url.pathname;
			let owner = env.GH_NAME;
			let repo = env.GH_REPO;
			let ref = env.GH_BRANCH || 'main';

			if (/raw\.githubusercontent\.com/i.test(path)) {
				const parts = path.split('raw.githubusercontent.com/')[1].split('/');
				owner = parts[0];
				repo = parts[1];
				ref = parts[2];
				path = '/' + parts.slice(3).join('/');
			}

			// 无缓存 GitHub API 链接
			const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents${path}?ref=${ref}&_t=${Date.now()}`;

			const headers = new Headers({
				'User-Agent': 'Cloudflare-Worker-Proxy',
				'Accept': 'application/vnd.github.v3.raw',
			});

			let authTokenSet = false;

			// TOKEN_PATH 校验
			if (env.TOKEN_PATH) {
				const 需要鉴权的路径配置 = await ADD(env.TOKEN_PATH);
				const normalizedPathname = decodeURIComponent(url.pathname.toLowerCase());

				for (const pathConfig of 需要鉴权的路径配置) {
					const configParts = pathConfig.split('@');
					if (configParts.length !== 2) continue;

					const [requiredToken, pathPart] = configParts;
					const normalizedPath = '/' + pathPart.toLowerCase().trim();

					const pathMatches = normalizedPathname === normalizedPath ||
						normalizedPathname.startsWith(normalizedPath + '/');

					if (pathMatches) {
						const providedToken = url.searchParams.get('token');
						if (!providedToken) return new Response('TOKEN不能为空', { status: 400 });
						if (providedToken !== requiredToken.trim()) return new Response('TOKEN错误', { status: 403 });

						if (!env.GH_TOKEN) return new Response('服务器GitHub TOKEN配置错误', { status: 500 });
						headers.set('Authorization', `token ${env.GH_TOKEN}`);
						authTokenSet = true;
						break;
					}
				}
			}

			// 默认 Token 校验
			if (!authTokenSet) {
				let githubToken = url.searchParams.get('token') || env.GH_TOKEN || env.TOKEN;
				if (!githubToken) {
					return new Response('TOKEN不能为空', { status: 400 });
				}
				headers.set('Authorization', `token ${githubToken}`);
			}

			// 请求 GitHub API
			const response = await fetch(apiUrl, {
				headers,
				cf: {
					cacheTtlByStatus: { "200-299": -1, "400-599": 0 },
					cacheEverything: false
				}
			});

			if (response.ok) {
				const textData = await response.text();
				const resHeaders = new Headers();

				// 1. 无缓存设置
				resHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
				resHeaders.set('Access-Control-Allow-Origin', '*');

				// 2. 判断是预览还是下载
				if (url.searchParams.has('dl')) {
					// 加了 ?dl 参数 -> 触发下载
					const filename = path.split('/').pop() || 'file.txt';
					resHeaders.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
					resHeaders.set('Content-Type', 'application/octet-stream');
				} else {
					// 没加 ?dl 参数 -> 纯文本预览
					resHeaders.set('Content-Type', 'text/plain; charset=utf-8');
				}

				return new Response(textData, { status: 200, headers: resHeaders });
			} else {
				const errorText = env.ERROR || '无法获取文件，检查路径或TOKEN是否正确。';
				return new Response(errorText, {
					status: response.status,
					headers: { 'Content-Type': 'text/plain; charset=utf-8' }
				});
			}

		} else {
			// 首页重定向或伪装
			const envKey = env.URL302 ? 'URL302' : (env.URL ? 'URL' : null);
			if (envKey) {
				const URLs = await ADD(env[envKey]);
				const URL = URLs[Math.floor(Math.random() * URLs.length)];
				return envKey === 'URL302' ? Response.redirect(URL, 302) : fetch(new Request(URL, request));
			}

			return new Response(await nginx(), {
				headers: {
					'Content-Type': 'text/html; charset=UTF-8',
					'Cache-Control': 'no-store, no-cache'
				},
			});
		}
	}
};

async function nginx() {
	return `<!DOCTYPE html><html><head><title>Welcome to nginx!</title><style>body { width: 35em; margin: 0 auto; font-family: Tahoma, Verdana, Arial, sans-serif; }</style></head><body><h1>Welcome to nginx!</h1><p>If you see this page, the nginx web server is successfully installed and working.</p></body></html>`;
}

async function ADD(envadd) {
	var addtext = envadd.replace(/[	|"'\r\n]+/g, ',').replace(/,+/g, ',');
	if (addtext.charAt(0) == ',') addtext = addtext.slice(1);
	if (addtext.charAt(addtext.length - 1) == ',') addtext = addtext.slice(0, addtext.length - 1);
	return addtext.split(',');
}
