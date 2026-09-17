export default {
	async fetch(request, env) {
		// 1. 处理 OPTIONS 预检请求（解决挂梯子时的 CORS 跨域拦截）
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': '*',
					'Access-Control-Max-Age': '86400',
				},
			});
		}

		const url = new URL(request.url);

		if (url.pathname !== '/') {
			let path = url.pathname;
			let owner = env.GH_NAME;
			let repo = env.GH_REPO;
			let ref = env.GH_BRANCH || 'main';

			// 解析 ://githubusercontent.com 链接
			const decodedPath = decodeURIComponent(path);
			if (/raw\.githubusercontent\.com/i.test(decodedPath)) {
				const rawPart = decodedPath.split(/raw\.githubusercontent\.com\//i);
				if (rawPart) {
					const parts = rawPart.split('/');
					if (parts.length >= 3) {
						owner = parts;
						repo = parts;
						ref = parts;
						path = '/' + parts.slice(3).join('/');
					}
				}
			}

			// 无缓存 GitHub API 请求 URL
			const apiUrl = `https://github.com{owner}/${repo}/contents${path}?ref=${ref}&_t=${Date.now()}`;

			const headers = new Headers({
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Cloudflare-Worker',
				'Accept': 'application/vnd.github.v3.raw',
				// 【修改点 1】强迫 GitHub 必须返回最新数据，不使用其 ETag 缓存
				'Cache-Control': 'no-cache, no-store, must-revalidate',
				'Pragma': 'no-cache',
				'If-None-Match': '' 
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
					// 【修改点 2】显式要求 Cloudflare 边缘节点绝对不要缓存此请求
					cacheTtl: -1, 
					cacheTtlByStatus: { "200-299": -1, "400-599": 0 },
					cacheEverything: false
				}
			});

			if (response.ok) {
				const textData = await response.text();
				const resHeaders = new Headers();

				// 【修改点 3】最高级别的禁缓存响应头，覆盖 GitHub 返回的任何 ETag / Last-Modified
				resHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
				resHeaders.set('Pragma', 'no-cache');
				resHeaders.set('Expires', '0');
				resHeaders.set('Access-Control-Allow-Origin', '*');
				resHeaders.set('Access-Control-Allow-Headers', '*');

				// 解析原始文件名与后缀
				const rawFilename = path.split('/').pop();
				const filename = rawFilename ? decodeURIComponent(rawFilename) : 'file.txt';
				const ext = filename.split('.').pop().toLowerCase();

				// 常见 MIME 类型映射表
				const mimeTypes = {
					'txt': 'text/plain; charset=utf-8',
					'html': 'text/html; charset=utf-8',
					'css': 'text/css; charset=utf-8',
					'js': 'application/javascript; charset=utf-8',
					'json': 'application/json; charset=utf-8',
					'png': 'image/png',
					'jpg': 'image/jpeg',
					'jpeg': 'image/jpeg',
					'gif': 'image/gif',
					'webp': 'image/webp',
					'svg': 'image/svg+xml',
					'pdf': 'application/pdf',
					'zip': 'application/zip',
					'tar': 'application/x-tar',
					'gz': 'application/gzip',
					'mp3': 'audio/mpeg',
					'mp4': 'video/mp4',
					'md': 'text/markdown; charset=utf-8'
				};

				const contentType = mimeTypes[ext] || 'application/octet-stream';

				// 处理附件下载逻辑
				if (url.searchParams.has('dl')) {
					resHeaders.set('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
					resHeaders.set('Content-Type', contentType);
				} else {
					resHeaders.set('Content-Type', contentType);
				}

				return new Response(textData, { status: 200, headers: resHeaders });
			} else {
				const errorText = env.ERROR || '无法获取文件，检查路径或TOKEN是否正确。';
				return new Response(errorText, {
					status: response.status,
					headers: { 
						'Content-Type': 'text/plain; charset=utf-8',
						'Access-Control-Allow-Origin': '*',
						'Cache-Control': 'no-store'
					}
				});
			}

		} else {
			// 根路径逻辑
			const envKey = env.URL302 ? 'URL302' : (env.URL ? 'URL' : null);
			if (envKey) {
				const URLs = await ADD(env[envKey]);
				const URL = URLs[Math.floor(Math.random() * URLs.length)];
				return envKey === 'URL302' ? Response.redirect(URL, 302) : fetch(new Request(URL, request));
			}

			return new Response(await nginx(), {
				headers: {
					'Content-Type': 'text/html; charset=UTF-8',
					'Cache-Control': 'no-store, no-cache',
					'Access-Control-Allow-Origin': '*'
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
