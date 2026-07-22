export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname !== '/') {
			let path = url.pathname;
			let owner = env.GH_NAME;
			let repo = env.GH_REPO;
			let ref = env.GH_BRANCH || 'main';

			// 如果请求路径自带了完整 github 地址，进行提取
			if (/raw\.githubusercontent\.com/i.test(path)) {
				const parts = path.split('raw.githubusercontent.com/')[1].split('/');
				owner = parts[0];
				repo = parts[1];
				ref = parts[2];
				path = '/' + parts.slice(3).join('/');
			}

			// 无缓存 GitHub API 请求 URL
			const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents${path}?ref=${ref}&_t=${Date.now()}`;

			const headers = new Headers({
				'User-Agent': 'Cloudflare-Worker-Proxy',
				'Accept': 'application/vnd.github.v3.raw',
			});

			let authTokenSet = false;

			// TOKEN_PATH 特殊路径鉴权
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

			// 发起 API 请求（全链路禁缓存）
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

				// 基础请求头（禁缓存、支持跨域）
				resHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
				resHeaders.set('Access-Control-Allow-Origin', '*');

				// 只要 URL 带有 ?dl 参数（如 ?dl=1 或 ?dl）就触发下载
				if (url.searchParams.has('dl')) {
					// 从路径提取原始文件名（例如 /a/b/demo.js -> demo.js）
					const rawFilename = path.split('/').pop();
					const filename = rawFilename ? decodeURIComponent(rawFilename) : 'file.txt';

					// 注入 Content-Disposition 响应头，强制浏览器下载并保存为源文件名
					resHeaders.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
					resHeaders.set('Content-Type', 'application/octet-stream');
				} else {
					// 无 dl 参数时保持纯文本展示，方便预览/读取
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
			// 根路径逻辑（重定向或伪装页）
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
