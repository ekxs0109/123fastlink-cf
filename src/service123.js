/**
 * 123网盘秒传服务
 */

const HEADERS = {
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
  'App-Version': '3',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'LoginUuid': Math.random().toString(36).slice(2),
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0',
  'platform': 'web',
  'sec-ch-ua': '"Not)A;Brand";v="99", "Microsoft Edge";v="127", "Chromium";v="127"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': 'Windows'
};

/**
 * 创建123网盘秒传JSON
 * @param {string} shareUrl - 分享链接
 * @param {string} sharePwd - 分享密码
 * @returns {Promise<object>} 秒传JSON对象
 */
export async function create123RapidTransfer(shareUrl, sharePwd = '') {
  // 支持多种域名格式：123pan.com, 123865.com 等
  const match = shareUrl.match(/https:\/\/www\.(123pan\.com|123865\.com|123684\.com|123912\.com|123pan\.cn)\/s\/(?<KEY>[^/?#]+)(?:\.html)?/i);
  if (!match) throw new Error("无效的123网盘分享链接");

  const shareKey = match.groups.KEY;
  const files = await get123ShareFiles(shareKey, sharePwd);

  return {
    commonPath: "",
    files,
    totalFilesCount: files.length,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    usesBase62EtagsInExport: false,
  };
}

/**
 * 递归获取123网盘分享文件列表
 * @param {string} shareKey - 分享Key
 * @param {string} sharePwd - 分享密码
 * @param {number} parentFileId - 父文件夹ID
 * @param {string} path - 当前路径
 * @returns {Promise<Array>} 文件列表
 */
async function get123ShareFiles(
  shareKey,
  sharePwd = '',
  parentFileId = 0,
  path = ""
) {
  const files = [];
  let page = 1;

  while (true) {
    const url = `https://www.123pan.com/a/api/share/get?limit=100&next=1&orderBy=file_name&orderDirection=asc&shareKey=${encodeURIComponent(shareKey)}&SharePwd=${encodeURIComponent(sharePwd)}&ParentFileId=${parentFileId}&Page=${page}&event=homeListFile&operateType=1`;
    const res = await fetch(url, { headers: HEADERS });
    const data = await res.json();

    if (data.code !== 0 || !data.data?.InfoList) {
      if (data.code !== 0 && sharePwd && page === 1) {
        throw new Error("密码错误或分享已失效");
      }
      break;
    }

    for (const item of data.data.InfoList) {
      const itemPath = path ? `${path}/${item.FileName}` : item.FileName;

      if (item.Type === 1) {
        // 文件夹，递归获取
        const subFiles = await get123ShareFiles(
          shareKey,
          sharePwd,
          item.FileId,
          itemPath
        );
        files.push(...subFiles);
      } else {
        // 文件
        files.push({ 
          path: itemPath, 
          etag: (item.Etag || "").toLowerCase(),
          size: item.Size 
        });
      }
    }

    if (data.data.InfoList.length < 100) break;
    page++;
  }

  return files;
}
