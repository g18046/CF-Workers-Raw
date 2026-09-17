let token = "";
export default {
	async fetch(request, env) {
		// 1. 处理 OPTIONS 预检请求（解决影视仓跨域、挂梯子时的 CORS 拦截）
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
			let githubRawUrl = 'https://raw.githubusercontent.com';
			if (new RegExp(githubRawUrl, 'i').test(url.pathname)) {
				githubRawUrl += url.pathname.split(githubRawUrl)[1];
			} else {
				if (env.GH_NAME) {
					githubRawUrl += '/' + env.GH_NAME;
					if (env.GH_REPO) {
						githubRawUrl += '/' + env.GH_REPO;
						if (env.GH_BRANCH) githubRawUrl += '/' + env.GH_BRANCH;
					}
				}
				githubRawUrl += url.pathname;
			}
			
			// 【核心去缓存 1】在直连 URL 末尾强制追加时间戳随机数，彻底穿透 GitHub 内部缓存
			githubRawUrl += (githubRawUrl.includes('?') ? '&' : '?') + `_t=${Date.now()}`;
			
			// 初始化请求头
			const headers = new Headers();
			// 【核心去缓存 2】强迫 GitHub 每次都必须计算最新文件，不回传旧数据
			headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
			headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
			headers.set('Pragma', 'no-cache');
			headers.set('Expires', '0');
			
			let authTokenSet = false; // 标记是否已经设置了认证token
			
			// 检查TOKEN_PATH特殊路径鉴权
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
						if (!providedToken) {
							return new Response('TOKEN不能为空', { status: 400 });
						}

						if (providedToken !== requiredToken.trim()) {
							return new Response('TOKEN错误', { status: 403 });
						}

						if (!env.GH_TOKEN) {
							return new Response('服务器GitHub TOKEN配置错误', { status: 500 });
						}
						headers.append('Authorization', `token ${env.GH_TOKEN}`);
						authTokenSet = true;
						break;
					}
				}
			}
			
			// 如果TOKEN_PATH没有设置认证，使用默认token逻辑
			if (!authTokenSet) {
				if (env.GH_TOKEN && env.TOKEN) {
					if (env.TOKEN == url.searchParams.get('token')) token = env.GH_TOKEN || token;
					else token = url.searchParams.get('token') || token;
				} else token = url.searchParams.get('token') || env.GH_TOKEN || env.TOKEN || token;
				
				const githubToken = token;
				if (!githubToken || githubToken == '') {
					return new Response('TOKEN不能为空', { status: 400 });
				}
				headers.append('Authorization', `token ${githubToken}`);
			}

			// 发起请求（【核心去缓存 3】同时显式拦截并关闭 Cloudflare 的内部节点缓存机制）
			const response = await fetch(githubRawUrl, { 
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

				// 【核心去缓存 4】给下级客户端下发最高优先级的全面禁缓存指令
				resHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
				resHeaders.set('Pragma', 'no-cache');
				resHeaders.set('Expires', '0');
				resHeaders.set('Access-Control-Allow-Origin', '*');
				resHeaders.set('Access-Control-Allow-Headers', '*');

				// 【核心修复】解析原始文件名与后缀，解决下载乱码和无法识别问题
				const pathParts = url.pathname.split('/');
				const rawFilename = pathParts.pop() || 'file.txt';
				const filename = decodeURIComponent(rawFilename);
				const ext = filename.split('.').pop().toLowerCase();

				// 常见主流后缀 MIME 映射表
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

				// 附件下载与预览响应头逻辑（标准规范声明，解决中文乱码，保留原始后缀）
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
						'Access-Control-Allow-Origin': '*'
					}
				});
			}

		} else {
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
	return `<!DOCTYPE html><html><head><title>Welcome to nginx!</title><style>body { width: 35em; margin: 0 auto; font-family: Tahoma, Verdana, Arial, sans-serif; }</style></head><body><h1>Welcome to nginx!</h1><p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p><p>For online documentation and support please refer to <a href="http://nginx.org/">nginx.org</a>.<br/>Commercial support is available at <a href="http://nginx.com/">nginx.com</a>.</p><p><em>Thank you for using nginx.</em></p></body></html>`;
}

async function ADD(envadd) {
	var addtext = envadd.replace(/[	|"'\r\n]+/g, ',').replace(/,+/g, ',');
	if (addtext.charAt(0) == ',') addtext = addtext.slice(1);
	if (addtext.charAt(addtext.length - 1) == ',') addtext = addtext.slice(0, addtext.length - 1);
	return addtext.split(',');
}
