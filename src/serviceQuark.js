/**
 * 夸克网盘秒传服务
 */

/**
 * 创建夸克网盘秒传JSON
 * @param {string} shareUrl - 分享链接
 * @param {string} sharePwd - 分享密码
 * @param {string} cookie - 夸克Cookie
 * @returns {Promise<object>} 秒传JSON对象
 */
export async function createQuarkRapidTransfer(shareUrl, sharePwd, cookie) {
  const match = shareUrl.match(/\/s\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error("无效的夸克分享链接");

  const shareId = match[1];

  // 获取token
  const tokenRes = await fetch(
    "https://pc-api.uc.cn/1/clouddrive/share/sharepage/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        pwd_id: shareId,
        passcode: sharePwd || "",
      }),
    }
  );

  const tokenText = await tokenRes.text();
  console.log("Token response:", tokenText);

  let tokenData;
  try {
    tokenData = JSON.parse(tokenText);
  } catch (e) {
    throw new Error(
      `获取夸克token失败，响应格式错误: ${tokenText.substring(0, 100)}`
    );
  }

  if (tokenData.code !== 0) {
    throw new Error(`获取夸克token失败: ${tokenData.message || "未知错误"}`);
  }

  const stoken = tokenData.data.stoken;
  const files = await getQuarkShareFiles(shareId, stoken, cookie);

  return {
    scriptVersion: "3.0.3",
    exportVersion: "1.0",
    usesBase62EtagsInExport: false,
    commonPath: "",
    files,
    totalFilesCount: files.length,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
  };
}

/**
 * 递归获取夸克分享文件列表
 */
async function getQuarkShareFiles(
  shareId,
  stoken,
  cookie,
  parentFileId = 0,
  path = ""
) {
  const files = [];
  let page = 1;

  while (true) {
    const url = `https://pc-api.uc.cn/1/clouddrive/share/sharepage/detail?pwd_id=${shareId}&stoken=${encodeURIComponent(
      stoken
    )}&pdir_fid=${parentFileId}&_page=${page}&_size=100&pr=ucpro&fr=pc`;

    const res = await fetch(url, {
      headers: {
        Cookie: cookie,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0",
        Referer: "https://pan.quark.cn/",
      },
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(
        `获取文件列表失败，响应格式错误: ${text.substring(0, 100)}`
      );
    }

    if (data.code !== 0 || !data.data?.list) break;

    // 收集文件信息用于批量获取MD5
    const fileItems = [];
    for (const item of data.data.list) {
      if (!item.dir) {
        fileItems.push({
          fid: item.fid,
          token: item.share_fid_token,
          name: item.file_name,
          size: item.size,
          path: path ? `${path}/${item.file_name}` : item.file_name,
        });
      }
    }

    // 批量获取MD5
    const md5Map = {};
    if (fileItems.length > 0) {
      const batchSize = 10;
      for (let i = 0; i < fileItems.length; i += batchSize) {
        const batch = fileItems.slice(i, i + batchSize);
        const fids = batch.map((item) => item.fid);
        const tokens = batch.map((item) => item.token);

        // 延迟500ms再请求下一个
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        try {
          const md5Res = await fetch(
            `https://pc-api.uc.cn/1/clouddrive/file/download?pr=ucpro&fr=pc&uc_param_str=&__dt=${Math.floor(Math.random() * 4 + 1) * 60 * 1000}&__t=${Date.now()}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Cookie: cookie,
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/3.14.2 Chrome/112.0.5615.165 Electron/24.1.3.8 Safari/537.36 Channel/pckk_other_ch",
                Referer: "https://pan.quark.cn/",
                Accept: "application/json, text/plain, */*",
                Origin: "https://pan.quark.cn",
              },
              body: JSON.stringify({
                fids,
                pwd_id: shareId,
                stoken,
                fids_token: tokens,
              }),
            }
          );

          const md5Text = await md5Res.text();
          console.log(
            "MD5 API状态:",
            md5Res.status,
            "响应 (前100字符):",
            md5Text.substring(0, 100)
          );

          // 检查响应是否为JSON
          try {
            const md5Data = JSON.parse(md5Text);
            console.log("响应为JSON，code:", md5Data.code);

            if (md5Data.code === 0 && md5Data.data) {
              const dataList = Array.isArray(md5Data.data)
                ? md5Data.data
                : [md5Data.data];

              dataList.forEach((item, idx) => {
                const fid = fids[idx];
                if (!fid) return;

                let md5 = item.md5 || item.hash || "";

                // Base64解码
                if (md5 && md5.includes("==")) {
                  try {
                    const binaryString = atob(md5);
                    if (binaryString.length === 16) {
                      md5 = Array.from(binaryString, (char) =>
                        char.charCodeAt(0).toString(16).padStart(2, "0")
                      ).join("");
                      console.log(`fid=${fid} MD5:`, md5);
                    } else {
                      console.log(
                        `fid=${fid} MD5长度错误: ${binaryString.length}字节`
                      );
                      md5 = "";
                    }
                  } catch (e) {
                    console.log(`fid=${fid} MD5解码失败:`, e.message);
                    md5 = "";
                  }
                }

                md5Map[fid] = md5;
              });
            } else {
              console.log(
                "API错误 code:",
                md5Data.code,
                "msg:",
                md5Data.message || "未知"
              );
              // Cookie可能过期，返回空MD5
              fids.forEach((fid) => (md5Map[fid] = ""));
            }
          } catch (e) {
            // 非JSON响应 - Cookie可能过期或需要特殊处理
            console.log("⚠️  响应非JSON（Cookie可能过期）");
            // 返回空MD5
            fids.forEach((fid) => (md5Map[fid] = ""));
          }
        } catch (e) {
          console.log("MD5请求失败:", e.message);
          fids.forEach((fid) => (md5Map[fid] = ""));
        }
      }
    }

    // 处理文件列表
    for (const item of data.data.list) {
      const itemPath = path ? `${path}/${item.file_name}` : item.file_name;

      if (item.dir) {
        // 递归获取文件夹内容
        const subFiles = await getQuarkShareFiles(
          shareId,
          stoken,
          cookie,
          item.fid,
          itemPath
        );
        files.push(...subFiles);
      } else {
        // 文件：使用获取到的MD5（hex格式）
        files.push({
          path: itemPath,
          etag: (md5Map[item.fid] || "").toLowerCase(),  // MD5转小写
          size: item.size,
        });
      }
    }

    if (data.data.list.length < 100) break;
    page++;
  }

  return files;
}
