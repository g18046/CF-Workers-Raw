let token = "";

export default {
	async fetch(request, env) {
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

			// 1. 给 GitHub 请求追加随机时间戳参数，击穿 GitHub 自身的 CDN 缓存
			const rawUrlObj = new URL(githubRawUrl);
			rawUrlObj.searchParams.set('_t', Date.now().toString());

			// 初始化请求头
			const headers = new Headers();
			let authTokenSet = false;

			// 检查 TOKEN_PATH 特殊路径鉴权
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

			// 如果 TOKEN_PATH 没有设置认证，使用默认 token 逻辑
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

			// 2. 发起请求：开启 cf: { cacheTtl: 0 } 禁用 Cloudflare 节点缓存
			const response = await fetch(rawUrlObj.toString(), {
				headers,
				cf: {
					cacheTtl: 0,
					cacheEverything: false
				}
			});

			// 3. 构建强力“无缓存”响应头，阻止浏览器和中间代理缓存
			const noCacheHeaders = new Headers(response.headers);
			noCacheHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
			noCacheHeaders.set('Pragma', 'no-cache');
			noCacheHeaders.set('Expires', '0');

			// 检查请求是否成功
			if (response.ok) {
				return new Response(response.body, {
					status: response.status,
					headers: noCacheHeaders
				});
			} else {
				const errorText = env.ERROR || '无法获取文件，检查路径或TOKEN是否正确。';
				return new Response(errorText, {
					status: response.status,
					headers: noCacheHeaders
				});
			}

		} else {
			// 首页逻辑
			const envKey = env.URL302 ? 'URL302' : (env.URL ? 'URL' : null);
			if (envKey) {
				const URLs = await ADD(env[envKey]);
				const URL = URLs[Math.floor(Math.random() * URLs.length)];
				return envKey === 'URL302' ? Response.redirect(URL, 302) : fetch(new Request(URL, request));
			}

			return new Response(await nginx(), {
				headers: {
					'Content-Type': 'text/html; charset=UTF-8',
					'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
				},
			});
		}
	}
};

async function nginx() {
	return `
	<!DOCTYPE html>
	<html>
	<head>
	<title>Welcome to nginx!</title>
	<style>
		body {
			width: 35em;
			margin: 0 auto;
			font-family: Tahoma, Verdana, Arial, sans-serif;
		}
	</style>
	</head>
	<body>
	<h1>Welcome to nginx!</h1>
	<p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p>
	<p>For online documentation and support please refer to <a href="http://nginx.org/">nginx.org</a>.<br/>
	Commercial support is available at <a href="http://nginx.com/">nginx.com</a>.</p>
	<p><em>Thank you for using nginx.</em></p>
	</body>
	</html>
	`;
}

async function ADD(envadd) {
	var addtext = envadd.replace(/[	|"'\r\n]+/g, ',').replace(/,+/g, ',');
	if (addtext.charAt(0) == ',') addtext = addtext.slice(1);
	if (addtext.charAt(addtext.length - 1) == ',') addtext = addtext.slice(0, addtext.length - 1);
	return addtext.split(',');
}
