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

			let targetUrl = '';
			const decodedPath = decodeURIComponent(path);
			const rawMatch = decodedPath.match(/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)/i);
			
			if (rawMatch) {
				owner = rawMatch[1];
				repo = rawMatch[2];
				ref = rawMatch[3];
				path = '/' + rawMatch[4];
				// 【策略升级】如果是 raw 链接，直接请求 raw 源站文件，彻底避开 GitHub API 的内部延迟和缓存
				targetUrl = `https://githubusercontent.com{owner}/${repo}/${ref}${path}?_t=${Date.now()}`;
			} else {
				// 普通相对路径走 API 节点
				targetUrl = `https://github.com{owner}/${repo}/contents${path}?ref=${ref}&_t=${Date.now()}`;
			}

			// 组装无缓存请求头
			const headers = new Headers();
			headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Cloudflare-Worker');
			headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
			headers.set('Pragma', 'no-cache');
			headers.set('Expires', '0');

			// 如果是走 API，增加标准 Accept 头
			if (!rawMatch) {
				headers.set('Accept', 'application/vnd.github.v3.raw');
			}

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

			// 向 GitHub 发起请求（CF 边缘全链路禁用缓存）
			const response = await fetch(targetUrl, {
				headers,
				cf: {
					cacheTtl: -1, 
					cacheTtlByStatus: { "200-299": -1, "400-599": 0 },
					cacheEverything: false
				}
			});

			if (response.ok) {
				const textData = await response.text();
				const resHeaders = new Headers();

				// 给客户端（影视仓/浏览器）下发最高级别的禁缓存指令
				resHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
				resHeaders.set('Pragma', 'no-cache');
				resHeaders.set('Expires', '0');
				resHeaders.set('Access-Control-Allow-Origin', '*');
				resHeaders.set('Access-Control-Allow-Headers', '*');

				// 解析原始文件名与后缀，解决下载和识别问题
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

				// 附件下载与预览响应头逻辑修正（完美保留原名与后缀）
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
